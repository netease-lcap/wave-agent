package com.wave.jetbrains.session

import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.wave.jetbrains.WaveBackendService
import com.wave.jetbrains.WavePanelHolder
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
    val outsideSafeZoneDirectory: String? = null,
)

/**
 * Holds stdio connection + session state + throttling.
 * Mirrors packages/vscode/src/session/chatSession.ts.
 */
class WaveSession(
    private val project: Project,
    private val postMessageFn: (command: String, JsonObject) -> Unit,
) : AgentCallbacks {

    private val LOG = logger<WaveSession>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile var agent: StdioAgent? = null
        private set
    /**
     * 宿主手里这份**常驻窗口**：最近 [MessagePaging.FIRST_PAGE_SIZE] 条，不是全量。
     *
     * 全量在会话转录里（SDK 侧 append-only 的 JSONL）：翻更早按窗口读盘，回滚由
     * SDK 自己改盘，两边都不再从这个字段取全量——三个宿主按同一条口径收缩，理由
     * 见 SDK 的 `constants/messageWindow.ts`。写过它的只有 [refreshMessages]（整页
     * 替换）、[onCompactBlockAdded]（追加一条）、以及回滚后的就地截断。
     */
    @Volatile var messages: JsonElement? = null
    /** [messages] 之前还有没有更早的（由 [refreshMessages] 从回包带回）。 */
    @Volatile var hasMoreMessages = false
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
    /** True while a compaction LLM call is in flight; blocks in-place clearChat/restoreSession. */
    @Volatile var isCompacting = false
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
            val params = buildJsonObject {
                put("workdir", project.basePath ?: System.getProperty("user.dir"))
                if (restoreSessionId != null) put("restoreSessionId", restoreSessionId)
                // 遥测的 app.entrypoint：本会话由 JetBrains 插件创建
                // （spec enterprise/opentelemetry.md「宿主入口标识」）。
                put("entrypoint", "jetbrains")
                // 不下发任何会话级覆盖项：模型经底栏模型选择器走宿主 RPC；用户偏好
                // （语言 / 上下文长度 / 自动记忆）落点唯一为用户级
                // ~/.wave/settings.json，经 SDK 实时重载生效
                // （spec core/agent-config.md「设置实时重载」）。
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

    override fun onCompactBlockAdded(content: String, message: JsonElement?) {
        val compactMessage = message
        // Older CLI without the field on the wire: fall back to the full pull.
        if (compactMessage == null) {
            scope.launch { pullAndPushMessages() }
            return
        }
        // Compaction only folds the API context; the display stream just gained the
        // summary block, so append it like any other new message instead of pulling
        // and replacing the whole list (spec: 压缩走增量通道).
        val current = messages as? JsonArray ?: JsonArray(emptyList())
        messages = JsonArray(current + compactMessage)
        postMessage("appendMessage", buildJsonObject { put("message", compactMessage) })
    }

    // Forward the compaction state to the shared webview, which renders the
    // "正在压缩对话" hint after the blinking cursor (mirrors VSCE chatSession.ts).
    override fun onCompactionStateChange(isCompacting: Boolean) {
        this.isCompacting = isCompacting
        postMessage("compactionStateChange", buildJsonObject { put("isCompacting", isCompacting) })
    }

    // Forward the accumulated compaction stream to the shared webview, which
    // renders its last 30 characters after the "正在压缩对话" hint (streaming
    // tail, mirrors VSCE chatSession.ts).
    override fun onCompactionContentUpdate(content: String) {
        postMessage("compactionContentUpdate", buildJsonObject { put("content", content) })
    }

    // Plan panel live refresh (spec: 计划文件更新后刷新计划面板): the model wrote the
    // plan file — update the already-open editor tab, never create one.
    override fun onPlanFileUpdated(content: String) {
        WavePanelHolder.getInstance(project).refreshPlanPreview(this, content)
    }

    override fun onUserMessageAdded(message: JsonElement?) {
        // VSCE maps both userMessageAdded and assistantMessageAdded to appendMessage
        if (message != null) postMessage("appendMessage", buildJsonObject { put("message", message) })
    }

    override fun onAssistantMessageAdded(message: JsonElement?) {
        if (message != null) postMessage("appendMessage", buildJsonObject { put("message", message) })
    }

    // The streamed attempt died mid-body and the CLI re-issued it without
    // streaming: drop the half message the webview already rendered.
    override fun onAssistantMessageDiscarded(messageId: String) {
        if (messageId.isNotEmpty()) postMessage("discardMessage", buildJsonObject { put("messageId", messageId) })
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

    override fun onContextUsage(percent: Double) {
        postMessage("contextUsage", buildJsonObject { put("percent", percent) })
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
        val workdir = agent?.currentWorkdir ?: project.basePath ?: ""
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
     * Mirrors VSCE SessionService.getSessionsList() (filter main sessions, no cap —
     * the SDK already sorts by lastActiveAt descending and excludes subagent files).
     */
    fun refreshSessions() {
        val workdir = agent?.currentWorkdir ?: project.basePath ?: return
        scope.launch {
            val list: List<JsonElement> = try {
                val res = agent?.listSessions(workdir)?.jsonObject
                val all = res?.get("sessions")?.jsonArray ?: JsonArray(emptyList())
                all.filter { it.jsonObject["sessionType"]?.jsonPrimitive?.content == "main" }
            } catch (e: StdioClientException) {
                LOG.warn("refreshSessions failed: ${e.message}")
                JsonArray(emptyList()).toList()
            }
            sessions = JsonArray(list)
            postMessage("updateSessions", buildJsonObject { put("sessions", JsonArray(list)) })
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
            PermissionFlow.handle(project, this@WaveSession, requestId, context)
        }
    }

    override fun onError(message: String) {
        LOG.warn("Wave session error: $message")
    }

    // ── Message list: one-shot pull ───────────────────────────────

    /**
     * 拉**一页**最近的消息进 [messages] 缓存，并记下前面还有没有更早的。
     *
     * 拉的是窗口而不是整条会话：一个连续用了几周的会话，整份列表在宿主里就是几
     * 十万个 JSON 对象加上内联的 base64 图片，而宿主只拿它来推首屏那一屏。整条
     * 会话由 SDK 按窗口从转录读（翻更早、回滚各自走自己的路径）。
     *
     * webview 不再订阅全量快照推送：宿主在 webviewReady / rewind / clearChat /
     * restoreSession 之后按需拉，镜像 VSCE chatSession.getMessages。压缩不算拉取：
     * 展示流只多了一个摘要块，由 [onCompactBlockAdded] 增量追加。
     */
    suspend fun refreshMessages() {
        val agent = agent ?: return
        try {
            val res = agent.getMessages(limit = MessagePaging.FIRST_PAGE_SIZE)
            val (page, hasMore) = MessagePaging.pageOf(res)
            messages = page
            hasMoreMessages = hasMore
        } catch (e: StdioClientException) {
            LOG.warn("getMessages failed: ${e.message}")
        }
    }

    /**
     * 拉一页并推给 webview 作为「响应」（updateMessages）：推的就是缓存那一页，
     * 加上前面还有没有更早的（spec desktop-chat「首屏只进一页」）。
     */
    suspend fun pullAndPushMessages() {
        refreshMessages()
        postMessage("updateMessages", buildJsonObject {
            put("messages", messages as? JsonArray ?: JsonArray(emptyList()))
            put("hasMore", hasMoreMessages)
        })
    }

    /**
     * 上滑「翻更早」：取 [before]（列表最上面那条的 id，**排他**上锚点）之前的一页。
     *
     * **不写 [messages] 缓存**——那次是按窗口的只读查询，把它写进缓存等于把宿主
     * 手里那段历史整段丢掉。没有 agent 时返回 null，由调用方回一条错误：回空页
     * 会被页面读成「已经到底」，从此不再翻。
     */
    suspend fun getOlderMessages(before: String): Pair<JsonArray, Boolean>? {
        val agent = agent ?: return null
        val res = agent.getMessages(before = before, limit = MessagePaging.HISTORY_PAGE_SIZE)
        return MessagePaging.pageOf(res)
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
}
