package com.wave.jetbrains.session

import com.intellij.openapi.diagnostic.logger
import com.wave.jetbrains.stdio.StdioClientException
import com.wave.jetbrains.util.Edt
import kotlinx.coroutines.CompletableDeferred
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put

/**
 * Permission request flow: server permissionRequest → showConfirmation (webview)
 * → confirmationResponse (user) → sendPermissionResponse (stdio).
 * Mirrors packages/vsce/src/chatProvider.ts:394-434 + messageHandler confirmationResponse.
 */
object PermissionFlow {
    private val LOG = logger<PermissionFlow>()
    private var counter = 0

    suspend fun handle(session: WaveSession, requestId: String, context: JsonElement?) {
        val ctx = context?.jsonObject
        val toolName = ctx?.get("toolName")?.jsonPrimitive?.content ?: ""
        val confirmationType = confirmationTypeFor(toolName)
        val toolInput = ctx?.get("toolInput")
        val planContent = ctx?.get("planContent")?.jsonPrimitive?.content
        val suggestedPrefix = ctx?.get("suggestedPrefix")?.jsonPrimitive?.content
        val hidePersistentOption = ctx?.get("hidePersistentOption")?.jsonPrimitive?.content?.toBoolean() ?: false

        val confirmationId = "confirmation_${System.currentTimeMillis()}_${counter++}"
        val deferred = CompletableDeferred<JsonObject>()
        session.pendingConfirmations[confirmationId] = PendingConfirmation(
            confirmationId = confirmationId,
            requestId = requestId,
            deferred = deferred,
            toolName = toolName,
            confirmationType = confirmationType,
            toolInput = toolInput,
            planContent = planContent,
        )

        Edt.invokeLater {
            session.postMessage("showConfirmation", buildJsonObject {
                put("confirmationId", confirmationId)
                put("toolName", toolName)
                put("confirmationType", confirmationType)
                if (toolInput != null) put("toolInput", toolInput)
                if (planContent != null) put("planContent", planContent)
                if (suggestedPrefix != null) put("suggestedPrefix", suggestedPrefix)
                put("hidePersistentOption", hidePersistentOption)
            })
        }

        try {
            val decision = deferred.await()
            session.agent?.sendPermissionResponse(requestId, decision)
        } catch (e: Exception) {
            LOG.warn("Permission confirmation failed: ${e.message}")
        }
    }

    /** Called when the webview sends a confirmationResponse command. */
    suspend fun resolveConfirmation(session: WaveSession, confirmationId: String, approved: Boolean, decision: JsonObject?) {
        val pending = session.pendingConfirmations.remove(confirmationId) ?: run {
            LOG.warn("No pending confirmation for id=$confirmationId")
            return
        }
        if (approved) {
            pending.deferred.complete(decision ?: buildJsonObject { put("behavior", "allow") })
        } else {
            pending.deferred.complete(buildJsonObject {
                put("behavior", "deny")
                put("message", "用户拒绝了操作")
            })
            // Reject path also aborts
            try { session.agent?.abortMessage() } catch (e: StdioClientException) {
                LOG.warn("abortMessage after deny failed: ${e.message}")
            }
        }
        Edt.invokeLater {
            session.postMessage("focusInput", JsonObject(emptyMap()))
            session.postMessage("scrollToBottom", JsonObject(emptyMap()))
        }
    }

    private fun confirmationTypeFor(toolName: String): String = when (toolName) {
        "Edit", "Write", "MultiEdit", "NotebookEdit" -> "代码修改待确认"
        "Bash", "BashOutput" -> "命令执行待确认"
        "ExitPlanMode", "EnterPlanMode" -> "计划待确认"
        "AskUserQuestion" -> "问题待回答"
        else -> "操作待确认"
    }
}
