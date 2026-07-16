package com.wave.jetbrains.stdio

import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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
    }

    // ── RPC requests ──────────────────────────────────────────────

    suspend fun initialize(params: JsonObject): InitializeResult {
        val res = client.request("initialize", params)?.jsonObject
            ?: throw StdioClientException("initialize returned null")
        sessionId = res["sessionId"]?.jsonPrimitive?.content
        workingDirectory = res["workingDirectory"]?.jsonPrimitive?.content
        permissionMode = res["permissionMode"]?.jsonPrimitive?.content
        res["latestTotalTokens"]?.jsonPrimitive?.intOrNull?.let { latestTotalTokens = it }
        return InitializeResult(
            sessionId = sessionId,
            workingDirectory = workingDirectory,
            permissionMode = permissionMode,
            latestTotalTokens = latestTotalTokens,
        )
    }

    suspend fun sendMessage(text: String, images: JsonElement? = null, force: Boolean = false) {
        client.request("sendMessage", buildJsonObject {
            put("text", text)
            if (images != null) put("images", images)
            if (force) put("force", true)
        })
    }

    suspend fun bang(command: String) {
        client.request("bang", buildJsonObject { put("command", command) })
    }

    suspend fun abortMessage() { client.request("abortMessage") }
    suspend fun clearMessages() { client.request("clearMessages") }

    suspend fun restoreSession(sessionId: String) {
        client.request("restoreSession", buildJsonObject { put("sessionId", sessionId) })
    }

    suspend fun setPermissionMode(mode: String) {
        client.request("setPermissionMode", buildJsonObject { put("mode", mode) })
    }

    suspend fun deleteQueuedMessage(index: Int) {
        client.request("deleteQueuedMessage", buildJsonObject { put("index", index) })
    }

    suspend fun getSlashCommands(): JsonElement? = client.request("getSlashCommands")

    suspend fun updateConfig(params: JsonObject) {
        client.request("updateConfig", params)
    }

    // ── RPC notification (fire-and-forget) ────────────────────────

    suspend fun sendPermissionResponse(requestId: String, decision: JsonObject) {
        client.notify("permissionResponse", buildJsonObject {
            put("requestId", requestId)
            put("decision", decision)
        })
    }

    fun close() { client.close() }
}

data class InitializeResult(
    val sessionId: String?,
    val workingDirectory: String?,
    val permissionMode: String?,
    val latestTotalTokens: Int,
)

private val JsonPrimitive.intOrNull: Int? get() = content.toIntOrNull()
