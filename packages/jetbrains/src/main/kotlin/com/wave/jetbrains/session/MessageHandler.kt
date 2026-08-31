package com.wave.jetbrains.session

import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.wave.jetbrains.WaveBackendService
import com.wave.jetbrains.WavePanelHolder
import com.wave.jetbrains.bridge.PlanPreviewBuilder
import com.wave.jetbrains.config.WavePluginService
import com.wave.jetbrains.ide.IdeService
import com.wave.jetbrains.stdio.StdioClientException
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
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import java.util.Base64

/**
 * Dispatches webview commands → stdio RPC / local actions.
 * Mirrors packages/vscode/src/session/messageHandler.ts.
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
                // Pull the (now empty) list server-side and push it back as the
                // response — mirrors VSCE chatSession.clearChat (getMessages pull).
                session.pullAndPushMessages()
                postMessage("updateQueue", buildJsonObject { put("queue", JsonArray(emptyList())) })
            }
            "compact" -> {
                val customInstructions = msg["customInstructions"]?.jsonPrimitive?.content
                session.agent?.compact(customInstructions)
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
                // Pull the restored messages and push them back (no more full-snapshot
                // push from the server; the host pulls on demand — VSCE restoreSession).
                session.pullAndPushMessages()
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
                    contextLength = data["contextLength"]?.jsonPrimitive?.content?.toIntOrNull() ?: this.contextLength
                    autoMemoryEnabled = data["autoMemoryEnabled"]?.jsonPrimitive?.content?.toBoolean() ?: this.autoMemoryEnabled
                    autoMemoryFrequency = data["autoMemoryFrequency"]?.jsonPrimitive?.content?.toIntOrNull() ?: this.autoMemoryFrequency
                }
                WavePluginService.getInstance().saveConfiguration(config)
                reloadAgentConfig()
                postMessage("configurationUpdated", JsonObject(emptyMap()))
                postMessage("focusInput", JsonObject(emptyMap()))
                postMessage("scrollToBottom", JsonObject(emptyMap()))
            }
            // Settings tab (editor-area webview): open/focus it (spec 场景 10). Sent by the chat
            // webview's handleOpenSettings IDE branch (ChatApp.tsx) and by the settings tab's own
            // webview to re-focus; mirrors VSCE messageHandler.ts:139-141 → context.openSettings().
            // nav（"subagents" | "skills"）由 /agents、/skills 斜杠命令携带，随 settingsState 下发。
            "openSettings" -> WavePanelHolder.getInstance(project)
                .openSettings(msg["nav"]?.jsonPrimitive?.contentOrNull)
            // Settings tab webview close button; mirrors VSCE handleSettingsMessage → closeSettings.
            "closeSettings" -> WavePanelHolder.getInstance(project).closeSettings()
            // Settings tab「新建/编辑」预填提示词 → 关闭设置 tab 后转发给聊天 webview，
            // ChatApp 收到 prefillPrompt 后 loadDraft（spec：AI 对话框在当前会话继续）。
            "prefillPrompt" -> {
                val prompt = msg["prompt"]?.jsonPrimitive?.content ?: return
                WavePanelHolder.getInstance(project).closeSettings()
                WavePanelHolder.getInstance(project).panel?.postMessage(
                    "prefillPrompt",
                    buildJsonObject { put("prompt", prompt) },
                )
            }
            "updateInputContent" -> {
                session.inputContent = msg["content"]?.jsonPrimitive?.content ?: ""
            }
            "requestSlashCommands" -> {
                val filterText = msg["filterText"]?.jsonPrimitive?.content ?: ""
                handleSlashCommands(filterText)
            }
            "planCommand" -> {
                val args = msg["args"]?.jsonPrimitive?.content
                handlePlanCommand(args)
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
            "listRewindCheckpoints" -> handleListRewindCheckpoints()
            "getConfiguredModels" -> handleGetConfiguredModels()
            "setModel" -> {
                val model = msg["model"]?.jsonPrimitive?.content ?: return
                handleSetModel(model)
            }
            "askBtw" -> {
                val question = msg["question"]?.jsonPrimitive?.content ?: return
                handleAskBtw(question)
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
            // Read merged enabledPlugins (.wave/settings.json) for the 项目设置 tab.
            // Unlike enable/disable, this persists-only and does NOT reload the agent.
            "getProjectSettings" -> {
                val enabledPlugins = try {
                    session.agent?.getProjectSettings(currentWorkdir())?.jsonObject?.get("enabledPlugins") ?: JsonObject(emptyMap())
                } catch (e: StdioClientException) {
                    LOG.warn("getProjectSettings failed: ${e.message}")
                    JsonObject(emptyMap())
                }
                postMessage("projectSettings", buildJsonObject { put("enabledPlugins", enabledPlugins) })
            }
            // Settings page hooks read-only view: fetch scope-scoped settings.json hooks.
            "getHooksConfig" -> {
                val scope = msg["scope"]?.jsonPrimitive?.content
                val result = try {
                    session.agent?.getHooksConfig(scope, currentWorkdir())
                } catch (e: StdioClientException) {
                    LOG.warn("getHooksConfig failed: ${e.message}")
                    null
                }
                postMessage(
                    "hooksConfigResponse",
                    buildJsonObject {
                        put("scope", scope ?: "user")
                        put("hooks", result?.jsonObject?.get("hooks") ?: JsonNull)
                    },
                )
            }
            // Settings page MCP read-only view: fetch scope-scoped mcp.json config.
            // Runtime status still comes from the existing getMcpServers RPC.
            "getMcpConfig" -> {
                val scope = msg["scope"]?.jsonPrimitive?.content
                val result = try {
                    session.agent?.getMcpConfig(scope, currentWorkdir())
                } catch (e: StdioClientException) {
                    LOG.warn("getMcpConfig failed: ${e.message}")
                    null
                }
                postMessage(
                    "mcpConfigResponse",
                    buildJsonObject {
                        put("scope", scope ?: "user")
                        put("mcpServers", result?.jsonObject?.get("mcpServers") ?: JsonObject(emptyMap()))
                    },
                )
            }
            // Toggle a builtin plugin (e.g. SDD) in project settings. Same restart path as
            // handlePluginMutation: persist, then reload the agent so changes apply immediately.
            "setBuiltinPluginEnabled" -> {
                val pluginId = msg["pluginId"]?.jsonPrimitive?.content ?: return
                val enabled = msg["enabled"]?.jsonPrimitive?.content?.toBoolean() ?: false
                val scope = msg["scope"]?.jsonPrimitive?.content
                val enabledPlugins = try {
                    session.agent?.setBuiltinPluginEnabled(pluginId, enabled, currentWorkdir(), scope)?.jsonObject?.get("enabledPlugins")
                } catch (e: StdioClientException) {
                    LOG.warn("setBuiltinPluginEnabled failed: ${e.message}")
                    IdeService.showError(project, "修改项目设置失败: ${e.message}")
                    null
                }
                if (enabledPlugins != null) {
                    postMessage("projectSettings", buildJsonObject { put("enabledPlugins", enabledPlugins) })
                    reloadAgentConfig()
                }
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

            // ── AGENTS.md (memory files) ───────────────────────────────
            // VSCE messageHandler.ts → agentsContentResponse { scope, content }
            "getAgentsContent" -> {
                val scope = msg["scope"]?.jsonPrimitive?.content ?: return
                val workdir = msg["workdir"]?.jsonPrimitive?.content
                val content = try {
                    session.agent?.getAgentsContent(scope, workdir)?.jsonObject?.get("content")?.jsonPrimitive?.content ?: ""
                } catch (e: StdioClientException) {
                    LOG.warn("getAgentsContent failed: ${e.message}")
                    ""
                }
                postMessage("agentsContentResponse", buildJsonObject {
                    put("scope", scope)
                    put("content", content)
                })
            }
            // VSCE messageHandler.ts → agentsContentSaved { scope, ok }
            "setAgentsContent" -> {
                val scope = msg["scope"]?.jsonPrimitive?.content ?: return
                val content = msg["content"]?.jsonPrimitive?.content ?: ""
                val workdir = msg["workdir"]?.jsonPrimitive?.content
                val agent = session.agent
                if (agent == null) {
                    // No live agent (e.g. settings tab opened standalone without a chat session):
                    // report an honest failure instead of a false-positive ok=true no-op save.
                    postMessage("agentsContentSaved", buildJsonObject {
                        put("scope", scope)
                        put("ok", false)
                        put("error", "智能体未初始化")
                    })
                    return
                }
                try {
                    agent.setAgentsContent(scope, content, workdir)
                    postMessage("agentsContentSaved", buildJsonObject {
                        put("scope", scope)
                        put("ok", true)
                    })
                } catch (e: StdioClientException) {
                    LOG.warn("setAgentsContent failed: ${e.message}")
                    postMessage("agentsContentSaved", buildJsonObject {
                        put("scope", scope)
                        put("ok", false)
                        put("error", e.message ?: "保存失败")
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
                    put("workdir", currentWorkdir())
                    put("configurationData", buildJsonObject {
                        put("apiKey", config.apiKey)
                        put("headers", config.headers)
                        put("baseURL", config.baseURL)
                        put("model", config.model)
                        put("fastModel", config.fastModel)
                        put("language", config.language)
                        config.contextLength?.let { put("contextLength", it) }
                        config.autoMemoryEnabled?.let { put("autoMemoryEnabled", it) }
                        config.autoMemoryFrequency?.let { put("autoMemoryFrequency", it) }
                    })
                })
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
            "getSubagentConfigurations" -> {
                val configurations = try {
                    session.agent?.getSubagentConfigurations()?.jsonObject?.get("configurations") ?: JsonArray(emptyList())
                } catch (e: StdioClientException) {
                    LOG.warn("getSubagentConfigurations failed: ${e.message}")
                    JsonArray(emptyList())
                }
                postMessage("subagentConfigurationsResponse", buildJsonObject { put("configurations", configurations) })
            }
            "getSkillMetadata" -> {
                val skills = try {
                    session.agent?.getSkillMetadata()?.jsonObject?.get("skills") ?: JsonArray(emptyList())
                } catch (e: StdioClientException) {
                    LOG.warn("getSkillMetadata failed: ${e.message}")
                    JsonArray(emptyList())
                }
                postMessage("skillMetadataResponse", buildJsonObject { put("skills", skills) })
            }
            "getBackgroundTaskOutput" -> {
                val taskId = msg["taskId"]?.jsonPrimitive?.content ?: return
                val output = try {
                    session.agent?.getBackgroundTaskOutput(taskId)
                } catch (e: StdioClientException) {
                    LOG.warn("getBackgroundTaskOutput failed: ${e.message}")
                    JsonNull
                }
                postMessage("backgroundTaskOutput", buildJsonObject {
                    put("taskId", taskId)
                    put("output", output ?: JsonNull)
                })
            }
            "stopBackgroundTask" -> {
                val taskId = msg["taskId"]?.jsonPrimitive?.content ?: return
                val success = try {
                    session.agent?.stopBackgroundTask(taskId) ?: false
                } catch (e: StdioClientException) {
                    LOG.warn("stopBackgroundTask failed: ${e.message}")
                    false
                }
                postMessage("backgroundTaskStopped", buildJsonObject {
                    put("taskId", taskId)
                    put("success", success)
                })
            }
            "getWorkflowRuns" -> {
                val runs = try {
                    session.agent?.getWorkflowRuns()
                } catch (e: StdioClientException) {
                    LOG.warn("getWorkflowRuns failed: ${e.message}")
                    JsonNull
                }
                postMessage("workflowRunsResponse", buildJsonObject { put("runs", runs ?: JsonNull) })
            }
            "stopWorkflowRun" -> {
                val runId = msg["runId"]?.jsonPrimitive?.content ?: return
                val success = try {
                    session.agent?.stopWorkflowRun(runId) ?: false
                } catch (e: StdioClientException) {
                    LOG.warn("stopWorkflowRun failed: ${e.message}")
                    false
                }
                postMessage("workflowRunStopped", buildJsonObject {
                    put("runId", runId)
                    put("success", success)
                })
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
            "getMcpConfigPaths" -> {
                val paths = try {
                    session.agent?.getMcpConfigPaths()?.jsonObject
                } catch (e: StdioClientException) {
                    LOG.warn("getMcpConfigPaths failed: ${e.message}")
                    null
                }
                postMessage("mcpConfigPathsResponse", buildJsonObject {
                    put("userPath", paths?.get("userPath") ?: JsonNull)
                    put("projectPath", paths?.get("projectPath") ?: JsonNull)
                })
            }
            "removeMcpServer" -> {
                val scope = msg["scope"]?.jsonPrimitive?.content ?: return
                val name = msg["serverName"]?.jsonPrimitive?.content ?: return
                try {
                    session.agent?.removeMcpServer(scope, name)
                } catch (e: StdioClientException) {
                    LOG.warn("removeMcpServer failed: ${e.message}")
                    IdeService.showError(project, "移除 MCP 服务器失败: ${e.message}")
                }
            }
            "deleteSkill" -> {
                val name = msg["name"]?.jsonPrimitive?.content ?: return
                try {
                    session.agent?.deleteSkill(name)
                } catch (e: StdioClientException) {
                    LOG.warn("deleteSkill failed: ${e.message}")
                    IdeService.showError(project, "删除技能失败: ${e.message}")
                }
            }
            "deleteSubagent" -> {
                val name = msg["name"]?.jsonPrimitive?.content ?: return
                try {
                    session.agent?.deleteSubagent(name)
                } catch (e: StdioClientException) {
                    LOG.warn("deleteSubagent failed: ${e.message}")
                    IdeService.showError(project, "删除子代理失败: ${e.message}")
                }
            }
            "getHooksByScope" -> {
                val scope = msg["scope"]?.jsonPrimitive?.content ?: return
                val hooks = try {
                    session.agent?.getHooksByScope(scope) ?: JsonObject(emptyMap())
                } catch (e: StdioClientException) {
                    LOG.warn("getHooksByScope failed: ${e.message}")
                    JsonObject(emptyMap())
                }
                postMessage("hooksResponse", buildJsonObject { put("hooks", hooks) })
            }
            "setHookEnabled" -> {
                val scope = msg["scope"]?.jsonPrimitive?.content ?: return
                val hookName = msg["hookName"]?.jsonPrimitive?.content ?: return
                val enabled = msg["enabled"]?.jsonPrimitive?.booleanOrNull ?: return
                try {
                    session.agent?.setHookEnabled(scope, hookName, enabled)
                    val hooks = session.agent?.getHooksByScope(scope) ?: JsonObject(emptyMap())
                    postMessage("hooksResponse", buildJsonObject { put("hooks", hooks) })
                } catch (e: StdioClientException) {
                    LOG.warn("setHookEnabled failed: ${e.message}")
                    IdeService.showError(project, "更新钩子开关失败: ${e.message}")
                }
            }
            "deleteHook" -> {
                val scope = msg["scope"]?.jsonPrimitive?.content ?: return
                val hookName = msg["hookName"]?.jsonPrimitive?.content ?: return
                try {
                    session.agent?.deleteHook(scope, hookName)
                    val hooks = session.agent?.getHooksByScope(scope) ?: JsonObject(emptyMap())
                    postMessage("hooksResponse", buildJsonObject { put("hooks", hooks) })
                } catch (e: StdioClientException) {
                    LOG.warn("deleteHook failed: ${e.message}")
                    IdeService.showError(project, "删除钩子失败: ${e.message}")
                }
            }

            else -> LOG.debug("Unhandled webview command: $command")
        }
    }

    private suspend fun handleListRewindCheckpoints() {
        val checkpoints = try {
            session.agent?.listRewindCheckpoints()?.jsonObject?.get("checkpoints") ?: JsonArray(emptyList())
        } catch (e: StdioClientException) {
            LOG.warn("listRewindCheckpoints failed: ${e.message}")
            JsonArray(emptyList())
        }
        postMessage("rewindCheckpoints", buildJsonObject { put("checkpoints", checkpoints) })
    }

    private suspend fun handleGetConfiguredModels() {
        val result = try {
            session.agent?.getConfiguredModels()?.jsonObject
        } catch (e: StdioClientException) {
            LOG.warn("getConfiguredModels failed: ${e.message}")
            null
        }
        val models = result?.get("models") ?: JsonArray(emptyList())
        val currentModel = result?.get("currentModel") ?: JsonNull
        postMessage("configuredModels", buildJsonObject {
            put("models", models)
            put("currentModel", currentModel)
        })
    }

    private suspend fun handleSetModel(model: String) {
        try {
            session.agent?.setModel(model)
        } catch (e: StdioClientException) {
            LOG.warn("setModel failed: ${e.message}")
        }
    }

    // ── /btw side question: answer out-of-band, echo the question so the webview
    // can match the reply against its in-flight panel (dropping stale replies) ──
    private suspend fun handleAskBtw(question: String) {
        try {
            val answer = session.agent?.askBtw(question) ?: throw StdioClientException("智能体未初始化")
            postMessage("btwResponse", buildJsonObject {
                put("question", question)
                put("answer", answer)
            })
        } catch (e: StdioClientException) {
            LOG.warn("askBtw failed: ${e.message}", e)
            postMessage("btwError", buildJsonObject {
                put("question", question)
                put("error", e.message ?: "unknown")
            })
        }
    }

    // ── Rewind: webview already confirmed → rewind → setInitialState + focusInput + scrollToBottom ──
    private suspend fun handleRewindToMessage(messageId: String) {
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
        WaveBackendService.getInstance(project).updateAllSessionsConfig(buildConfigParams(config))
    }

    private fun currentWorkdir(): String =
        session.agent?.sessionCwd ?: session.agent?.workingDirectory ?: project.basePath ?: System.getProperty("user.dir")

    private fun pluginVersion(): String {
        // Read the <version> tag from our own META-INF/plugin.xml: the IntelliJ
        // Platform Gradle Plugin injects the build version there at package time,
        // so this avoids the platform's plugin-descriptor APIs (which became
        // @ApiStatus.Internal in 2026.2).
        val url = javaClass.classLoader.getResource("META-INF/plugin.xml") ?: return ""
        return try {
            url.openStream().use { stream ->
                stream.bufferedReader().useLines { lines ->
                    lines.firstOrNull { it.trimStart().startsWith("<version>") }
                        ?.substringAfter("<version>")?.substringBefore("</version>")?.trim() ?: ""
                }
            }
        } catch (e: Exception) {
            LOG.warn("Failed to read plugin version: ${e.message}")
            ""
        }
    }

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
                config.contextLength?.let { put("contextLength", it) }
                config.autoMemoryEnabled?.let { put("autoMemoryEnabled", it) }
                config.autoMemoryFrequency?.let { put("autoMemoryFrequency", it) }
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
            WaveBackendService.getInstance(project).initializeSession(session, null)
        }
        // Pull the real session list now that the agent is up. VSCE relies on
        // sessionIdChange to trigger listSessions, but a freshly-created session
        // may not emit that notification, so refresh explicitly here.
        session.refreshSessions()
        // Pull the full message list on demand (mirrors VSCE messageHandler.ts
        // handleWebviewReady → session.getMessages()). The server no longer pushes
        // full snapshots; the host pulls and delivers them via setInitialState.
        session.refreshMessages()
        // Refresh serverUrl + isAuthenticated from auth status before sending initial state.
        // Mirrors VSCE messageHandler.ts:622-633: without isAuthenticated the webview's
        // WelcomeView wrongly shows the login CTA to already-logged-in users (it never
        // re-requests auth status on its own), and MoreMenu hides "退出登录".
        var isAuthenticated = false
        try {
            val auth = session.agent?.getAuthStatus()?.jsonObject
            val url = (auth?.get("serverUrl") as? JsonPrimitive)?.contentOrNull ?: ""
            isAuthenticated = (auth?.get("isAuthenticated") as? JsonPrimitive)?.contentOrNull?.toBoolean() ?: false
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
            put("backgroundTasks", session.backgroundTasks ?: JsonArray(emptyList()))
            put("workflowRuns", session.workflowRuns ?: JsonArray(emptyList()))
            put("inputContent", session.inputContent)
            put("isStreaming", session.isStreaming)
            put("isCommandRunning", session.isCommandRunning)
            put("sessions", JsonArray(emptyList()))
            // Mirrors VSCE chatProvider.ts:650-656: push currentSession so the webview can
            // derive the header title (getSessionTitle guards on currentSession !== undefined)
            // and track the active session from the very first render. Without this the title
            // stays stuck on "新对话" even after the user sends a message.
            val sid = session.sessionId
            val agent = session.agent
            if (sid != null && agent != null) {
                put("session", buildJsonObject {
                    put("id", sid)
                    put("sessionType", "main")
                    put("workdir", agent.workingDirectory ?: "")
                    put("lastActiveAt", java.time.Instant.now().toString())
                    put("latestTotalTokens", agent.latestTotalTokens ?: 0)
                })
            }
            put("isAuthenticated", isAuthenticated)
            put("workdir", currentWorkdir())
            put("configurationData", buildJsonObject {
                put("apiKey", config.apiKey)
                put("headers", config.headers)
                put("baseURL", config.baseURL)
                put("model", config.model)
                put("fastModel", config.fastModel)
                put("language", config.language)
                put("serverUrl", config.serverUrl)
                config.contextLength?.let { put("contextLength", it) }
                config.autoMemoryEnabled?.let { put("autoMemoryEnabled", it) }
                config.autoMemoryFrequency?.let { put("autoMemoryFrequency", it) }
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
                    if (pc.permissionMode != null) put("permissionMode", pc.permissionMode)
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
            triple("tasks", "tasks", "查看后台任务"),
            triple("workflows", "workflows", "查看工作流运行"),
            triple("agents", "agents", "查看可用 agents"),
            triple("skills", "skills", "查看可用技能"),
            triple("clear", "clear", "清除对话历史并重置会话"),
            triple("compact", "compact", "手动压缩对话历史"),
            triple("rewind", "rewind", "回滚到之前的用户消息"),
            triple("model", "model", "切换 AI 模型"),
            triple("btw", "btw", "旁路提问（不进入聊天记录）"),
            triple("plan", "plan", "启用规划模式或查看当前方案"),
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

    /**
     * /plan command (spec plan-mode.md): delegate to [PlanCommand.decide] and
     * execute the decided action — switch to plan mode (optionally starting a
     * plan query), or fetch the current plan file via the stdio getPlanFile RPC
     * and open it in the editor-area plan tab.
     */
    private suspend fun handlePlanCommand(args: String?) {
        val agent = session.agent ?: return
        try {
            when (val decision = PlanCommand.decide(args, agent.permissionMode)) {
                is PlanCommand.Decision.Switch -> {
                    agent.setPermissionMode("plan")
                    // Bare /plan outside plan mode: mode switched; the plan tab opens
                    // on its own once ExitPlanMode delivers content via PermissionFlow.
                }
                is PlanCommand.Decision.Query -> {
                    agent.setPermissionMode("plan")
                    agent.sendMessage(decision.description)
                }
                PlanCommand.Decision.Show -> {
                    // Already in plan mode — display the current plan file contents.
                    val planFile = agent.getPlanFile()
                    val content = planFile?.jsonObject?.get("content")?.jsonPrimitive?.contentOrNull
                    if (!content.isNullOrEmpty()) {
                        WavePanelHolder.getInstance(project)
                            .showPlanPreview(session, PlanPreviewBuilder.buildHtml(content))
                    }
                }
            }
        } catch (e: StdioClientException) {
            LOG.warn("/plan failed: ${e.message}", e)
        }
    }

    private fun triple(id: String, name: String, description: String): JsonObject = buildJsonObject {
        put("id", id)
        put("name", name)
        put("description", description)
    }
}
