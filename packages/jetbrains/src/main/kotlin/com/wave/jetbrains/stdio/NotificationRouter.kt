package com.wave.jetbrains.stdio

import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.util.concurrent.ConcurrentHashMap

typealias GlobalHandler = (JsonElement?) -> Unit

/**
 * Demultiplexes server→client notifications by sessionId.
 *
 * Mirrors packages/vsce/src/stdio/notificationRouter.ts. All sessions share one
 * StdioClient; the server tags each session-scoped notification with `sessionId`
 * on the JSON-RPC envelope. The router inspects that field and dispatches to the
 * matching StdioAgent; notifications without sessionId (e.g. `authUrl`) go to a
 * global handler.
 */
class NotificationRouter(private val client: StdioClient) {
    private val sessions = ConcurrentHashMap<String, StdioAgent>()
    private val globalHandlers = ConcurrentHashMap<String, GlobalHandler>()

    @Volatile
    private var attached = false

    fun attach() {
        if (attached) return
        attached = true
        for (method in ALL_NOTIFICATION_METHODS) {
            client.onNotification(method) { p, sid -> dispatch(method, p, sid) }
        }
    }

    fun register(sessionId: String, agent: StdioAgent) {
        sessions[sessionId] = agent
    }

    fun unregister(sessionId: String) {
        sessions.remove(sessionId)
    }

    fun registerGlobal(method: String, handler: GlobalHandler) {
        globalHandlers[method] = handler
    }

    private fun dispatch(method: String, params: JsonElement?, sessionId: String?) {
        if (sessionId != null) {
            val agent = sessions[sessionId] ?: return // early notification before register — drop
            if (method == "sessionIdChange") {
                val newId = params?.jsonObject?.get("sessionId")?.jsonPrimitive?.contentOrNull
                if (newId != null && newId != sessionId) {
                    sessions.remove(sessionId)
                    sessions[newId] = agent
                }
            }
            agent.handleNotification(method, params)
        } else {
            globalHandlers[method]?.invoke(params)
        }
    }

    companion object {
        private val ALL_NOTIFICATION_METHODS = listOf(
            "messagesChange",
            "userMessageAdded",
            "assistantMessageAdded",
            "assistantContentUpdated",
            "assistantReasoningUpdated",
            "toolBlockUpdated",
            "errorBlockAdded",
            "loadingChange",
            "commandRunningChange",
            "queuedMessagesChange",
            "tasksChange",
            "sessionIdChange",
            "permissionModeChange",
            "mcpServersChange",
            "workdirChange",
            "bangMessageAdded",
            "bangMessageUpdated",
            "bangMessageCompleted",
            "notificationMessageAdded",
            "permissionRequest",
            "authUrl",
            "compactBlockAdded",
        )
    }
}
