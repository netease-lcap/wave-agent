package com.wave.jetbrains.session

import com.intellij.ide.BrowserUtil
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.wave.jetbrains.config.WavePluginService
import com.wave.jetbrains.ide.IdeService
import com.wave.jetbrains.stdio.AgentCallbacks
import com.wave.jetbrains.stdio.BinaryResolver
import com.wave.jetbrains.stdio.StdioAgent
import com.wave.jetbrains.stdio.StdioClient
import com.wave.jetbrains.stdio.StdioClientException
import com.wave.jetbrains.update.UpdateChecker
import com.wave.jetbrains.util.Edt
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
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
)

/**
 * Holds stdio connection + session state + throttling.
 * Mirrors packages/vsce/src/session/chatSession.ts.
 */
class WaveSession(
    private val project: Project,
    private val postMessageFn: (command: String, JsonObject) -> Unit,
) : AgentCallbacks {

    private val LOG = logger<WaveSession>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile var agent: StdioAgent? = null
        private set
    @Volatile var messages: JsonElement? = null
        private set
    @Volatile var tasks: JsonElement? = null
        private set
    @Volatile var sessionId: String? = null
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

    // ── Throttle: message list (300ms leading+trailing) ───────────
    private val msgMutex = Mutex()
    private var msgTimer: Job? = null
    private var msgPending = false

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
            val binary = BinaryResolver.resolveWaveBinary()
            val client = StdioClient(binary, listOf("--stdio"), BinaryResolver.resolveEnv())
            val a = StdioAgent(client, this)
            agent = a
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
                put("clientVersion", pluginVersion())
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
            // Version negotiation: if the CLI is older than the plugin, silently upgrade once per activation.
            val pluginVer = pluginVersion()
            if (!cliUpgradeAttempted && pluginVer.isNotEmpty() && !a.serverVersion.isNullOrEmpty()) {
                val cmp = try {
                    BinaryResolver.compareVersions(a.serverVersion!!, pluginVer)
                } catch (_: Exception) { 0 }
                if (cmp < 0) {
                    cliUpgradeAttempted = true
                    try {
                        LOG.info("CLI ${a.serverVersion} < plugin $pluginVer; upgrading wave-code to $pluginVer")
                        BinaryResolver.upgradeWaveBinary(pluginVer)
                        // Restart on the new binary: destroy current agent and re-initialize once.
                        try { a.close() } catch (_: Exception) {}
                        agent = null
                        isInitializing = false
                        return initialize(null)
                    } catch (e: Exception) {
                        LOG.error("CLI auto-upgrade failed", e)
                        IdeService.showError(project, "Wave CLI 升级失败，请手动执行: npm install -g wave-code --registry=https://registry.npmmirror.com")
                    }
                }
            }
            // Plugin self-update check: once per activation, 24h cooldown (mirrors VSCE updateService).
            if (!UpdateChecker.autoCheckTriggered) {
                UpdateChecker.autoCheckTriggered = true
                scope.launch { UpdateChecker.checkAndNotify(project) }
            }
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

    override fun onMessagesChange(messages: JsonElement?) {
        this.messages = messages
    }

    override fun onCompactBlockAdded(content: String) {
        // onMessagesChange（截断列表）已先于此到达并更新 this.messages；即时推一次
        scope.launch { immediateMessagesUpdate() }
    }

    override fun onUserMessageAdded(message: JsonElement?) {
        // VSCE maps both userMessageAdded and assistantMessageAdded to appendMessage
        if (message != null) postMessage("appendMessage", buildJsonObject { put("message", message) })
    }

    override fun onAssistantMessageAdded(message: JsonElement?) {
        if (message != null) postMessage("appendMessage", buildJsonObject { put("message", message) })
    }

    override fun onAssistantContentUpdated(messageId: String, accumulated: String, stage: String) {
        val payload = buildJsonObject {
            put("messageId", messageId)
            put("accumulated", accumulated)
            put("stage", stage)
        }
        scope.launch {
            if (stage == "end") {
                streamMutex.withLock {
                    streamTimer?.cancel()
                    streamPending = null
                    streamTimer = null
                }
                postMessage("updateStreamingContent", payload)
            } else {
                streamPending = payload
                streamMutex.withLock {
                    if (streamTimer == null) {
                        postMessage("updateStreamingContent", streamPending!!)
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

    override fun onAssistantReasoningUpdated(messageId: String, accumulated: String, stage: String) {
        val payload = buildJsonObject {
            put("messageId", messageId)
            put("accumulated", accumulated)
            put("stage", stage)
        }
        scope.launch {
            if (stage == "end") {
                reasonMutex.withLock {
                    reasonTimer?.cancel()
                    reasonPending = null
                    reasonTimer = null
                }
                postMessage("updateStreamingReasoning", payload)
            } else {
                reasonPending = payload
                reasonMutex.withLock {
                    if (reasonTimer == null) {
                        postMessage("updateStreamingReasoning", reasonPending!!)
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
            val sessions = try {
                val res = agent?.listSessions(workdir)?.jsonObject
                val all = res?.get("sessions")?.jsonArray ?: JsonArray(emptyList())
                all.filter { it.jsonObject["sessionType"]?.jsonPrimitive?.content == "main" }.take(10)
            } catch (e: StdioClientException) {
                LOG.warn("refreshSessions failed: ${e.message}")
                JsonArray(emptyList())
            }
            postMessage("updateSessions", buildJsonObject { put("sessions", JsonArray(sessions)) })
        }
    }

    override fun onPermissionModeChange(mode: String) {
        permissionMode = mode
        postMessage("updatePermissionMode", buildJsonObject { put("mode", mode) })
    }

    override fun onMcpServersChange(servers: JsonElement?) {
        postMessage("mcpServersUpdate", buildJsonObject { put("servers", servers ?: JsonArray(emptyList())) })
    }

    // VSCE chatProvider.ts:229-236 / chatSession.ts:139-141: all three bang notifications
    // re-push the full message list via updateMessages (onBangMessageCompleted delegates to Updated).
    override fun onBangMessageAdded() {
        scope.launch { throttledMessagesUpdate(messages) }
    }

    override fun onBangMessageUpdated() {
        scope.launch { throttledMessagesUpdate(messages) }
    }

    override fun onBangMessageCompleted() {
        scope.launch { throttledMessagesUpdate(messages) }
    }

    // VSCE chatSession.ts:142-146: if params.message is present, forward to appendMessage.
    override fun onNotificationMessageAdded(message: JsonObject) {
        val msg = message["message"]
        if (msg != null) postMessage("appendMessage", buildJsonObject { put("message", msg) })
    }

    // VSCE chatProvider.ts:142-147: open the auth URL in the system browser (on EDT).
    override fun onAuthUrl(url: String) {
        if (url.isEmpty()) return
        Edt.invokeLater { BrowserUtil.browse(url) }
    }

    override fun onPermissionRequest(requestId: String, context: JsonElement?) {
        scope.launch {
            PermissionFlow.handle(this@WaveSession, requestId, context)
        }
    }

    override fun onError(message: String) {
        LOG.warn("Wave session error: $message")
    }

    // ── Throttle implementations ──────────────────────────────────

    /** Push the current message list immediately, bypassing the throttle. */
    suspend fun immediateMessagesUpdate() {
        msgMutex.withLock {
            msgTimer?.cancel()
            msgTimer = null
            msgPending = false
        }
        postMessage("updateMessages", buildJsonObject {
            put("messages", messages ?: JsonArray(emptyList()))
        })
    }

    private suspend fun throttledMessagesUpdate(messages: JsonElement?) {
        msgMutex.withLock {
            if (!msgPending && msgTimer == null) {
                // leading edge
                postMessage("updateMessages", buildJsonObject { put("messages", messages ?: JsonArray(emptyList())) })
                msgPending = true
                msgTimer = scope.launch {
                    delay(300)
                    msgMutex.withLock {
                        // trailing edge
                        postMessage("updateMessages", buildJsonObject { put("messages", this@WaveSession.messages ?: JsonArray(emptyList())) })
                        msgPending = false
                        msgTimer = null
                    }
                }
            }
        }
    }

    fun dispose() {
        agent?.close()
        scope.cancel()
    }

    companion object {
        @Volatile
        private var cliUpgradeAttempted = false

        fun pluginVersion(): String =
            PluginManagerCore.getPlugin(PluginId.getId("com.wave.jetbrains"))?.version ?: ""

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
