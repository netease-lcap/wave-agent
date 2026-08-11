package com.wave.jetbrains.session

import com.intellij.ide.plugins.PluginManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.wave.jetbrains.WaveBackendService
import com.wave.jetbrains.config.WavePluginService
import com.wave.jetbrains.stdio.AgentCallbacks
import com.wave.jetbrains.stdio.NotificationRouter
import com.wave.jetbrains.stdio.StdioAgent
import com.wave.jetbrains.stdio.StdioClient
import com.wave.jetbrains.stdio.StdioClientException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/** A pending permission confirmation awaiting user response. */
data class PendingConfirmation(
    val confirmationId: String,
    val requestId: String,
    val deferred: kotlinx.coroutines.CompletableDeferred<JsonObject>,
    val toolName: String,
    val confirmationType: String,
    val toolInput: JsonElement? = null,
    val planContent: String? = null,
    val permissionMode: String? = null,
)

/**
 * Holds stdio connection + session state + throttling.
 * Mirrors packages/vscode/src/session/chatSession.ts.
 */
class WaveSession(
    private val project: Project,
    private val postMessageFn: (command: String, JsonObject) -> Unit,
    private val tabTitleFn: ((title: String) -> Unit)? = null,
) : AgentCallbacks {

    private val LOG = logger<WaveSession>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile var agent: StdioAgent? = null
        private set
    @Volatile var messages: JsonElement? = null
        private set
    @Volatile var tasks: JsonElement? = null
        private set
    @Volatile var backgroundTasks: JsonElement? = null
        private set
    @Volatile var workflowRuns: JsonElement? = null
        private set
    @Volatile var sessionId: String? = null
        private set
    /** Cached main-session list (from listSessions); used to resolve the tab title via firstMessage. */
    @Volatile var sessions: JsonArray? = null
        private set
    @Volatile var isStreaming = false
        private set
    @Volatile var isCommandRunning = false
        private set
    @Volatile var isInitializing = false
        private set
    @Volatile var inputContent = ""
    @Volatile var messageQueue: JsonElement? = null
        private set
    @Volatile var permissionMode: String? = null

    val pendingConfirmations = mutableMapOf<String, PendingConfirmation>()
    private val confirmationsMutex = Mutex()

    /** Public entry so other components (PermissionFlow, MessageHandler) can push to the webview. */
    fun postMessage(command: String, payload: JsonObject) = postMessageFn(command, payload)

    // ── Throttle: streaming content (16ms leading+trailing) ───────
    private val streamMutex = Mutex()
    private var streamTimer: Job? = null
    private var streamPending: JsonObject? = null

    // ── Throttle: streaming reasoning (16ms leading+trailing) ─────
    private val reasonMutex = Mutex()
    private var reasonTimer: Job? = null
    private var reasonPending: JsonObject? = null

    suspend fun initialize(restoreSessionId: String? = null): Boolean {
        if (isInitializing || agent != null) return agent != null
        isInitializing = true
        return try {
            val backend = WaveBackendService.getInstance(project)
            val (client, router) = backend.ensureClient()
            val a = StdioAgent(client, router, this)
            agent = a
            backend.registerSession(this)
            val config = WavePluginService.getInstance().loadConfiguration()
            val params = buildJsonObject {
                put("workdir", project.basePath ?: System.getProperty("user.dir"))
                if (restoreSessionId != null) put("restoreSessionId", restoreSessionId)
                if (config.apiKey.isNotEmpty()) put("apiKey", config.apiKey)
                val headers = parseHeaders(config.headers)
                if (headers != null) put("defaultHeaders", headers)
                if (config.baseURL.isNotEmpty()) put("baseURL", config.baseURL)
                if (config.model.isNotEmpty()) put("model", config.model)
                if (config.fastModel.isNotEmpty()) put("fastModel", config.fastModel)
                put("language", config.language)
            }
            try {
                a.initialize(params)
            } catch (e: StdioClientException) {
                if (e.message?.startsWith("Session not found:") == true && restoreSessionId != null) {
                    LOG.warn("Session not found, retrying without restoreSessionId")
                    val retryParams = params.toMutableMap().apply { remove("restoreSessionId") }
                        .let { buildJsonObject { it.forEach { (k, v) -> put(k, v) } } }
                    a.initialize(retryParams)
                } else throw e
            }
            // sync sessionId
            if (a.sessionId != null && a.sessionId != sessionId) {
                sessionId = a.sessionId
            }
            permissionMode = a.permissionMode
            true
        } catch (e: Exception) {
            LOG.error("Failed to initialize wave session", e)
            onError(e.message ?: "Initialization failed")
            false
        } finally {
            isInitializing = false
        }
    }

    // ── AgentCallbacks: route notifications → webview commands ────

    override fun onCompactBlockAdded(content: String) {
        // Compaction truncated the list server-side; pull the fresh list and push it
        // to the webview (mirrors VSCE chatSession.ts:91-94, spec pull model).
        scope.launch { pullAndPushMessages() }
    }

    // Forward the compaction state to the shared webview, which renders the
    // "正在压缩对话…" hint after the blinking cursor (mirrors VSCE chatSession.ts).
    override fun onCompactionStateChange(isCompacting: Boolean) {
        postMessage("compactionStateChange", buildJsonObject { put("isCompacting", isCompacting) })
    }

    override fun onUserMessageAdded(message: JsonElement?) {
        // VSCE maps both userMessageAdded and assistantMessageAdded to appendMessage
        if (message != null) postMessage("appendMessage", buildJsonObject { put("message", message) })
        // Keep the tab title in sync with the header: prefer the authoritative firstMessage
        // (mirrors webview SET_CURRENT_SESSION backfill + formatSessionLabel), fall back to
        // deriving from the message list for a brand-new session not yet in the list.
        updateTabTitle()
    }

    /**
     * Resolves the tab title for the current session and pushes it via [tabTitleFn]. Prefers the
     * authoritative `firstMessage` from the cached session list (same source as the session list UI
     * and webview header after the SET_CURRENT_SESSION backfill), so compressed sessions keep the
     * compact-block title instead of being overwritten by the first post-compact user message.
     * Falls back to [updateTabTitleFromMessages] for new sessions not yet in the list.
     */
    private fun updateTabTitle() {
        val fn = tabTitleFn ?: return
        val sid = sessionId ?: return
        val list = sessions
        if (list != null) {
            for (s in list) {
                val o = s as? JsonObject ?: continue
                if (o["id"]?.jsonPrimitive?.contentOrNull != sid) continue
                val first = o["firstMessage"]?.jsonPrimitive?.contentOrNull?.trim().orEmpty()
                if (first.isNotEmpty()) {
                    fn(if (first.length > 30) first.substring(0, 30) + "..." else first)
                    return
                }
                break
            }
        }
        updateTabTitleFromMessages()
    }

    /**
     * Derives a tab title from the first non-meta user message in [messages] and pushes it to the
     * tool-window tab via [tabTitleFn]. Mirrors `firstUserMessageText` + `truncate` in
     * webview utils/session.ts:11-23,5-8 (join text/compact block contents, 30-char cap + "...").
     */
    private fun updateTabTitleFromMessages() {
        val fn = tabTitleFn ?: return
        val arr = messages as? JsonArray ?: return
        for (msg in arr) {
            val obj = msg as? JsonObject ?: continue
            if (obj["role"]?.jsonPrimitive?.contentOrNull != "user") continue
            if (obj["isMeta"]?.jsonPrimitive?.booleanOrNull == true) continue
            val blocks = obj["blocks"] as? JsonArray ?: continue
            val text = blocks.joinToString("") { b ->
                val bo = b as? JsonObject ?: return@joinToString ""
                val type = bo["type"]?.jsonPrimitive?.contentOrNull
                if (type == "text" || type == "compact") bo["content"]?.jsonPrimitive?.contentOrNull.orEmpty() else ""
            }.trim()
            if (text.isNotEmpty()) {
                fn(if (text.length > 30) text.substring(0, 30) + "..." else text)
                return
            }
        }
    }

    override fun onAssistantMessageAdded(message: JsonElement?) {
        if (message != null) postMessage("appendMessage", buildJsonObject { put("message", message) })
    }

    override fun onAssistantContentUpdated(messageId: String, chunk: String, stage: String) {
        scope.launch {
            streamMutex.withLock {
                if (stage == "end") {
                    streamTimer?.cancel()
                    // Flush any chunks still pending inside the cooldown window first
                    streamPending?.let { postMessage("updateStreamingContent", it) }
                    streamPending = null
                    streamTimer = null
                    postMessage("updateStreamingContent", buildJsonObject {
                        put("messageId", messageId)
                        put("chunk", chunk)
                        put("stage", stage)
                    })
                } else {
                    // window-concat: merge all chunks arriving within the cooldown
                    // window so no delta is lost (dropping a delta would
                    // permanently lose content).
                    val pending = streamPending
                    val merged = if (pending != null) {
                        buildJsonObject {
                            put("messageId", pending["messageId"] ?: JsonPrimitive(""))
                            put("chunk", (pending["chunk"]?.jsonPrimitive?.content ?: "") + chunk)
                            put("stage", "streaming")
                        }
                    } else {
                        buildJsonObject {
                            put("messageId", messageId)
                            put("chunk", chunk)
                            put("stage", stage)
                        }
                    }
                    streamPending = merged
                    if (streamTimer == null) {
                        // leading edge: fire the current delta immediately, then
                        // reset pending so the trailing edge only carries chunks
                        // arriving within this window (otherwise the leading
                        // chunk would be appended twice by the reducer).
                        postMessage("updateStreamingContent", merged)
                        streamPending = null
                        streamTimer = scope.launch {
                            delay(16)
                            streamMutex.withLock {
                                streamPending?.let { postMessage("updateStreamingContent", it) }
                                streamPending = null
                                streamTimer = null
                            }
                        }
                    }
                }
            }
        }
    }

    override fun onAssistantReasoningUpdated(messageId: String, chunk: String, stage: String) {
        scope.launch {
            reasonMutex.withLock {
                if (stage == "end") {
                    reasonTimer?.cancel()
                    // Flush any chunks still pending inside the cooldown window first
                    reasonPending?.let { postMessage("updateStreamingReasoning", it) }
                    reasonPending = null
                    reasonTimer = null
                    postMessage("updateStreamingReasoning", buildJsonObject {
                        put("messageId", messageId)
                        put("chunk", chunk)
                        put("stage", stage)
                    })
                } else {
                    // window-concat: merge all chunks arriving within the cooldown
                    // window so no delta is lost (dropping a delta would
                    // permanently lose content).
                    val pending = reasonPending
                    val merged = if (pending != null) {
                        buildJsonObject {
                            put("messageId", pending["messageId"] ?: JsonPrimitive(""))
                            put("chunk", (pending["chunk"]?.jsonPrimitive?.content ?: "") + chunk)
                            put("stage", "streaming")
                        }
                    } else {
                        buildJsonObject {
                            put("messageId", messageId)
                            put("chunk", chunk)
                            put("stage", stage)
                        }
                    }
                    reasonPending = merged
                    if (reasonTimer == null) {
                        // leading edge: fire the current delta immediately, then
                        // reset pending so the trailing edge only carries chunks
                        // arriving within this window (otherwise the leading
                        // chunk would be appended twice by the reducer).
                        postMessage("updateStreamingReasoning", merged)
                        reasonPending = null
                        reasonTimer = scope.launch {
                            delay(16)
                            reasonMutex.withLock {
                                reasonPending?.let { postMessage("updateStreamingReasoning", it) }
                                reasonPending = null
                                reasonTimer = null
                            }
                        }
                    }
                }
            }
        }
    }

    override fun onToolBlockUpdated(params: JsonElement?) {
        postMessage("updateToolBlock", buildJsonObject { put("params", params ?: JsonObject(emptyMap())) })
    }

    override fun onErrorBlockAdded(error: String) {
        postMessage("updateErrorBlock", buildJsonObject { put("error", error) })
    }

    override fun onLoadingChange(loading: Boolean) {
        isStreaming = loading
        postMessage(if (loading) "startStreaming" else "endStreaming", JsonObject(emptyMap()))
    }

    override fun onCommandRunningChange(running: Boolean) {
        isCommandRunning = running
        postMessage("updateCommandRunning", buildJsonObject { put("running", running) })
    }

    override fun onQueuedMessagesChange(messages: JsonElement?) {
        messageQueue = messages
        postMessage("updateQueue", buildJsonObject { put("queue", messages ?: JsonArray(emptyList())) })
    }

    override fun onTasksChange(tasks: JsonElement?) {
        this.tasks = tasks
        postMessage("updateTasks", buildJsonObject { put("tasks", tasks ?: JsonArray(emptyList())) })
    }

    override fun onBackgroundTasksChange(tasks: JsonElement?) {
        this.backgroundTasks = tasks
        postMessage("updateBackgroundTasks", buildJsonObject { put("tasks", tasks ?: JsonArray(emptyList())) })
        scope.launch {
            val runs = try {
                agent?.getWorkflowRuns()
            } catch (e: StdioClientException) {
                LOG.warn("getWorkflowRuns failed: ${e.message}")
                null
            }
            if (runs != null) {
                this@WaveSession.workflowRuns = runs
                postMessage("updateWorkflowRuns", buildJsonObject { put("runs", runs) })
            }
        }
    }

    override fun onSessionIdChange(sessionId: String) {
        this.sessionId = sessionId
        // VSCE chatProvider.ts:438-449: push full session metadata, then refresh the session list.
        val workdir = agent?.workingDirectory ?: project.basePath ?: ""
        postMessage("updateCurrentSession", buildJsonObject {
            put("session", buildJsonObject {
                put("id", sessionId)
                put("sessionType", "main")
                put("workdir", workdir)
                put("lastActiveAt", java.time.Instant.now().toString())
                put("latestTotalTokens", agent?.latestTotalTokens ?: 0)
            })
        })
        refreshSessions()
    }

    /**
     * Pull the session list from the agent and push `updateSessions` to the webview.
     * Mirrors VSCE chatProvider.ts:368 listSessions() (filter main sessions, take 10).
     */
    fun refreshSessions() {
        val workdir = agent?.workingDirectory ?: project.basePath ?: return
        scope.launch {
            val list: List<JsonElement> = try {
                val res = agent?.listSessions(workdir)?.jsonObject
                val all = res?.get("sessions")?.jsonArray ?: JsonArray(emptyList())
                all.filter { it.jsonObject["sessionType"]?.jsonPrimitive?.content == "main" }.take(10)
            } catch (e: StdioClientException) {
                LOG.warn("refreshSessions failed: ${e.message}")
                JsonArray(emptyList()).toList()
            }
            sessions = JsonArray(list)
            postMessage("updateSessions", buildJsonObject { put("sessions", JsonArray(list)) })
            updateTabTitle()
        }
    }

    override fun onPermissionModeChange(mode: String) {
        permissionMode = mode
        postMessage("updatePermissionMode", buildJsonObject { put("mode", mode) })
    }

    override fun onWorkdirChange(workdir: String) {
        postMessage("updateWorkdir", buildJsonObject { put("workdir", workdir) })
    }

    override fun onMcpServersChange(servers: JsonElement?) {
        postMessage("mcpServersUpdate", buildJsonObject { put("servers", servers ?: JsonArray(emptyList())) })
    }

    // Bang notifications carry messageId for incremental updates (mirrors VSCE
    // chatProvider.ts:297-308). Params are nested (not spread) because they contain
    // a `command` field that would clobber the postMessage command discriminator.
    override fun onBangMessageAdded(command: String, messageId: String) {
        postMessage("bangMessageAdded", buildJsonObject {
            put("params", buildJsonObject {
                put("command", command)
                put("messageId", messageId)
            })
        })
    }

    override fun onBangMessageUpdated(command: String, output: String, messageId: String) {
        postMessage("bangMessageUpdated", buildJsonObject {
            put("params", buildJsonObject {
                put("command", command)
                put("output", output)
                put("messageId", messageId)
            })
        })
    }

    override fun onBangMessageCompleted(command: String, exitCode: Int, messageId: String, output: String?) {
        postMessage("bangMessageCompleted", buildJsonObject {
            put("params", buildJsonObject {
                put("command", command)
                put("exitCode", exitCode)
                put("messageId", messageId)
                if (output != null) put("output", output)
            })
        })
    }

    // VSCE chatSession.ts:142-146: if params.message is present, forward to appendMessage.
    override fun onNotificationMessageAdded(message: JsonObject) {
        val msg = message["message"]
        if (msg != null) postMessage("appendMessage", buildJsonObject { put("message", msg) })
    }

    override fun onBtwContent(question: String, content: String, type: String) {
        postMessage("btwStream", buildJsonObject {
            put("question", question)
            put("content", content)
            put("type", type)
        })
    }

    override fun onPermissionRequest(requestId: String, context: JsonElement?) {
        scope.launch {
            PermissionFlow.handle(this@WaveSession, requestId, context)
        }
    }

    override fun onError(message: String) {
        LOG.warn("Wave session error: $message")
    }

    // ── Message list: one-shot pull ───────────────────────────────

    /**
     * Pull the full message list via the `getMessages` RPC into the [messages] cache.
     * The webview no longer subscribes to a full-snapshot push; hosts pull on demand
     * after webviewReady / compact / rewind / clearChat / restoreSession (spec pull model,
     * mirrors VSCE chatSession.getMessages). The cache field [messages] is maintained
     * exclusively from these pulls.
     */
    suspend fun refreshMessages() {
        try {
            val list = agent?.getMessages()?.jsonObject?.get("messages")
            if (list != null) messages = list
        } catch (e: StdioClientException) {
            LOG.warn("getMessages failed: ${e.message}")
        }
    }

    /** Pull the full message list and push it to the webview as the "response" (updateMessages). */
    suspend fun pullAndPushMessages() {
        refreshMessages()
        postMessage("updateMessages", buildJsonObject { put("messages", messages ?: JsonArray(emptyList())) })
    }

    /**
     * Push updated config to this session's agent, mirroring VSCE ChatSession.updateConfig
     * (chatSession.ts:286-311): reset streaming state and clear the queue before the backend
     * rebuilds the agent. sessionId rekey (if it changes) is handled in [StdioAgent.updateConfig].
     */
    suspend fun updateConfig(params: JsonObject) {
        if (isStreaming) {
            isStreaming = false
            postMessage("endStreaming", JsonObject(emptyMap()))
        }
        agent?.updateConfig(params)
        messageQueue = null
        postMessage("updateQueue", buildJsonObject { put("queue", JsonArray(emptyList())) })
    }

    suspend fun destroyAgent() {
        agent?.let { runCatching { it.destroy() } }
        agent = null
    }

    fun dispose() {
        WaveBackendService.getInstance(project).unregisterSession(this)
        runCatching { runBlocking { agent?.destroy() } }
        agent = null
        scope.cancel()
    }

    companion object {
        fun pluginVersion(): String =
            PluginManager.getInstance().findEnabledPlugin(PluginId.getId("com.wave.jetbrains"))?.version ?: ""

        fun parseHeaders(text: String): JsonObject? {
            if (text.isBlank()) return null
            return try {
                val map = mutableMapOf<String, JsonElement>()
                text.lineSequence().forEach { line ->
                    val trimmed = line.trim()
                    if (trimmed.isEmpty() || trimmed.startsWith("#")) return@forEach
                    val idx = trimmed.indexOf(':')
                    if (idx <= 0) return@forEach
                    val key = trimmed.substring(0, idx).trim()
                    val value = trimmed.substring(idx + 1).trim()
                    map[key] = JsonPrimitive(value)
                }
                if (map.isEmpty()) null else JsonObject(map)
            } catch (e: Exception) {
                null
            }
        }
    }
}
