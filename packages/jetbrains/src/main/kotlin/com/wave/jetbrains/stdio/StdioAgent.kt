package com.wave.jetbrains.stdio

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Callbacks bridging stdio notifications to the host/webview layer.
 * Each corresponds to a server→client notification.
 */
interface AgentCallbacks {
    fun onUserMessageAdded(message: JsonElement?) {}
    fun onAssistantMessageAdded(message: JsonElement?) {}
    /**
     * Drop an already-rendered message: the streamed attempt it came from died
     * mid-body and was re-issued without streaming (spec:
     * 流式响应正文中途断连时降级为非流式重发).
     */
    fun onAssistantMessageDiscarded(messageId: String) {}
    fun onAssistantContentUpdated(messageId: String, chunk: String, stage: String) {}
    fun onAssistantReasoningUpdated(messageId: String, chunk: String, stage: String) {}
    fun onToolBlockUpdated(params: JsonElement?) {}
    fun onNoticeAdded(level: String, content: String) {}
    /**
     * [message] is the compact message the CLI appended to its display stream;
     * hosts append it incrementally instead of pulling the full list. Null when
     * talking to a CLI that predates the field — the host then falls back to
     * `getMessages`.
     */
    fun onCompactBlockAdded(content: String, message: JsonElement?) {}
    fun onCompactionStateChange(isCompacting: Boolean) {}
    fun onCompactionContentUpdate(content: String) {}
    /** Full plan-file content after the model writes it (spec: 计划文件更新后刷新计划面板). */
    fun onPlanFileUpdated(content: String) {}
    fun onLoadingChange(loading: Boolean) {}
    fun onContextUsage(percent: Double) {}
    fun onCommandRunningChange(running: Boolean) {}
    fun onQueuedMessagesChange(messages: JsonElement?) {}
    fun onTasksChange(tasks: JsonElement?) {}
    fun onBackgroundTasksChange(tasks: JsonElement?) {}
    fun onSessionIdChange(sessionId: String) {}
    fun onPermissionModeChange(mode: String) {}
    fun onMcpServersChange(servers: JsonElement?) {}
    fun onWorkdirChange(workdir: String) {}
    fun onPermissionRequest(requestId: String, context: JsonElement?) {}
    /**
     * 这条请求已经被**别处**答完了（手机上那一页 / 另一个宿主窗口）：撤掉还开着
     * 的那张卡，不再回包。请求只有一份、卡却每个客户端各挂一份，见 spec
     * ui/confirm-ui.md「同一条审批只有一份，谁答都算数」。
     */
    fun onPermissionResolved(requestId: String) {}
    fun onNotificationMessageAdded(message: JsonObject) {}
    fun onBtwContent(question: String, content: String, type: String, requestId: String?) {}
    /**
     * 插件 mod 的推送（spec ecosystem/plugin-mods.md「在 IDE 插件里画」）：面板
     * 元信息、带、状态行、短暂提示，以及 `$.prompt.fill` / `$.prompt.read` /
     * `$.ui.copy` 三条要界面作答的请求。载荷原样转给 webview —— 宿主不缓存树，
     * 也不解释任何一个字段。
     *
     * `$.ui.notice`（工具行下面那一行）在这一端不显示，所以没有对应回调：mod 那
     * 一侧调用不报错，只是没人画。
     */
    fun onModPanelUpdate(payload: JsonElement?) {}

    fun onModStatus(payload: JsonElement?) {}

    fun onModToast(payload: JsonElement?) {}

    fun onModPromptFill(payload: JsonElement?) {}

    fun onModPromptRead(payload: JsonElement?) {}

    fun onModCopy(payload: JsonElement?) {}

    /**
     * 一个 mod 要往输入框上方摆一条建议（`$.prompt.suggest`；spec
     * ecosystem/plugin-mods.md「输入框里的建议与焦点」）。摆不摆得上只有输入框知道，
     * 所以宿主处理完必须用 `resolveModPromptSuggest` 回执，[payload] 里的
     * `requestId` 要原样送回。
     */
    fun onModPromptSuggest(payload: JsonObject) {}

    fun onError(message: String) {}
}

/**
 * Typed business wrapper over StdioClient. Caches state and routes notifications.
 * Mirrors agent-sdk/src/stdio/stdioAgent.ts (wave-agent-sdk/host).
 */
class StdioAgent(
    private val client: StdioClient,
    private val router: NotificationRouter,
    private val callbacks: AgentCallbacks,
) {
    @Volatile var sessionId: String? = null
        private set
    /**
     * Where the shell is *now* — it moves: the workdirChange notification (bash
     * cd) rewrites it. Never use it as a session identity; that is [sessionCwd].
     */
    @Volatile var currentWorkdir: String? = null
        private set
    /**
     * Initialize-time cwd — the session's stable root. Unlike
     * [currentWorkdir] it is never overwritten by the workdirChange
     * notification (bash cd), so @file search and the /status workdir stay
     * anchored to the project root.
     */
    @Volatile var sessionCwd: String? = null
        private set
    @Volatile var latestTotalTokens: Int = 0
        private set
    /**
     * Context-usage percentage reported with the most recent [getMessages] pull.
     * A webview re-created long after the last token change receives no
     * contextUsage notification, so it replays this on webviewReady instead.
     */
    @Volatile var contextUsagePercent: Double? = null
        private set
    @Volatile var permissionMode: String? = null
        private set

    /** Scope for fire-and-forget calls the UI must not await (completion telemetry). */
    private val reportScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    fun handleNotification(method: String, params: JsonElement?) {
        when (method) {
            "userMessageAdded" -> callbacks.onUserMessageAdded(params?.jsonObject?.get("message"))
            "assistantMessageAdded" -> callbacks.onAssistantMessageAdded(params?.jsonObject?.get("message"))
            "assistantMessageDiscarded" -> callbacks.onAssistantMessageDiscarded(
                params?.jsonObject?.get("messageId")?.jsonPrimitive?.content ?: ""
            )
            "assistantContentUpdated" -> {
                val o = params?.jsonObject
                callbacks.onAssistantContentUpdated(
                    o?.get("messageId")?.jsonPrimitive?.content ?: "",
                    o?.get("chunk")?.jsonPrimitive?.content ?: "",
                    o?.get("stage")?.jsonPrimitive?.content ?: "",
                )
            }
            "assistantReasoningUpdated" -> {
                val o = params?.jsonObject
                callbacks.onAssistantReasoningUpdated(
                    o?.get("messageId")?.jsonPrimitive?.content ?: "",
                    o?.get("chunk")?.jsonPrimitive?.content ?: "",
                    o?.get("stage")?.jsonPrimitive?.content ?: "",
                )
            }
            "toolBlockUpdated" -> callbacks.onToolBlockUpdated(params)
            "noticeAdded" -> {
                val o = params?.jsonObject
                callbacks.onNoticeAdded(
                    o?.get("level")?.jsonPrimitive?.content ?: "info",
                    o?.get("content")?.jsonPrimitive?.content ?: "",
                )
            }
            "loadingChange" -> {
                val o = params?.jsonObject
                o?.get("latestTotalTokens")?.jsonPrimitive?.intOrNull?.let { latestTotalTokens = it }
                callbacks.onLoadingChange(o?.get("loading")?.jsonPrimitive?.content?.toBoolean() ?: false)
            }
            "contextUsage" -> callbacks.onContextUsage(
                params?.jsonObject?.get("percent")?.jsonPrimitive?.doubleOrNull ?: 0.0
            )
            "commandRunningChange" -> callbacks.onCommandRunningChange(
                params?.jsonObject?.get("running")?.jsonPrimitive?.content?.toBoolean() ?: false
            )
            "queuedMessagesChange" -> callbacks.onQueuedMessagesChange(params?.jsonObject?.get("messages"))
            "tasksChange" -> callbacks.onTasksChange(params?.jsonObject?.get("tasks"))
            "backgroundTasksChange" -> callbacks.onBackgroundTasksChange(params?.jsonObject?.get("tasks"))
            "sessionIdChange" -> {
                val id = params?.jsonObject?.get("sessionId")?.jsonPrimitive?.content ?: ""
                sessionId = id
                callbacks.onSessionIdChange(id)
            }
            "permissionModeChange" -> {
                val mode = params?.jsonObject?.get("mode")?.jsonPrimitive?.content ?: ""
                permissionMode = mode
                callbacks.onPermissionModeChange(mode)
            }
            "mcpServersChange" -> callbacks.onMcpServersChange(params?.jsonObject?.get("servers"))
            "workdirChange" -> {
                val workdir = params?.jsonObject?.get("workdir")?.jsonPrimitive?.content ?: ""
                currentWorkdir = workdir
                callbacks.onWorkdirChange(workdir)
            }
            "permissionRequest" -> {
                val o = params?.jsonObject
                callbacks.onPermissionRequest(
                    o?.get("requestId")?.jsonPrimitive?.content ?: "",
                    o?.get("context"),
                )
            }
            "permissionResolved" -> callbacks.onPermissionResolved(
                params?.jsonObject?.get("requestId")?.jsonPrimitive?.content ?: ""
            )
            "notificationMessageAdded" -> callbacks.onNotificationMessageAdded(params?.jsonObject ?: JsonObject(emptyMap()))
            "btwContent" -> {
                val o = params?.jsonObject
                callbacks.onBtwContent(
                    o?.get("question")?.jsonPrimitive?.content ?: "",
                    o?.get("content")?.jsonPrimitive?.content ?: "",
                    o?.get("type")?.jsonPrimitive?.content ?: "",
                    o?.get("requestId")?.jsonPrimitive?.contentOrNull,
                )
            }
            "compactBlockAdded" -> callbacks.onCompactBlockAdded(
                params?.jsonObject?.get("content")?.jsonPrimitive?.content ?: "",
                params?.jsonObject?.get("message")
            )
            "compactionStateChange" -> callbacks.onCompactionStateChange(
                params?.jsonObject?.get("isCompacting")?.jsonPrimitive?.content?.toBoolean() ?: false
            )
            "compactionContentUpdate" -> callbacks.onCompactionContentUpdate(
                params?.jsonObject?.get("content")?.jsonPrimitive?.content ?: ""
            )
            "planFileUpdated" -> callbacks.onPlanFileUpdated(
                params?.jsonObject?.get("content")?.jsonPrimitive?.content ?: ""
            )
            // 插件 mod（spec ecosystem/plugin-mods.md「在 IDE 插件里画」）：载荷
            // 就是顶层那张对象，宿主逐个转给 webview。
            "modPanelUpdate" -> callbacks.onModPanelUpdate(params)
            "modStatusUpdate" -> callbacks.onModStatus(params)
            "modToast" -> callbacks.onModToast(params)
            "modPromptFill" -> callbacks.onModPromptFill(params)
            "modPromptRead" -> callbacks.onModPromptRead(params)
            "modCopy" -> callbacks.onModCopy(params)
            // 一条建议要摆进输入框上方（`$.prompt.suggest`）：整份 payload 原样交给宿
            // 主，回执里要一字不差地送回同一个 requestId（spec「输入框里的建议与焦
            // 点」）。
            "modPromptSuggest" -> callbacks.onModPromptSuggest(params?.jsonObject ?: JsonObject(emptyMap()))
            else -> {}
        }
    }

    // ── RPC requests ──────────────────────────────────────────────

    suspend fun initialize(params: JsonObject): InitializeResult {
        val res = client.request("initialize", params)?.jsonObject
            ?: throw StdioClientException("initialize returned null")
        sessionId = res["sessionId"]?.jsonPrimitive?.content
        currentWorkdir = res["currentWorkdir"]?.jsonPrimitive?.content
        // The reply's own root wins: re-attaching a session that is still live
        // elsewhere reports its current (possibly cd-drifted) cwd as
        // `currentWorkdir`, and only `sessionCwd` says which project it is.
        sessionCwd = res["sessionCwd"]?.jsonPrimitive?.content
            ?: res["currentWorkdir"]?.jsonPrimitive?.content
        permissionMode = res["permissionMode"]?.jsonPrimitive?.content
        res["latestTotalTokens"]?.jsonPrimitive?.intOrNull?.let { latestTotalTokens = it }
        // A fresh session has no usage yet; don't let a previous session's
        // percentage survive into this agent.
        contextUsagePercent = null
        sessionId?.let { router.register(it, this) }
        return InitializeResult(
            sessionId = sessionId,
            currentWorkdir = currentWorkdir,
            permissionMode = permissionMode,
            latestTotalTokens = latestTotalTokens,
        )
    }

    suspend fun destroy() {
        sessionId?.let { router.unregister(it) }
        runCatching { client.request("destroy", sessionId = sessionId) }
    }

    suspend fun sendMessage(text: String, images: JsonElement? = null, force: Boolean = false) {
        client.request("sendMessage", buildJsonObject {
            put("text", text)
            if (images != null) put("images", images)
            if (force) put("force", true)
        }, sessionId)
    }

    suspend fun bang(command: String) {
        client.request("bang", buildJsonObject { put("command", command) }, sessionId)
    }

    suspend fun abortMessage() { client.request("abortMessage", sessionId = sessionId) }
    suspend fun clearMessages() { client.request("clearMessages", sessionId = sessionId) }

    // ── 远程控制（手机接管本机会话）────────────────────────────────
    //
    // relay 链路属于这个子进程，不属于某个会话：这三个调用是进程级的（会话在
    // 哪个进程里，就由哪个进程去连 relay），只是 JSON-RPC 信封仍需要 sessionId。
    // 三者都返回同一个快照——动作**之后**的状态，宿主原样转发给弹窗即可。
    // connect 是异步的（relay 还没答复），所以快照可以是 `connecting`。

    suspend fun remoteControlStatus(): JsonElement? =
        client.request("remoteControlStatus", sessionId = sessionId)

    /** [name] 是本机在手机上的显示名（可选）。 */
    suspend fun remoteControlConnect(name: String? = null): JsonElement? =
        client.request(
            "remoteControlConnect",
            buildJsonObject { if (name != null) put("name", name) },
            sessionId,
        )

    suspend fun remoteControlDisconnect(): JsonElement? =
        client.request("remoteControlDisconnect", sessionId = sessionId)

    /**
     * `getMessages` RPC。不带参数 = 整份列表（= 压缩后的上下文）；带 `limit` 取首屏
     * 那一页，带 `before` 上翻取更早的一页（SDK 从转录读，见 spec
     * ui/message-rendering-system.md「首屏一页，上翻按需取更早」）。
     *
     * 回包会刷新 [contextUsagePercent]：那个值在每份回包里都是当下的真值，宿主回
     * 放它靠的是最后一次读到的数。
     */
    suspend fun getMessages(window: JsonObject? = null): JsonElement {
        val res = client.request("getMessages", window, sessionId) ?: JsonObject(emptyMap())
        // Hosts replay this on webviewReady (see MessageHandler.handleWebviewReady);
        // null when the session has no usage yet, so the ring stays empty.
        contextUsagePercent =
            res.jsonObject["contextUsagePercent"]?.jsonPrimitive?.doubleOrNull
        return res
    }

    suspend fun compact(customInstructions: String? = null) {
        client.request("compact", buildJsonObject {
            if (customInstructions != null) put("customInstructions", customInstructions)
        }, sessionId)
    }

    suspend fun restoreSession(sessionId: String) {
        client.request("restoreSession", buildJsonObject { put("sessionId", sessionId) }, this.sessionId)
    }

    /**
     * 会话自定义标题（spec ui/session-management.md「会话自定义标题（重命名）」）：
     * 标题作为保留条目追加进会话自己的 JSONL 文件。工作目录用 [sessionCwd]（会话
     * 稳定根）——它不是被 bash cd 漂移过的 [currentWorkdir]，会话文件在它下面。
     */
    suspend fun renameSession(title: String) {
        client.request("renameSession", buildJsonObject {
            put("sessionId", sessionId)
            put("workdir", sessionCwd ?: currentWorkdir)
            put("title", title)
        }, sessionId)
    }

    suspend fun setPermissionMode(mode: String) {
        client.request("setPermissionMode", buildJsonObject { put("mode", mode) }, sessionId)
    }

    /**
     * Reads the session's current plan file ({ path, content } JSON). Used by
     * the /plan command to display the plan when already in plan mode; the CLI
     * side awaits the path if it is still being generated after setPermissionMode.
     */
    suspend fun getPlanFile(): JsonElement? = client.request("getPlanFile", sessionId = sessionId)

    suspend fun deleteQueuedMessage(index: Int) {
        client.request("deleteQueuedMessage", buildJsonObject { put("index", index) }, sessionId)
    }

    suspend fun updateQueuedMessage(id: String, text: String, images: JsonElement? = null): Boolean {
        val result = client.request("updateQueuedMessage", buildJsonObject {
            put("id", id)
            put("text", text)
            if (images != null) put("images", images)
        }, sessionId)
        return result?.jsonObject?.get("ok")?.jsonPrimitive?.booleanOrNull ?: false
    }

    suspend fun deleteQueuedMessageById(id: String) {
        client.request("deleteQueuedMessageById", buildJsonObject { put("id", id) }, sessionId)
    }

    /**
     * The popup's commands. `surface` tells the server which front end is asking
     * so it can append that host's local commands — the machine keeps the one
     * table (spec ui/slash-commands.md「弹窗里的宿主命令只有一份表」).
     */
    suspend fun getSlashCommands(surface: String): JsonElement? = client.request(
        "getSlashCommands",
        buildJsonObject { put("surface", surface) },
        sessionId,
    )

    suspend fun getSubagentConfigurations(): JsonElement? =
        client.request("getSubagentConfigurations", sessionId = sessionId)

    suspend fun getSkillMetadata(): JsonElement? =
        client.request("getSkillMetadata", sessionId = sessionId)

    /** `/context` 面板的取数（spec commands/context-command.md）：本会话的构成。 */
    suspend fun getContextBreakdown(): JsonElement? =
        client.request("getContextBreakdown", sessionId = sessionId)

    suspend fun updateConfig(params: JsonObject) {
        val oldSessionId = sessionId
        val result = client.request("updateConfig", params, sessionId)?.jsonObject
        val newSessionId = result?.get("sessionId")?.jsonPrimitive?.content
        if (oldSessionId != null && newSessionId != null && newSessionId != oldSessionId) {
            router.unregister(oldSessionId)
            sessionId = newSessionId
            router.register(newSessionId, this)
            // Sync the host session state: the bridge may have downgraded to a
            // fresh session (session file missing on recreate). Without this the
            // host keeps the destroyed sessionId and every later request fails
            // with "Session not found".
            callbacks.onSessionIdChange(newSessionId)
        }
    }

    suspend fun rewindToMessage(messageId: String): String {
        val result = client.request("rewindToMessage", buildJsonObject { put("messageId", messageId) }, sessionId)
        return result?.jsonObject?.get("inputContent")?.jsonPrimitive?.content ?: ""
    }

    /**
     * `/btw` side question. `history` carries the earlier side-chat turns and
     * `requestId` is echoed back on every `btwContent` notification so the
     * webview can attribute chunks to the turn that asked (spec
     * commands/btw-command.md「Webview 端继续提问」).
     */
    suspend fun askBtw(
        question: String,
        history: JsonElement?,
        requestId: String?,
        segmentId: String?,
    ): String =
        client.request(
            "askBtw",
            buildJsonObject {
                put("question", question)
                history?.let { put("history", it) }
                requestId?.let { put("requestId", it) }
                segmentId?.let { put("segmentId", it) }
            },
            sessionId,
        )?.jsonPrimitive?.content ?: ""

    /** 关闭一段侧聊：引擎侧释放冻结前缀并中止在途的那一轮（spec 场景 6）。 */
    suspend fun closeBtw(segmentId: String) {
        client.request("closeBtw", buildJsonObject { put("segmentId", segmentId) }, sessionId)
    }

    suspend fun listRewindCheckpoints(): JsonElement =
        client.request("listRewindCheckpoints", sessionId = sessionId) ?: JsonObject(emptyMap())

    suspend fun getConfiguredModels(): JsonElement =
        client.request("getConfiguredModels", sessionId = sessionId) ?: JsonObject(emptyMap())

    suspend fun setModel(model: String) {
        client.request("setModel", buildJsonObject { put("model", model) }, sessionId)
    }

    /**
     * One inline (ghost-text) completion for the editor. Session-scoped on
     * purpose: the completion model and the gateway credentials are resolved
     * inside this session, and the CLI supersedes this session's previous
     * in-flight request (spec docs/specs/ide/code-completion.md).
     */
    suspend fun getCompletion(params: JsonObject): JsonObject? =
        client.request("getCompletion", params, sessionId)?.jsonObject

    /**
     * One step of a completion suggestion's lifecycle ([outcome] = `displayed`
     * | `accepted`) for `wave.completion.outcome`. The metrics spec puts the
     * accept signal in the host's hands, and the editor must never wait on
     * telemetry: fire-and-forget, failures swallowed
     * (spec docs/specs/enterprise/opentelemetry.md「补全建议的采纳度量」).
     */
    fun reportCompletionOutcome(outcome: String) {
        reportScope.launch {
            runCatching {
                client.request(
                    "reportCompletionOutcome",
                    buildJsonObject { put("outcome", outcome) },
                    sessionId,
                )
            }
        }
    }

    /**
     * 下一步编辑建议：模型看一段编辑轨迹 + 光标附近的窗口，回答「这几行改成什么」。
     * Session-scoped 与补全同因（模型、开关、凭证都在这个会话里），同样由 CLI 端保证
     * 与补全互斥（spec docs/specs/ide/next-edit-suggestion.md 故事 5）。
     */
    suspend fun getNextEdit(params: JsonObject): JsonObject? =
        client.request("getNextEdit", params, sessionId)?.jsonObject

    /**
     * 建议生命周期的一个事件（`displayed` | `accepted`）→ `wave.next_edit.outcome`。
     * 与补全分开计，且同样不阻塞界面（spec docs/specs/enterprise/opentelemetry.md）。
     */
    fun reportNextEditOutcome(outcome: String) {
        reportScope.launch {
            runCatching {
                client.request(
                    "reportNextEditOutcome",
                    buildJsonObject { put("outcome", outcome) },
                    sessionId,
                )
            }
        }
    }

    suspend fun getMcpServers(): JsonElement =
        client.request("getMcpServers", sessionId = sessionId) ?: JsonObject(emptyMap())

    suspend fun getBackgroundTaskOutput(taskId: String): JsonElement? =
        client.request("getBackgroundTaskOutput", buildJsonObject { put("taskId", taskId) }, sessionId)?.jsonObject?.get("output")

    suspend fun stopBackgroundTask(taskId: String): Boolean {
        val result = client.request("stopBackgroundTask", buildJsonObject { put("taskId", taskId) }, sessionId)
        return result?.jsonObject?.get("success")?.jsonPrimitive?.booleanOrNull ?: false
    }

    /** 流式期间把前台任务转后台（无返回内容；mirrors vscode stdioAgent.backgroundCurrentTask）。 */
    suspend fun backgroundCurrentTask() {
        client.request("backgroundCurrentTask", sessionId = sessionId)
    }

    suspend fun getWorkflowRuns(): JsonElement? =
        client.request("getWorkflowRuns", sessionId = sessionId)?.jsonObject?.get("runs")

    suspend fun stopWorkflowRun(runId: String): Boolean {
        val result = client.request("stopWorkflowRun", buildJsonObject { put("runId", runId) }, sessionId)
        return result?.jsonObject?.get("success")?.jsonPrimitive?.booleanOrNull ?: false
    }

    // ── 插件 mod（spec ecosystem/plugin-mods.md「在 IDE 插件里画」）──────────
    //
    // 与桌面端同一套 RPC：树由 webview 自己来要（宿主不缓存），交互原样退回 CLI
    // 进程里那个 mod。Kotlin 侧只做名字表与转发，字段一个都不解释。

    /**
     * 要一棵面板的树。`layout` 是「这一端把它摆在哪、有多大」：`placement` /
     * `bodyColumns` 进 `e.props`，`columns` / `rows` / `isFullscreen` 进
     * `e.viewport`。这些都只有画它的那一端知道，所以随请求一起上来，宿主不解释。
     */
    suspend fun renderModPanel(modId: String, paneId: String, layout: JsonObject? = null): JsonElement? =
        client.request("modPanelRender", buildJsonObject {
            put("modId", modId)
            put("paneId", paneId)
            layout?.forEach { (key, value) -> put(key, value) }
        }, sessionId)

    /**
     * 要输入框上方那条带的树（整表快照，没返回的 mod 这一帧没内容）。`metrics`
     * 与面板同一条口径：webview 量到的字符宽高，缺的就缺着。
     */
    suspend fun renderModBand(metrics: JsonObject = JsonObject(emptyMap())): JsonElement =
        client.request("modBandRender", metrics, sessionId) ?: JsonArray(emptyList())

    /** 当前所有 mod 面板的快照（webview 重建后补画面板用，spec「生命周期」）。 */
    suspend fun getModPanels(): JsonElement =
        client.request("getModPanels", JsonObject(emptyMap()), sessionId) ?: JsonArray(emptyList())

    /** 面板/带里的一次交互：原样交回 mod。 */
    suspend fun sendModPanelEvent(payload: JsonObject) {
        client.request("modPanelEvent", payload, sessionId)
    }

    /** 回答一次 `$.prompt.fill`：草稿落没落地。 */
    suspend fun resolveModPromptFill(requestId: String, filled: Boolean) {
        client.request("modPromptFillResult", buildJsonObject {
            put("requestId", requestId)
            put("filled", filled)
        }, sessionId)
    }

    /** 回答一次 `$.prompt.read`：输入框**此刻**的内容与光标位置。 */
    suspend fun resolveModPromptRead(requestId: String, text: String, cursor: Int) {
        client.request("modPromptReadResult", buildJsonObject {
            put("requestId", requestId)
            put("text", text)
            put("cursor", cursor)
        }, sessionId)
    }

    /**
     * 回答一次 `$.ui.copy`。写不进去也是答案：`isCopied = false` 带一句 `reason`
     * （`no-clipboard` / `refused`），mod 据此换一种交付方式。
     */
    suspend fun resolveModCopy(requestId: String, isCopied: Boolean, reason: String?) {
        client.request("modCopyResult", buildJsonObject {
            put("requestId", requestId)
            put("isCopied", isCopied)
            if (reason != null) put("reason", reason)
        }, sessionId)
    }

    suspend fun connectMcpServer(serverName: String): Boolean {
        val result = client.request("connectMcpServer", buildJsonObject { put("serverName", serverName) }, sessionId)
        return result?.jsonObject?.get("success")?.jsonPrimitive?.booleanOrNull ?: false
    }

    suspend fun disconnectMcpServer(serverName: String): Boolean {
        val result = client.request("disconnectMcpServer", buildJsonObject { put("serverName", serverName) }, sessionId)
        return result?.jsonObject?.get("success")?.jsonPrimitive?.booleanOrNull ?: false
    }

    suspend fun getMcpConfigPaths(): JsonElement =
        client.request("getMcpConfigPaths", sessionId = sessionId) ?: JsonObject(emptyMap())

    suspend fun removeMcpServer(scope: String, serverName: String): Boolean {
        val result = client.request("removeMcpServer", buildJsonObject {
            put("scope", scope)
            put("serverName", serverName)
        }, sessionId)
        return result?.jsonObject?.get("success")?.jsonPrimitive?.booleanOrNull ?: false
    }

    suspend fun deleteSkill(name: String): Boolean {
        val result = client.request("deleteSkill", buildJsonObject { put("name", name) }, sessionId)
        return result?.jsonObject?.get("success")?.jsonPrimitive?.booleanOrNull ?: false
    }

    suspend fun deleteSubagent(name: String): Boolean {
        val result = client.request("deleteSubagent", buildJsonObject { put("name", name) }, sessionId)
        return result?.jsonObject?.get("success")?.jsonPrimitive?.booleanOrNull ?: false
    }

    suspend fun getHooksByScope(scope: String): JsonElement =
        client.request("getHooksByScope", buildJsonObject { put("scope", scope) }, sessionId) ?: JsonObject(emptyMap())

    suspend fun deleteHook(scope: String, hookName: String) {
        client.request("deleteHook", buildJsonObject {
            put("scope", scope)
            put("hookName", hookName)
        }, sessionId)
    }

    // ── Plugin mods: 输入框里的建议与焦点 ─────────────────────────
    //
    // 三条通道里只有 `modPromptSuggest` 是 CLI 推、宿主答；另外两条是宿主推、CLI
    // 答（spec ecosystem/plugin-mods.md「输入框里的建议与焦点」）。事件对象按
    // JsonObject 收整份：`key` 在协议里是 `unknown`（可能是一整串按键），写成具体
    // 类型只能靠 JsonElement，那还不如让调用方自己拼。

    /**
     * 用户在输入框里做完一次编辑。与其余 mod 通道方向相反：宿主先说话，返回的是插件
     * 改写后的 `{ text, cursor }`。没有 mod 接这条钩子时，答案就是「把这次编辑应用
     * 上去」，所以界面拿回包直接回填即可，不必自己再算一遍。
     */
    suspend fun promptEdit(event: JsonObject): JsonObject? =
        client.request("promptEdit", event, sessionId)?.jsonObject

    /**
     * 回答一次 `$.prompt.suggest`：建议摆没摆上只有输入框知道。会话已经不认这个
     * `requestId`（超时已按 `{ isShown: false }` 收尾）时什么也不会发生。
     */
    suspend fun resolveModPromptSuggest(requestId: String, isShown: Boolean) {
        client.request("modPromptSuggestResult", buildJsonObject {
            put("requestId", requestId)
            put("isShown", isShown)
        }, sessionId)
    }

    // ── RPC notification (fire-and-forget) ────────────────────────

    suspend fun sendPermissionResponse(requestId: String, decision: JsonObject) {
        client.notify("permissionResponse", buildJsonObject {
            put("requestId", requestId)
            put("decision", decision)
        }, sessionId)
    }

    // ── Utility RPCs (standalone, mirror VSCE services) ───────────

    suspend fun searchFiles(query: String, workdir: String, maxResults: Int = 50): JsonElement =
        client.request("searchFiles", buildJsonObject {
            put("query", query)
            put("maxResults", maxResults)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    suspend fun listSessions(workdir: String): JsonElement =
        client.request("listSessions", buildJsonObject { put("workdir", workdir) }) ?: JsonObject(emptyMap())

    suspend fun getPromptHistory(): JsonElement =
        client.request("getPromptHistory") ?: JsonObject(emptyMap())

    suspend fun searchPromptHistory(query: String): JsonElement =
        client.request("searchPromptHistory", buildJsonObject { put("query", query) }) ?: JsonObject(emptyMap())

    suspend fun listPlugins(workdir: String): JsonElement =
        client.request("listPlugins", buildJsonObject { put("workdir", workdir) }) ?: JsonObject(emptyMap())

    suspend fun installPlugin(pluginId: String, workdir: String, scope: String? = null): JsonElement =
        client.request("installPlugin", buildJsonObject {
            put("pluginId", pluginId)
            if (scope != null) put("scope", scope)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    suspend fun uninstallPlugin(pluginId: String, workdir: String, scope: String? = null): JsonElement =
        client.request("uninstallPlugin", buildJsonObject {
            put("pluginId", pluginId)
            if (scope != null) put("scope", scope)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    suspend fun enablePlugin(pluginId: String, workdir: String, scope: String? = null): JsonElement =
        client.request("enablePlugin", buildJsonObject {
            put("pluginId", pluginId)
            if (scope != null) put("scope", scope)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    suspend fun disablePlugin(pluginId: String, workdir: String, scope: String? = null): JsonElement =
        client.request("disablePlugin", buildJsonObject {
            put("pluginId", pluginId)
            if (scope != null) put("scope", scope)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    suspend fun getProjectSettings(workdir: String): JsonElement =
        client.request("getProjectSettings", buildJsonObject { put("workdir", workdir) }) ?: JsonObject(emptyMap())

    suspend fun getHooksConfig(scope: String?, workdir: String): JsonElement =
        client.request("getHooksConfig", buildJsonObject {
            if (scope != null) put("scope", scope)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    suspend fun getMcpConfig(scope: String?, workdir: String): JsonElement =
        client.request("getMcpConfig", buildJsonObject {
            if (scope != null) put("scope", scope)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    suspend fun setBuiltinPluginEnabled(pluginId: String, enabled: Boolean, workdir: String, scope: String? = null): JsonElement =
        client.request("setBuiltinPluginEnabled", buildJsonObject {
            put("pluginId", pluginId)
            put("enabled", enabled)
            if (scope != null) put("scope", scope)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    suspend fun updatePlugin(pluginId: String, workdir: String): JsonElement =
        client.request("updatePlugin", buildJsonObject {
            put("pluginId", pluginId)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    /** 更换安装作用域（设置页插件市场）：清各作用域启用记录后在目标作用域启用。 */
    suspend fun setPluginScope(pluginId: String, scope: String, workdir: String): JsonElement =
        client.request("setPluginScope", buildJsonObject {
            put("pluginId", pluginId)
            put("scope", scope)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    /**
     * 插件就地重载（spec plugin「插件变更的就地重载」）：宿主把磁盘上的插件状态换装进
     * 当前 CLI 进程内的全部 live 会话，不重建 agent。返回 { plugins, failures }。
     */
    suspend fun reloadPlugins(): JsonElement =
        client.request("reloadPlugins", JsonObject(emptyMap())) ?: JsonObject(emptyMap())

    suspend fun listMarketplaces(workdir: String): JsonElement =
        client.request("listMarketplaces", buildJsonObject { put("workdir", workdir) }) ?: JsonObject(emptyMap())

    /** 刷新各市场检出（只拉清单、不升级插件）：打开插件市场界面时后台调用。 */
    suspend fun refreshMarketplaces(workdir: String): JsonElement =
        client.request("refreshMarketplaces", buildJsonObject { put("workdir", workdir) }) ?: JsonObject(emptyMap())

    suspend fun addMarketplace(input: String, workdir: String): JsonElement =
        client.request("addMarketplace", buildJsonObject {
            put("input", input)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    suspend fun removeMarketplace(name: String, workdir: String): JsonElement =
        client.request("removeMarketplace", buildJsonObject {
            put("name", name)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    suspend fun updateMarketplace(workdir: String, name: String? = null): JsonElement =
        client.request("updateMarketplace", buildJsonObject {
            if (name != null) put("name", name)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    suspend fun getAuthStatus(): JsonElement =
        client.request("getAuthStatus") ?: JsonObject(emptyMap())

    /**
     * 读某一档记忆文件（设置页三档编辑器）。`sessionId` 随请求信封下发（见
     * [com.wave.jetbrains.stdio.StdioClient.request] 的第三参）：CLI 凭它把请求落到
     * 这个 live agent 上，走的才是 agent 的记忆服务；不带时 CLI 退回直读磁盘。
     */
    suspend fun getAgentsContent(scope: String, workdir: String? = null): JsonElement =
        client.request("getAgentsContent", buildJsonObject {
            put("scope", scope)
            if (workdir != null) put("workdir", workdir)
        }, sessionId) ?: JsonObject(emptyMap())

    /**
     * 写某一档记忆文件。会话 id 是**缓存失效的前提**：带 sessionId 时 CLI 走
     * `agent.writeLocalMemoryContent(...)` → `MemoryService` 清
     * `_cachedLocalMemory` / `_cachedCombinedMemory`，当前会话下一轮注入的就是新内容
     * （spec memory-management「设置页三档记忆编辑器」场景 3）；不带时只直写文件，
     * 缓存一个字不动，用户要换会话才看得到。
     *
     * [expectedHash] 是并发保护的**三态**令牌，三态在 JSON 层必须可区分：
     * 字符串 = 编辑时读到的内容 hash；`JsonNull` = 编辑时文件还不存在（此后磁盘上
     * 出现文件也算冲突）；`null`（Kotlin 的 null，即调用方不传）= 不发这个字段 =
     * 不校验。所以这里只能按 `!= null` 判断「要不要写 key」，绝不能把 `JsonNull`
     * 当成「没有值」吞掉。
     */
    suspend fun setAgentsContent(
        scope: String,
        content: String,
        workdir: String? = null,
        expectedHash: JsonElement? = null,
    ): JsonElement =
        client.request("setAgentsContent", buildJsonObject {
            put("scope", scope)
            put("content", content)
            if (workdir != null) put("workdir", workdir)
            if (expectedHash != null) put("expectedHash", expectedHash)
        }, sessionId) ?: JsonObject(emptyMap())

    suspend fun login(): JsonElement =
        client.request("login") ?: JsonObject(emptyMap())

    suspend fun logout(): JsonElement =
        client.request("logout") ?: JsonObject(emptyMap())

    /**
     * Global (session-less) RPCs — user preferences and the memory files.
     *
     * They live on the companion object rather than in the instance method table
     * above because every method up there is reached through a live agent, while
     * these are deliberately independent of any session: the settings tab must
     * read/write `~/.wave/settings.json` and the three `AGENTS.md` tiers through
     * the shared CLI process even when no chat session exists (it is opened
     * before any session — spec memory-management「设置页三档记忆编辑器」场景 5).
     * Without a session id the CLI answers memory RPCs by reading/writing the
     * file directly, which is the same fallback desktop and VS Code rely on.
     * They still belong here so the host never hand-writes a stdio RPC name —
     * this file is the method table.
     */
    companion object {
        /** Read user-level preferences (`~/.wave/settings.json`), effective values. */
        suspend fun getUserSettings(client: StdioClient): JsonObject =
            client.request("getUserSettings")?.jsonObject ?: JsonObject(emptyMap())

        /** Write user-level preferences; the caller decides which keys may land. */
        suspend fun updateUserSettings(client: StdioClient, patch: JsonObject) {
            client.request("updateUserSettings", patch)
        }

        /** Read a memory tier with no live session (settings tab opened first).
         *  The reply carries the read state (`exists` / `readable` / `hash` /
         *  `error`) — returned whole so the caller can forward it untouched. */
        suspend fun readAgentsContent(client: StdioClient, scope: String, workdir: String?): JsonObject =
            client.request("getAgentsContent", buildJsonObject {
                put("scope", scope)
                if (workdir != null) put("workdir", workdir)
            })?.jsonObject ?: JsonObject(emptyMap())

        /** Write a memory tier with no live session (no cache to invalidate).
         *  [expectedHash] keeps the same three states as the instance method:
         *  missing key = no check, `JsonNull` = "the file did not exist", string
         *  = the hash the editor read. */
        suspend fun writeAgentsContent(
            client: StdioClient,
            scope: String,
            content: String,
            workdir: String?,
            expectedHash: JsonElement?,
        ): JsonObject = client.request("setAgentsContent", buildJsonObject {
            put("scope", scope)
            put("content", content)
            if (workdir != null) put("workdir", workdir)
            if (expectedHash != null) put("expectedHash", expectedHash)
        })?.jsonObject ?: JsonObject(emptyMap())
    }
}

data class InitializeResult(
    val sessionId: String?,
    val currentWorkdir: String?,
    val permissionMode: String?,
    val latestTotalTokens: Int,
)

private val JsonPrimitive.intOrNull: Int? get() = content.toIntOrNull()
