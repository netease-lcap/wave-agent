package com.wave.jetbrains.session

import com.intellij.openapi.diagnostic.logger
import com.wave.jetbrains.config.WavePluginService
import com.wave.jetbrains.stdio.StdioClientException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Dispatches webview commands → stdio RPC / local actions.
 * Mirrors packages/vsce/src/session/messageHandler.ts.
 *
 * MVP subset: webviewReady, sendMessage, clearChat, abortMessage,
 * confirmationResponse, setPermissionMode, getConfiguration,
 * updateConfiguration, updateInputContent, deleteQueuedMessage,
 * restoreSession, listSessions, requestSlashCommands.
 */
class MessageHandler(
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
            "restoreSession" -> {
                val sid = msg["sessionId"]?.jsonPrimitive?.content ?: return
                session.agent?.restoreSession(sid)
            }
            "confirmationResponse" -> {
                val confirmationId = msg["confirmationId"]?.jsonPrimitive?.content ?: return
                val approved = msg["approved"]?.jsonPrimitive?.content?.toBoolean() ?: false
                val decision = msg["decision"] as? JsonObject
                PermissionFlow.resolveConfirmation(session, confirmationId, approved, decision)
            }
            "getConfiguration" -> {
                val config = WavePluginService.getInstance().loadConfiguration()
                postMessage("configurationResponse", buildJsonObject {
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
            "updateConfiguration" -> {
                val data = msg["configurationData"]?.jsonObject ?: return
                val config = WavePluginService.getInstance().loadConfiguration().apply {
                    apiKey = data["apiKey"]?.jsonPrimitive?.content ?: ""
                    headers = data["headers"]?.jsonPrimitive?.content ?: ""
                    baseURL = data["baseURL"]?.jsonPrimitive?.content ?: ""
                    model = data["model"]?.jsonPrimitive?.content ?: ""
                    fastModel = data["fastModel"]?.jsonPrimitive?.content ?: ""
                    language = data["language"]?.jsonPrimitive?.content ?: "Chinese"
                }
                WavePluginService.getInstance().saveConfiguration(config)
                val params = buildJsonObject {
                    if (config.apiKey.isNotEmpty()) put("apiKey", config.apiKey)
                    if (config.baseURL.isNotEmpty()) put("baseURL", config.baseURL)
                    val headers = WaveSession.parseHeaders(config.headers)
                    if (headers != null) put("defaultHeaders", headers)
                    if (config.model.isNotEmpty()) put("model", config.model)
                    if (config.fastModel.isNotEmpty()) put("fastModel", config.fastModel)
                    put("language", config.language)
                }
                session.agent?.updateConfig(params)
                postMessage("configurationUpdated", JsonObject(emptyMap()))
                postMessage("focusInput", JsonObject(emptyMap()))
                postMessage("scrollToBottom", JsonObject(emptyMap()))
            }
            "updateInputContent" -> {
                session.inputContent = msg["content"]?.jsonPrimitive?.content ?: ""
            }
            "requestSlashCommands" -> handleSlashCommands()
            else -> LOG.debug("Unhandled webview command: $command")
        }
    }

    private suspend fun handleWebviewReady() {
        if (session.agent == null) {
            session.initialize()
        }
        val config = WavePluginService.getInstance().loadConfiguration()
        postMessage("setInitialState", buildJsonObject {
            put("messages", session.messages ?: JsonArray(emptyList()))
            put("tasks", session.tasks ?: JsonArray(emptyList()))
            put("inputContent", session.inputContent)
            put("isStreaming", session.isStreaming)
            put("isCommandRunning", session.isCommandRunning)
            put("sessions", JsonArray(emptyList())) // MVP: no session list
            put("configurationData", buildJsonObject {
                put("apiKey", config.apiKey)
                put("headers", config.headers)
                put("baseURL", config.baseURL)
                put("model", config.model)
                put("fastModel", config.fastModel)
                put("language", config.language)
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

    private suspend fun handleSlashCommands() {
        val agent = session.agent
        val sdkCommands: List<JsonObject> = try {
            val res = agent?.getSlashCommands()?.jsonObject
            val cmds = res?.get("commands")?.jsonArray
            cmds?.map { it.jsonObject } ?: emptyList()
        } catch (e: StdioClientException) {
            LOG.warn("getSlashCommands failed: ${e.message}")
            emptyList()
        }
        // Local UI commands (mirror VSCE's 6)
        val local = listOf(
            triple("config", "配置", "打开配置设置"),
            triple("plugin", "插件", "管理插件"),
            triple("mcp", "MCP", "管理 MCP 服务器"),
            triple("status", "状态", "查看状态信息"),
            triple("login", "登录", "登录账户"),
            triple("clear", "清除", "清除对话"),
        )
        val all = sdkCommands + local
        postMessage("slashCommandsResponse", buildJsonObject {
            put("commands", JsonArray(all))
        })
    }

    private fun triple(id: String, name: String, description: String): JsonObject = buildJsonObject {
        put("id", id)
        put("name", name)
        put("description", description)
    }
}
