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
    val deferred: kotlinx.coroutines.CompletableDeferred<JsonObject?>,
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
 *
 * 宿主对**消息内容**零状态：这里有的只是状态（sessionId / workdir、流式与命令运行
 * 中、待确认、任务、上下文用量），消息列表一律现取一页（[fetchInitialPage] /
 * [fetchEarlierPage]），回包交出去之后不留引用、不写字段（spec
 * ui/message-rendering-system.md「宿主不保留消息内容，用的时候现取」）。
 */
class WaveSession(
    private val project: Project,
    private val postMessageFn: (command: String, JsonObject) -> Unit,
) : AgentCallbacks {

    private val LOG = logger<WaveSession>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    @Volatile var agent: StdioAgent? = null
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

    /**
     * 会话还没建起来时用户选过的权限档位。
     *
     * `setPermissionMode` 只能打在活的会话上，会话没就绪时以前是**静默丢弃**：
     * 新对话里先切「跳过权限确认」、再发第一条消息，会话却按配置默认档建起来
     * （用户上报的现象）。这里记着，[initialize] 落地后补上。
     */
    @Volatile private var pendingPermissionMode: String? = null

    val pendingConfirmations = mutableMapOf<String, PendingConfirmation>()
    private val confirmationsMutex = Mutex()

    /** Public entry so other components (PermissionFlow, MessageHandler) can push to the webview. */
    fun postMessage(command: String, payload: JsonObject) = postMessageFn(command, payload)

    /**
     * 首启进度文案 → 面板加载态下方那一行（spec ui/stdio-transport.md「首次启动的
     * 进度文案」）。旁路：面板已经关掉、推不出去都不影响启动，也不参与任何完成条件。
     */
    private fun postStartupStage(text: String) {
        runCatching { postMessage("loadingStage", buildJsonObject { put("text", text) }) }
    }

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
        // 「这条会话是恢复出来的」：恢复的档位来源是它自己的（CLI 选项 > 配置
        // 默认档），会话就绪前选的那一档只补给**新**会话。下面「会话文件不见了」
        // 的重试其实是新会话，所以清掉这个标记。
        var restored = restoreSessionId != null
        return try {
            val backend = WaveBackendService.getInstance(project)
            // 首启进度文案（spec ui/stdio-transport.md「首次启动的进度文案」）：
            // 下载 / 安装运行时、同步 CLI 都由 backend 在 spawn 前阻塞发生，CLI 自装
            // 工具依赖在 spawn 后几百毫秒上报，两段都从这里落到面板加载态下方那一行。
            val (client, router) = backend.ensureClient { text -> postStartupStage(text) }
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
                    restored = false
                    a.initialize(retryParams)
                } else throw e
            }
            // sync sessionId
            if (a.sessionId != null && a.sessionId != sessionId) {
                sessionId = a.sessionId
            }
            permissionMode = a.permissionMode
            // 用户在会话就绪之前选过的档位补上（见 [pendingPermissionMode]）：
            // 新会话否则会按配置默认档跑第一条消息。
            pendingPermissionMode?.let { pending ->
                pendingPermissionMode = null
                if (!restored) {
                    a.setPermissionMode(pending)
                    permissionMode = pending
                }
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

    /**
     * 切换权限档位（webview 的输入框下方那个下拉）。
     *
     * 会话还没就绪（`initialize` 还在等 `wave --stdio` 起来，输入框早已能用）时
     * 只能先记着：那条 RPC 没有 sessionId 可归属。会话落地后由 [initialize] 补上。
     */
    suspend fun setPermissionMode(mode: String) {
        val a = agent
        if (a == null || a.sessionId == null) {
            pendingPermissionMode = mode
            // 输入框上的档位立刻跟着变，别让用户看不到自己点过。
            onPermissionModeChange(mode)
            return
        }
        a.setPermissionMode(mode)
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
        // summary block. Forward it like any other new message instead of pulling and
        // replacing the whole list — the host appends nothing to anything, it keeps no
        // message content at all (spec ui/message-rendering-system.md「宿主不保留消息
        // 内容，用的时候现取」场景 2).
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

    override fun onNoticeAdded(level: String, content: String) {
        postMessage("updateNoticeBlock", buildJsonObject {
            put("level", level)
            put("content", content)
        })
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

    override fun onBtwContent(question: String, content: String, type: String, requestId: String?) {
        postMessage("btwStream", buildJsonObject {
            put("question", question)
            requestId?.let { put("requestId", it) }
            put("content", content)
            put("type", type)
        })
    }

    // ── 插件 mod（spec ecosystem/plugin-mods.md「在 IDE 插件里画」）──────────
    //
    // 与桌面端共用同一批 webview 消息名（`desktopMod*` 是历史命名，webview 只认
    // 语义不认宿主）。宿主不缓存树：这里只把 CLI 的推送原样交给 webview，树由它
    // 拿到 `stale` 后自己来拉。
    override fun onModPanelUpdate(payload: JsonElement?) {
        postMessage("desktopModPanelUpdate", buildJsonObject {
            put("payload", payload ?: JsonObject(emptyMap()))
        })
    }

    override fun onModStatus(payload: JsonElement?) {
        postMessage("desktopModStatus", buildJsonObject {
            put("payload", payload ?: JsonObject(emptyMap()))
        })
    }

    override fun onModToast(payload: JsonElement?) {
        postMessage("desktopModToast", buildJsonObject {
            put("payload", payload ?: JsonObject(emptyMap()))
        })
    }

    override fun onModPromptFill(payload: JsonElement?) {
        postMessage("desktopModPromptFill", buildJsonObject {
            put("payload", payload ?: JsonObject(emptyMap()))
        })
    }

    override fun onModPromptRead(payload: JsonElement?) {
        postMessage("desktopModPromptRead", buildJsonObject {
            put("payload", payload ?: JsonObject(emptyMap()))
        })
    }

    override fun onModCopy(payload: JsonElement?) {
        postMessage("desktopModCopy", buildJsonObject {
            put("payload", payload ?: JsonObject(emptyMap()))
        })
    }

    /**
     * `$.ui.notice`（spec「工具行下面的一行」）：消息名与桌面端一致，同一份
     * webview 按这个名字收，payload 原样转发（`text: null` 由界面自己撤掉那一行）。
     * 插件端没有 pane，也就没有 paneId 可带。
     */
    override fun onModNotice(payload: JsonElement?) {
        postMessage("desktopModNotice", buildJsonObject {
            put("payload", payload ?: JsonObject(emptyMap()))
        })
    }

    override fun onPermissionRequest(requestId: String, context: JsonElement?) {
        scope.launch {
            PermissionFlow.handle(project, this@WaveSession, requestId, context)
        }
    }

    override fun onPermissionResolved(requestId: String) {
        scope.launch {
            PermissionFlow.resolveElsewhere(this@WaveSession, requestId)
        }
    }

    /**
     * `$.prompt.suggest`（spec ecosystem/plugin-mods.md「输入框里的建议与焦点」）：
     * 消息名与桌面端一致，同一份 webview 按这个名字收，payload 原样转发（里面有
     * `requestId`，回执还要用它）。插件端没有 pane，也就没有 paneId 可带。
     */
    override fun onModPromptSuggest(payload: JsonObject) {
        postMessage("desktopModPromptSuggest", buildJsonObject { put("payload", payload) })
    }

    override fun onError(message: String) {
        LOG.warn("Wave session error: $message")
    }

    // ── Message list: one-shot pull, nothing kept ─────────────────

    /**
     * 首屏那一页：最近 [FIRST_PAGE_SIZE] 条 + 「还有没有更早」。回包是原样的
     * `{ messages, hasMore, contextUsagePercent, threadSummary }`，宿主只转手。
     */
    suspend fun fetchInitialPage(): JsonObject? = fetchPage(buildJsonObject {
        put("limit", FIRST_PAGE_SIZE)
    })

    /**
     * 上翻一页更早的：锚点是当前已加载的第一条。SDK 从转录读（压缩之前的历史也读
     * 得到），宿主一个字段都不留。
     */
    suspend fun fetchEarlierPage(before: String): JsonObject? = fetchPage(buildJsonObject {
        put("before", before)
        put("limit", HISTORY_PAGE_SIZE)
    })

    /**
     * 从锚点（含锚点那条）往后取一页：滚动条刻度跳到还没加载的历史时用（spec
     * ui/transcript-outline.md「刻度覆盖整条会话」场景 17）。锚点丢了 SDK 回
     * `anchorLost`，界面按失败处理。
     */
    suspend fun fetchPageFrom(from: String): JsonObject? = fetchPage(buildJsonObject {
        put("from", from)
        put("limit", HISTORY_PAGE_SIZE)
    })

    /**
     * 整条会话的用户消息索引（只读 `id` 与文本首段）。取不到回 null，界面回落到
     * 「只画已加载的消息」这一档（同一个 spec 场景 20）。
     */
    suspend fun fetchTranscriptOutline(): JsonArray? {
        val agent = agent ?: return null
        return try {
            agent.getTranscriptOutline().jsonObject["items"] as? JsonArray
        } catch (e: Exception) {
            LOG.warn("getTranscriptOutline failed: ${e.message}")
            null
        }
    }

    private suspend fun fetchPage(window: JsonObject): JsonObject? {
        val agent = agent ?: return null
        return try {
            agent.getMessages(window).jsonObject
        } catch (e: StdioClientException) {
            LOG.warn("getMessages(window) failed: ${e.message}")
            null
        }
    }

    /**
     * 现取首屏那一页并推给 webview 作为「响应」（updateMessages）。clearChat /
     * restoreSession / 旧 CLI 的压缩兜底都走它：列表是这次响应的载荷，宿主不留引用
     * （spec ui/message-rendering-system.md「首屏一页，上翻按需取更早」）。
     *
     * 取不到就不推：界面手里那份比一个凭空来的空列表更接近真相。
     */
    suspend fun pullAndPushMessages() {
        val page = fetchInitialPage() ?: return
        val messages = page["messages"] as? JsonArray ?: JsonArray(emptyList())
        val hasEarlier = (page["hasMore"] as? JsonPrimitive)?.booleanOrNull ?: false
        postMessage("updateMessages", buildJsonObject {
            put("messages", messages)
            put("hasEarlier", hasEarlier)
        })
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

/**
 * 分页的两个条数（与 SDK 的 `constants/messageWindow.ts` 同值）：首屏一页、上翻一页。
 * 字节预算在 SDK 侧同时生效，宿主不重复实现。
 */
private const val FIRST_PAGE_SIZE = 20
private const val HISTORY_PAGE_SIZE = 200
