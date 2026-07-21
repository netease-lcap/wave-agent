package com.wave.jetbrains.stdio

import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Callbacks bridging stdio notifications to the host/webview layer.
 * Each corresponds to a server→client notification.
 */
interface AgentCallbacks {
    fun onMessagesChange(messages: JsonElement?) {}
    fun onUserMessageAdded(message: JsonElement?) {}
    fun onAssistantMessageAdded(message: JsonElement?) {}
    fun onAssistantContentUpdated(messageId: String, accumulated: String, stage: String) {}
    fun onAssistantReasoningUpdated(messageId: String, accumulated: String, stage: String) {}
    fun onToolBlockUpdated(params: JsonElement?) {}
    fun onErrorBlockAdded(error: String) {}
    fun onLoadingChange(loading: Boolean) {}
    fun onCommandRunningChange(running: Boolean) {}
    fun onQueuedMessagesChange(messages: JsonElement?) {}
    fun onTasksChange(tasks: JsonElement?) {}
    fun onSessionIdChange(sessionId: String) {}
    fun onPermissionModeChange(mode: String) {}
    fun onMcpServersChange(servers: JsonElement?) {}
    fun onPermissionRequest(requestId: String, context: JsonElement?) {}
    fun onBangMessageAdded() {}
    fun onBangMessageUpdated() {}
    fun onBangMessageCompleted() {}
    fun onNotificationMessageAdded(message: JsonObject) {}
    fun onAuthUrl(url: String) {}
    fun onError(message: String) {}
}

/**
 * Typed business wrapper over StdioClient. Caches state and routes notifications.
 * Mirrors packages/vsce/src/stdio/stdioAgent.ts.
 */
class StdioAgent(
    private val client: StdioClient,
    private val callbacks: AgentCallbacks,
) {
    @Volatile var sessionId: String? = null
        private set
    @Volatile var workingDirectory: String? = null
        private set
    @Volatile var latestTotalTokens: Int = 0
        private set
    @Volatile var permissionMode: String? = null
        private set
    @Volatile var serverVersion: String? = null
        private set

    val isDisposed get() = client.disposed

    init { registerNotifications() }

    private fun registerNotifications() {
        client.onNotification("messagesChange") { p ->
            callbacks.onMessagesChange(p?.jsonObject?.get("messages"))
        }
        client.onNotification("userMessageAdded") { p ->
            callbacks.onUserMessageAdded(p?.jsonObject?.get("message"))
        }
        client.onNotification("assistantMessageAdded") { p ->
            callbacks.onAssistantMessageAdded(p?.jsonObject?.get("message"))
        }
        client.onNotification("assistantContentUpdated") { p ->
            val o = p?.jsonObject
            callbacks.onAssistantContentUpdated(
                o?.get("messageId")?.jsonPrimitive?.content ?: "",
                o?.get("accumulated")?.jsonPrimitive?.content ?: "",
                o?.get("stage")?.jsonPrimitive?.content ?: "",
            )
        }
        client.onNotification("assistantReasoningUpdated") { p ->
            val o = p?.jsonObject
            callbacks.onAssistantReasoningUpdated(
                o?.get("messageId")?.jsonPrimitive?.content ?: "",
                o?.get("accumulated")?.jsonPrimitive?.content ?: "",
                o?.get("stage")?.jsonPrimitive?.content ?: "",
            )
        }
        client.onNotification("toolBlockUpdated") { p -> callbacks.onToolBlockUpdated(p) }
        client.onNotification("errorBlockAdded") { p ->
            callbacks.onErrorBlockAdded(p?.jsonObject?.get("error")?.jsonPrimitive?.content ?: "")
        }
        client.onNotification("loadingChange") { p ->
            val o = p?.jsonObject
            o?.get("latestTotalTokens")?.jsonPrimitive?.intOrNull?.let { latestTotalTokens = it }
            callbacks.onLoadingChange(o?.get("loading")?.jsonPrimitive?.content?.toBoolean() ?: false)
        }
        client.onNotification("commandRunningChange") { p ->
            callbacks.onCommandRunningChange(
                p?.jsonObject?.get("running")?.jsonPrimitive?.content?.toBoolean() ?: false
            )
        }
        client.onNotification("queuedMessagesChange") { p ->
            callbacks.onQueuedMessagesChange(p?.jsonObject?.get("messages"))
        }
        client.onNotification("tasksChange") { p -> callbacks.onTasksChange(p?.jsonObject?.get("tasks")) }
        client.onNotification("sessionIdChange") { p ->
            val id = p?.jsonObject?.get("sessionId")?.jsonPrimitive?.content ?: ""
            sessionId = id
            callbacks.onSessionIdChange(id)
        }
        client.onNotification("permissionModeChange") { p ->
            val mode = p?.jsonObject?.get("mode")?.jsonPrimitive?.content ?: ""
            permissionMode = mode
            callbacks.onPermissionModeChange(mode)
        }
        client.onNotification("mcpServersChange") { p -> callbacks.onMcpServersChange(p?.jsonObject?.get("servers")) }
        client.onNotification("permissionRequest") { p ->
            val o = p?.jsonObject
            callbacks.onPermissionRequest(
                o?.get("requestId")?.jsonPrimitive?.content ?: "",
                o?.get("context"),
            )
        }
        client.onNotification("bangMessageAdded") { callbacks.onBangMessageAdded() }
        client.onNotification("bangMessageUpdated") { callbacks.onBangMessageUpdated() }
        client.onNotification("bangMessageCompleted") { callbacks.onBangMessageCompleted() }
        client.onNotification("notificationMessageAdded") { p ->
            callbacks.onNotificationMessageAdded(p?.jsonObject ?: JsonObject(emptyMap()))
        }
        client.onNotification("authUrl") { p ->
            callbacks.onAuthUrl(p?.jsonObject?.get("url")?.jsonPrimitive?.content ?: "")
        }
    }

    // ── RPC requests ──────────────────────────────────────────────

    suspend fun initialize(params: JsonObject): InitializeResult {
        val res = client.request("initialize", params)?.jsonObject
            ?: throw StdioClientException("initialize returned null")
        sessionId = res["sessionId"]?.jsonPrimitive?.content
        workingDirectory = res["workingDirectory"]?.jsonPrimitive?.content
        permissionMode = res["permissionMode"]?.jsonPrimitive?.content
        res["latestTotalTokens"]?.jsonPrimitive?.intOrNull?.let { latestTotalTokens = it }
        res["serverVersion"]?.jsonPrimitive?.content?.let { serverVersion = it }
        return InitializeResult(
            sessionId = sessionId,
            workingDirectory = workingDirectory,
            permissionMode = permissionMode,
            latestTotalTokens = latestTotalTokens,
            serverVersion = serverVersion,
        )
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

    suspend fun restoreSession(sessionId: String) {
        client.request("restoreSession", buildJsonObject { put("sessionId", sessionId) }, this.sessionId)
    }

    suspend fun setPermissionMode(mode: String) {
        client.request("setPermissionMode", buildJsonObject { put("mode", mode) }, sessionId)
    }

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

    suspend fun getSlashCommands(): JsonElement? = client.request("getSlashCommands", sessionId = sessionId)

    suspend fun updateConfig(params: JsonObject) {
        client.request("updateConfig", params, sessionId)
    }

    suspend fun rewindToMessage(messageId: String): String {
        val result = client.request("rewindToMessage", buildJsonObject { put("messageId", messageId) }, sessionId)
        return result?.jsonObject?.get("inputContent")?.jsonPrimitive?.content ?: ""
    }

    suspend fun getMcpServers(): JsonElement =
        client.request("getMcpServers", sessionId = sessionId) ?: JsonObject(emptyMap())

    suspend fun connectMcpServer(serverName: String): Boolean {
        val result = client.request("connectMcpServer", buildJsonObject { put("serverName", serverName) }, sessionId)
        return result?.jsonObject?.get("success")?.jsonPrimitive?.booleanOrNull ?: false
    }

    suspend fun disconnectMcpServer(serverName: String): Boolean {
        val result = client.request("disconnectMcpServer", buildJsonObject { put("serverName", serverName) }, sessionId)
        return result?.jsonObject?.get("success")?.jsonPrimitive?.booleanOrNull ?: false
    }

    // ── RPC notification (fire-and-forget) ────────────────────────

    suspend fun sendPermissionResponse(requestId: String, decision: JsonObject) {
        client.notify("permissionResponse", buildJsonObject {
            put("requestId", requestId)
            put("decision", decision)
        }, sessionId)
    }

    // ── Utility RPCs (standalone, mirror VSCE services) ───────────

    suspend fun searchFiles(query: String, workdir: String, maxResults: Int = 20): JsonElement =
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

    suspend fun uninstallPlugin(pluginId: String, workdir: String): JsonElement =
        client.request("uninstallPlugin", buildJsonObject {
            put("pluginId", pluginId)
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

    suspend fun updatePlugin(pluginId: String, workdir: String): JsonElement =
        client.request("updatePlugin", buildJsonObject {
            put("pluginId", pluginId)
            put("workdir", workdir)
        }) ?: JsonObject(emptyMap())

    suspend fun listMarketplaces(workdir: String): JsonElement =
        client.request("listMarketplaces", buildJsonObject { put("workdir", workdir) }) ?: JsonObject(emptyMap())

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

    suspend fun login(): JsonElement =
        client.request("login") ?: JsonObject(emptyMap())

    suspend fun logout(): JsonElement =
        client.request("logout") ?: JsonObject(emptyMap())

    fun close() { client.close() }
}

data class InitializeResult(
    val sessionId: String?,
    val workingDirectory: String?,
    val permissionMode: String?,
    val latestTotalTokens: Int,
    val serverVersion: String? = null,
)

private val JsonPrimitive.intOrNull: Int? get() = content.toIntOrNull()
