package com.wave.jetbrains.session

import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.wave.jetbrains.config.WavePluginService
import com.wave.jetbrains.ide.IdeService
import com.wave.jetbrains.stdio.StdioClientException
import com.wave.jetbrains.update.UpdateChecker
import com.wave.jetbrains.util.Edt
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.Base64

/**
 * Dispatches webview commands → stdio RPC / local actions.
 * Mirrors packages/vsce/src/session/messageHandler.ts.
 *
 * Field names, response command names and payload structures match the VSCE implementation
 * so the shared webview bundle works unchanged.
 */
class MessageHandler(
    private val project: Project,
    private val session: WaveSession,
    private val postMessage: (command: String, JsonObject) -> Unit,
) {
    private val LOG = logger<MessageHandler>()
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /** Returns true if the command was handled. */
    fun handle(message: JsonObject): Boolean {
        val command = message["command"]?.jsonPrimitive?.content ?: return false
        scope.launch {
            try {
                dispatch(command, message)
            } catch (e: Exception) {
                LOG.warn("Handler error for '$command': ${e.message}", e)
            }
        }
        return true
    }

    private suspend fun dispatch(command: String, msg: JsonObject) {
        when (command) {
            "webviewReady" -> handleWebviewReady()
            "sendMessage" -> {
                val text = msg["text"]?.jsonPrimitive?.content ?: ""
                val force = msg["force"]?.jsonPrimitive?.content?.toBoolean() ?: false
                val images = msg["images"]
                val agent = session.agent
                if (agent != null) {
                    if (text.startsWith("!")) agent.bang(text.substring(1))
                    else agent.sendMessage(text, images, force)
                } else {
                    LOG.warn("sendMessage but session.agent is null (not initialized?)")
                }
            }
            "clearChat" -> {
                session.agent?.let {
                    it.clearMessages()
                    if (session.messageQueue != null) {
                        // abort any queued
                    }
                }
                postMessage("updateMessages", buildJsonObject { put("messages", JsonArray(emptyList())) })
                postMessage("updateQueue", buildJsonObject { put("queue", JsonArray(emptyList())) })
            }
            "abortMessage" -> session.agent?.abortMessage()
            "setPermissionMode" -> {
                val mode = msg["mode"]?.jsonPrimitive?.content ?: "default"
                session.agent?.setPermissionMode(mode)
            }
            "deleteQueuedMessage" -> {
                val index = msg["index"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
                session.agent?.deleteQueuedMessage(index)
            }
            "updateQueuedMessage" -> {
                val id = msg["id"]?.jsonPrimitive?.content ?: return
                val text = msg["text"]?.jsonPrimitive?.content ?: ""
                val images = msg["images"]
                val ok = session.agent?.updateQueuedMessage(id, text, images) ?: false
                if (!ok) {
                    postMessage("updateQueuedMessageMissing", buildJsonObject { put("id", id) })
                }
            }
            "deleteQueuedMessageById" -> {
                val id = msg["id"]?.jsonPrimitive?.content ?: return
                session.agent?.deleteQueuedMessageById(id)
            }
            "restoreSession" -> {
                val sid = msg["sessionId"]?.jsonPrimitive?.content ?: return
                session.agent?.restoreSession(sid)
                session.immediateMessagesUpdate()
            }
            "confirmationResponse" -> {
                val confirmationId = msg["confirmationId"]?.jsonPrimitive?.content ?: return
                val approved = msg["approved"]?.jsonPrimitive?.content?.toBoolean() ?: false
                val decision = msg["decision"] as? JsonObject
                PermissionFlow.resolveConfirmation(session, confirmationId, approved, decision)
            }
            "getConfiguration" -> postConfigurationResponse()
            "updateConfiguration" -> {
                val data = msg["configurationData"]?.jsonObject ?: return
                val config = WavePluginService.getInstance().loadConfiguration().apply {
                    apiKey = data["apiKey"]?.jsonPrimitive?.content ?: ""
                    headers = data["headers"]?.jsonPrimitive?.content ?: ""
                    baseURL = data["baseURL"]?.jsonPrimitive?.content ?: ""
                    model = data["model"]?.jsonPrimitive?.content ?: ""
                    fastModel = data["fastModel"]?.jsonPrimitive?.content ?: ""
                    language = data["language"]?.jsonPrimitive?.content ?: "Chinese"
                    serverUrl = data["serverUrl"]?.jsonPrimitive?.content ?: this.serverUrl
                }
                WavePluginService.getInstance().saveConfiguration(config)
                session.agent?.updateConfig(buildConfigParams(config))
                postMessage("configurationUpdated", JsonObject(emptyMap()))
                postMessage("focusInput", JsonObject(emptyMap()))
                postMessage("scrollToBottom", JsonObject(emptyMap()))
            }
            "updateInputContent" -> {
                session.inputContent = msg["content"]?.jsonPrimitive?.content ?: ""
            }
            "requestSlashCommands" -> {
                val filterText = msg["filterText"]?.jsonPrimitive?.content ?: ""
                handleSlashCommands(filterText)
            }

            // ── Session list ───────────────────────────────────────────
            // VSCE chatProvider.ts:368 → updateSessions { sessions }
            "listSessions" -> session.refreshSessions()

            // ── Rewind ─────────────────────────────────────────────────
            // VSCE :199 → modal warning, rewind, handleWebviewReady, focusInput, scrollToBottom
            "rewindToMessage" -> {
                val messageId = msg["messageId"]?.jsonPrimitive?.content ?: return
                handleRewindToMessage(messageId)
            }

            // ── Prompt history ─────────────────────────────────────────
            // VSCE :137/:171 → historyResponse { history }
            "requestHistory" -> {
                val history = try {
                    session.agent?.getPromptHistory()?.jsonObject?.get("history") ?: JsonArray(emptyList())
                } catch (e: StdioClientException) {
                    LOG.warn("getPromptHistory failed: ${e.message}")
                    postMessage("historyError", buildJsonObject { put("error", "获取历史记录失败: ${e.message}") })
                    return
                }
                postMessage("historyResponse", buildJsonObject { put("history", history) })
            }
            // VSCE :140/:185 → historyResponse { history }
            "searchHistory" -> {
                val query = msg["query"]?.jsonPrimitive?.content ?: ""
                val history = try {
                    session.agent?.searchPromptHistory(query)?.jsonObject?.get("history") ?: JsonArray(emptyList())
                } catch (e: StdioClientException) {
                    LOG.warn("searchPromptHistory failed: ${e.message}")
                    postMessage("historyError", buildJsonObject { put("error", "搜索历史记录失败: ${e.message}") })
                    return
                }
                postMessage("historyResponse", buildJsonObject { put("history", history) })
            }

            // ── File suggestions ───────────────────────────────────────
            // VSCE :61/:463 → fileSuggestionsResponse { suggestions, filterText, requestId }
            "requestFileSuggestions" -> {
                val filterText = msg["filterText"]?.jsonPrimitive?.content ?: ""
                val requestId = msg["requestId"]?.jsonPrimitive?.content ?: ""
                try {
                    val workdir = currentWorkdir()
                    val res = session.agent?.searchFiles(filterText, workdir)?.jsonObject
                    val files = res?.get("files")?.jsonArray ?: JsonArray(emptyList())
                    val items = files.map { it.jsonObject }.map { item ->
                        val relativePath = item["path"]?.jsonPrimitive?.content ?: ""
                        val fullPath = if (relativePath.isEmpty()) workdir else "$workdir/$relativePath"
                        val normalized = relativePath.trimEnd('/')
                        val name = normalized.substringAfterLast('/')
                        val isDir = item["type"]?.jsonPrimitive?.content == "directory"
                        buildJsonObject {
                            put("path", fullPath)
                            put("relativePath", relativePath)
                            put("name", name)
                            put("extension", name.substringAfterLast('.', ""))
                            put("icon", if (isDir) "codicon-folder" else "codicon-file")
                            put("isDirectory", isDir)
                        }
                    }
                    postMessage("fileSuggestionsResponse", buildJsonObject {
                        put("suggestions", JsonArray(items))
                        put("filterText", filterText)
                        put("requestId", requestId)
                    })
                } catch (e: StdioClientException) {
                    LOG.warn("requestFileSuggestions failed: ${e.message}")
                    postMessage("fileSuggestionsError", buildJsonObject {
                        put("error", "获取文件建议失败: ${e.message}")
                        put("requestId", requestId)
                    })
                }
            }

            // ── Upload files to artifacts ──────────────────────────────
            // VSCE :77/:483 → uploadSuccess { uploadedFiles, message } / uploadError { errors, message }
            "uploadFilesToArtifacts" -> {
                val files = msg["files"]?.jsonArray ?: JsonArray(emptyList())
                val uploaded = mutableListOf<IdeService.UploadedFile>()
                for (f in files) {
                    val o = f.jsonObject
                    val name = o["name"]?.jsonPrimitive?.content ?: continue
                    val dataEl = o["data"]
                    val bytes = decodeFileData(dataEl)
                    uploaded.add(IdeService.UploadedFile(name, bytes))
                }
                val result = IdeService.uploadFilesToArtifacts(uploaded)
                if (result.uploadedFiles.isNotEmpty()) {
                    postMessage("uploadSuccess", buildJsonObject {
                        put("uploadedFiles", JsonArray(result.uploadedFiles.map { JsonPrimitive(it) }))
                        put("message", "成功上传 ${result.uploadedFiles.size} 个文件到临时目录")
                    })
                }
                if (result.errors.isNotEmpty()) {
                    postMessage("uploadError", buildJsonObject {
                        put("errors", JsonArray(result.errors.map { JsonPrimitive(it) }))
                        put("message", "部分文件上传失败: ${result.errors.size} 个错误")
                    })
                }
            }

            // ── IDE actions ────────────────────────────────────────────
            // VSCE :80 → vscode.window.showErrorMessage(message)
            "showError" -> {
                val message = msg["message"]?.jsonPrimitive?.content ?: ""
                IdeService.showError(project, message)
            }
            // VSCE :83 → save dialog + write
            "downloadMermaid" -> {
                IdeService.downloadMermaid(project, msg) { cmd, payload -> postMessage(cmd, payload) }
            }
            // VSCE :128/:221 → open file + selection
            "openFile" -> IdeService.openFile(project, msg)
            // VSCE :131/:241 → preview image
            "previewImage" -> IdeService.previewImage(project, msg)
            // VSCE :133 → open external URL in system browser
            "openExternal" -> IdeService.openExternal(project, msg)

            // ── Plugins ────────────────────────────────────────────────
            // VSCE :98/:256 → listPluginsResponse { plugins }
            "listPlugins" -> {
                val plugins = try {
                    session.agent?.listPlugins(currentWorkdir())?.jsonObject?.get("plugins") ?: JsonArray(emptyList())
                } catch (e: StdioClientException) {
                    LOG.warn("listPlugins failed: ${e.message}")
                    JsonArray(emptyList())
                }
                postMessage("listPluginsResponse", buildJsonObject { put("plugins", plugins) })
            }
            // VSCE :101/:262 → install, show info, reload list, updateAllSessionsConfig
            "installPlugin" -> handlePluginMutation(msg) { id, scope ->
                session.agent?.installPlugin(id, currentWorkdir(), scope)
            }
            // VSCE :104/:276
            "enablePlugin" -> handlePluginMutation(msg) { id, scope ->
                session.agent?.enablePlugin(id, currentWorkdir(), scope)
            }
            // VSCE :107/:289
            "disablePlugin" -> handlePluginMutation(msg) { id, scope ->
                session.agent?.disablePlugin(id, currentWorkdir(), scope)
            }
            // VSCE :110/:302
            "uninstallPlugin" -> handlePluginMutation(msg) { id, _ ->
                session.agent?.uninstallPlugin(id, currentWorkdir())
            }
            // VSCE :113/:316
            "updatePlugin" -> handlePluginMutation(msg) { id, _ ->
                session.agent?.updatePlugin(id, currentWorkdir())
            }

            // ── Marketplaces ───────────────────────────────────────────
            // VSCE :116/:333 → listMarketplacesResponse { marketplaces }
            "listMarketplaces" -> {
                val marketplaces = try {
                    session.agent?.listMarketplaces(currentWorkdir()) ?: JsonObject(emptyMap())
                } catch (e: StdioClientException) {
                    LOG.warn("listMarketplaces failed: ${e.message}")
                    JsonObject(emptyMap())
                }
                postMessage("listMarketplacesResponse", buildJsonObject { put("marketplaces", marketplaces) })
            }
            // VSCE :119/:339 → add, show info, reload list
            "addMarketplace" -> {
                val input = msg["input"]?.jsonPrimitive?.content ?: return
                try {
                    session.agent?.addMarketplace(input, currentWorkdir())
                    postListMarketplaces()
                } catch (e: StdioClientException) {
                    LOG.warn("addMarketplace failed: ${e.message}")
                    IdeService.showError(project, "添加市场失败: ${e.message}")
                }
            }
            // VSCE :122/:349 → remove, reload list
            "removeMarketplace" -> {
                val name = msg["name"]?.jsonPrimitive?.content ?: return
                try {
                    session.agent?.removeMarketplace(name, currentWorkdir())
                    postListMarketplaces()
                } catch (e: StdioClientException) {
                    LOG.warn("removeMarketplace failed: ${e.message}")
                    IdeService.showError(project, "移除市场失败: ${e.message}")
                }
            }
            // VSCE :125/:358 → update, show info, reload list
            "updateMarketplace" -> {
                val name = msg["name"]?.jsonPrimitive?.content
                try {
                    session.agent?.updateMarketplace(currentWorkdir(), name)
                    postListMarketplaces()
                } catch (e: StdioClientException) {
                    LOG.warn("updateMarketplace failed: ${e.message}")
                    IdeService.showError(project, "更新市场失败: ${e.message}")
                }
            }

            // ── Auth ───────────────────────────────────────────────────
            // VSCE :143/:643 → authStatusResponse { isAuthenticated, user }
            "getAuthStatus" -> {
                val (authenticated, user, serverUrl) = try {
                    val res = session.agent?.getAuthStatus()?.jsonObject
                    val url = (res?.get("serverUrl") as? JsonPrimitive)?.contentOrNull ?: ""
                    if (url.isNotEmpty()) {
                        val merged = WavePluginService.getInstance().loadConfiguration().apply {
                            serverUrl = url
                        }
                        WavePluginService.getInstance().saveConfiguration(merged)
                        postConfigurationResponse()
                    }
                    Triple(
                        res?.get("isAuthenticated")?.jsonPrimitive?.content?.toBoolean() ?: false,
                        res?.get("user"),
                        url,
                    )
                } catch (e: StdioClientException) {
                    LOG.warn("getAuthStatus failed: ${e.message}")
                    Triple(false, null, "")
                }
                postMessage("authStatusResponse", buildJsonObject {
                    put("isAuthenticated", authenticated)
                    // VSCE sends user: null on failure; send JsonNull to match.
                    put("user", user ?: JsonNull)
                    put("serverUrl", serverUrl)
                })
            }
            // VSCE :146/:664 → loginResponse { success, user } + updateAllSessionsConfig
            "login" -> {
                try {
                    val res = session.agent?.login()?.jsonObject
                    val user = res?.get("user")
                    postMessage("loginResponse", buildJsonObject {
                        put("success", true)
                        if (user != null) put("user", user)
                    })
                    reloadAgentConfig()
                } catch (e: StdioClientException) {
                    LOG.warn("login failed: ${e.message}")
                    postMessage("loginResponse", buildJsonObject {
                        put("success", false)
                        put("error", e.message ?: "登录失败")
                    })
                }
            }
            // VSCE :149/:691 → logoutResponse { success } + updateAllSessionsConfig
            "logout" -> {
                try {
                    session.agent?.logout()
                    postMessage("logoutResponse", buildJsonObject { put("success", true) })
                    reloadAgentConfig()
                } catch (e: StdioClientException) {
                    LOG.warn("logout failed: ${e.message}")
                    postMessage("logoutResponse", buildJsonObject {
                        put("success", false)
                        put("error", e.message ?: "登出失败")
                    })
                }
            }

            // ── Status ─────────────────────────────────────────────────
            // VSCE :152/:713 → statusResponse { version, sessionId, workdir, configurationData }
            "getStatus" -> {
                val config = WavePluginService.getInstance().loadConfiguration()
                postMessage("statusResponse", buildJsonObject {
                    put("version", pluginVersion())
                    put("sessionId", session.sessionId ?: "")
                    put("workdir", session.agent?.workingDirectory ?: project.basePath ?: "")
                    put("configurationData", buildJsonObject {
                        put("apiKey", config.apiKey)
                        put("headers", config.headers)
                        put("baseURL", config.baseURL)
                        put("model", config.model)
                        put("fastModel", config.fastModel)
                        put("language", config.language)
                    })
                })
            }

            // ── Plugin update check (manual) ────────────────────────────
            // VSCE updateService.checkAndNotify; shared webview "检查更新" button.
            // Manual check bypasses the 24h cooldown (skipCooldown = true).
            "checkForUpdates" -> {
                UpdateChecker.checkAndNotify(project, skipCooldown = true)
            }

            // ── MCP servers ────────────────────────────────────────────
            // VSCE :155/:727 → mcpServersResponse { servers }
            "getMcpServers" -> {
                val servers = try {
                    session.agent?.getMcpServers()?.jsonObject?.get("servers") ?: JsonArray(emptyList())
                } catch (e: StdioClientException) {
                    LOG.warn("getMcpServers failed: ${e.message}")
                    JsonArray(emptyList())
                }
                postMessage("mcpServersResponse", buildJsonObject { put("servers", servers) })
            }
            // VSCE :158/:736 → connect; SDK onMcpServersChange pushes update
            "connectMcpServer" -> {
                val name = msg["serverName"]?.jsonPrimitive?.content ?: return
                try {
                    session.agent?.connectMcpServer(name)
                } catch (e: StdioClientException) {
                    LOG.warn("connectMcpServer failed: ${e.message}")
                    IdeService.showError(project, "连接 MCP 服务器失败: ${e.message}")
                }
            }
            // VSCE :161/:750 → disconnect; SDK onMcpServersChange pushes update
            "disconnectMcpServer" -> {
                val name = msg["serverName"]?.jsonPrimitive?.content ?: return
                try {
                    session.agent?.disconnectMcpServer(name)
                } catch (e: StdioClientException) {
                    LOG.warn("disconnectMcpServer failed: ${e.message}")
                    IdeService.showError(project, "断开 MCP 服务器失败: ${e.message}")
                }
            }

            else -> LOG.debug("Unhandled webview command: $command")
        }
    }

    // ── Rewind: modal confirm → rewind → setInitialState + focusInput + scrollToBottom ──
    private suspend fun handleRewindToMessage(messageId: String) {
        // VSCE uses a modal warning dialog; mirror with Messages.showOkCancelDialog on the EDT.
        val confirmed = confirmOnEdt(
            "确定要回滚到此消息吗？这将删除之后的所有消息并撤销相关的文件更改。",
            "回滚确认",
        )
        if (!confirmed) return
        try {
            val inputContent = session.agent?.rewindToMessage(messageId) ?: ""
            session.inputContent = inputContent
            // VSCE calls handleWebviewReady to re-push full state.
            handleWebviewReady()
            postMessage("focusInput", JsonObject(emptyMap()))
            postMessage("scrollToBottom", JsonObject(emptyMap()))
        } catch (e: StdioClientException) {
            LOG.warn("rewindToMessage failed: ${e.message}", e)
            IdeService.showError(project, "回滚失败: ${e.message}")
        }
    }

    /** Show a modal OK/Cancel dialog on the EDT and await the result. */
    private suspend fun confirmOnEdt(message: String, title: String): Boolean {
        val deferred = CompletableDeferred<Boolean>()
        Edt.invokeLater {
            val rc = Messages.showOkCancelDialog(
                project,
                message,
                title,
                Messages.getOkButton(),
                Messages.getCancelButton(),
                Messages.getWarningIcon(),
            )
            deferred.complete(rc == Messages.OK)
        }
        return deferred.await()
    }

    /**
     * Plugin install/enable/disable/uninstall/update share the same shape (VSCE :101-328):
     * run the mutation, then reload the list and push the updated config to the agent
     * (mirrors VSCE's updateAllSessionsConfig → ChatSession.updateConfig).
     */
    private suspend fun handlePluginMutation(
        msg: JsonObject,
        action: suspend (pluginId: String, scope: String?) -> JsonElement?,
    ) {
        val pluginId = msg["pluginId"]?.jsonPrimitive?.content ?: return
        val scope = msg["scope"]?.jsonPrimitive?.content
        try {
            action(pluginId, scope)
            postListPlugins()
            reloadAgentConfig()
        } catch (e: StdioClientException) {
            LOG.warn("plugin mutation failed: ${e.message}")
            IdeService.showError(project, "插件操作失败: ${e.message}")
        }
    }

    private suspend fun postListPlugins() {
        val plugins = try {
            session.agent?.listPlugins(currentWorkdir())?.jsonObject?.get("plugins") ?: JsonArray(emptyList())
        } catch (e: StdioClientException) {
            LOG.warn("listPlugins failed: ${e.message}")
            JsonArray(emptyList())
        }
        postMessage("listPluginsResponse", buildJsonObject { put("plugins", plugins) })
    }

    private suspend fun postListMarketplaces() {
        val marketplaces = try {
            session.agent?.listMarketplaces(currentWorkdir()) ?: JsonObject(emptyMap())
        } catch (e: StdioClientException) {
            LOG.warn("listMarketplaces failed: ${e.message}")
            JsonObject(emptyMap())
        }
        postMessage("listMarketplacesResponse", buildJsonObject { put("marketplaces", marketplaces) })
    }

    /**
     * Mirrors VSCE updateAllSessionsConfig(config): reload persisted config and push it to the
     * live agent so plugin/auth changes take effect.
     */
    private suspend fun reloadAgentConfig() {
        val config = WavePluginService.getInstance().loadConfiguration()
        session.agent?.updateConfig(buildConfigParams(config))
    }

    private fun currentWorkdir(): String =
        session.agent?.workingDirectory ?: project.basePath ?: System.getProperty("user.dir")

    private fun pluginVersion(): String =
        PluginManagerCore.getPlugin(PluginId.getId("com.wave.jetbrains"))?.version ?: ""

    /** Decode webview file payload → bytes. data may be a base64/data-url string (best effort). */
    private fun decodeFileData(data: JsonElement?): ByteArray {
        if (data == null) return ByteArray(0)
        val s = (data as? JsonPrimitive)?.content ?: return ByteArray(0)
        val b64 = s.substringAfter(",", s).takeIf { s.contains(",") } ?: s
        return try {
            if (b64.isEmpty()) ByteArray(0) else Base64.getDecoder().decode(b64)
        } catch (e: Exception) {
            b64.toByteArray(Charsets.UTF_8)
        }
    }

    private fun postConfigurationResponse() {
        val config = WavePluginService.getInstance().loadConfiguration()
        postMessage("configurationResponse", buildJsonObject {
            put("configurationData", buildJsonObject {
                put("apiKey", config.apiKey)
                put("headers", config.headers)
                put("baseURL", config.baseURL)
                put("model", config.model)
                put("fastModel", config.fastModel)
                put("language", config.language)
                put("serverUrl", config.serverUrl)
            })
        })
    }

    private fun buildConfigParams(config: com.wave.jetbrains.config.ConfigurationData): JsonObject = buildJsonObject {
        if (config.apiKey.isNotEmpty()) put("apiKey", config.apiKey)
        if (config.baseURL.isNotEmpty()) put("baseURL", config.baseURL)
        val headers = WaveSession.parseHeaders(config.headers)
        if (headers != null) put("defaultHeaders", headers)
        if (config.model.isNotEmpty()) put("model", config.model)
        if (config.fastModel.isNotEmpty()) put("fastModel", config.fastModel)
        put("language", config.language)
    }

    private suspend fun handleWebviewReady() {
        if (session.agent == null) {
            session.initialize()
        }
        // Pull the real session list now that the agent is up. VSCE relies on
        // sessionIdChange to trigger listSessions, but a freshly-created session
        // may not emit that notification, so refresh explicitly here.
        session.refreshSessions()
        // Refresh serverUrl from auth status before sending initial state; otherwise the
        // webview's configurationData carries a stale/empty serverUrl and the "enterprise
        // console" action silently does nothing. Mirrors VSCE handleWebviewReady.
        try {
            val url = (session.agent?.getAuthStatus()?.jsonObject?.get("serverUrl") as? JsonPrimitive)?.contentOrNull ?: ""
            if (url.isNotEmpty()) {
                val merged = WavePluginService.getInstance().loadConfiguration().apply { serverUrl = url }
                WavePluginService.getInstance().saveConfiguration(merged)
            }
        } catch (e: StdioClientException) {
            LOG.warn("getAuthStatus on webviewReady failed: ${e.message}")
        }
        val config = WavePluginService.getInstance().loadConfiguration()
        postMessage("setInitialState", buildJsonObject {
            put("messages", session.messages ?: JsonArray(emptyList()))
            put("tasks", session.tasks ?: JsonArray(emptyList()))
            put("inputContent", session.inputContent)
            put("isStreaming", session.isStreaming)
            put("isCommandRunning", session.isCommandRunning)
            put("sessions", JsonArray(emptyList()))
            put("configurationData", buildJsonObject {
                put("apiKey", config.apiKey)
                put("headers", config.headers)
                put("baseURL", config.baseURL)
                put("model", config.model)
                put("fastModel", config.fastModel)
                put("language", config.language)
                put("serverUrl", config.serverUrl)
            })
            put("permissionMode", session.permissionMode ?: "default")
            put("queuedMessages", session.messageQueue ?: JsonArray(emptyList()))
            // pending confirmations
            val confirmations = session.pendingConfirmations.values.map { pc ->
                buildJsonObject {
                    put("confirmationId", pc.confirmationId)
                    put("toolName", pc.toolName)
                    put("confirmationType", pc.confirmationType)
                    if (pc.toolInput != null) put("toolInput", pc.toolInput)
                    if (pc.planContent != null) put("planContent", pc.planContent)
                }
            }
            put("pendingConfirmations", JsonArray(confirmations))
        })
    }

    private suspend fun handleSlashCommands(filterText: String) {
        val agent = session.agent
        val sdkCommands: List<JsonObject> = try {
            val res = agent?.getSlashCommands()?.jsonObject
            val cmds = res?.get("commands")?.jsonArray
            cmds?.map { it.jsonObject } ?: emptyList()
        } catch (e: StdioClientException) {
            LOG.warn("getSlashCommands failed: ${e.message}")
            emptyList()
        }
        // Local UI commands (mirror VSCE's). name MUST be the english id — webview's
        // handleSlashCommandSelect checks `localCommands.includes(command.name)` against
        // ['config','plugin','mcp','status','clear'] to decide between opening a
        // dialog (onSendMessage(`/${name}`)) and inserting text. A non-english name falls
        // through to the text-insert branch, which is the "inserts into input instead of
        // opening a popup" bug.
        val local = listOf(
            triple("config", "config", "打开配置设置"),
            triple("plugin", "plugin", "打开插件管理"),
            triple("mcp", "mcp", "打开 MCP 服务器管理"),
            triple("status", "status", "查看当前状态"),
            triple("clear", "clear", "清除对话历史并重置会话"),
        )
        val all = sdkCommands + local
        // VSCE messageHandler.ts:618-624: filter by id/name (case-insensitive includes)
        val filtered = if (filterText.trim().isNotEmpty()) {
            val f = filterText.lowercase()
            all.filter { cmd ->
                val id = cmd["id"]?.jsonPrimitive?.content?.lowercase() ?: ""
                val name = cmd["name"]?.jsonPrimitive?.content?.lowercase() ?: ""
                id.contains(f) || name.contains(f)
            }
        } else {
            all
        }
        postMessage("slashCommandsResponse", buildJsonObject {
            put("commands", JsonArray(filtered))
        })
    }

    private fun triple(id: String, name: String, description: String): JsonObject = buildJsonObject {
        put("id", id)
        put("name", name)
        put("description", description)
    }
}
