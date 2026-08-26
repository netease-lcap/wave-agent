package com.wave.jetbrains.session

import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.wave.jetbrains.WavePanelHolder
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
 * Mirrors packages/vscode/src/chatProvider.ts:394-434 + messageHandler confirmationResponse.
 */
object PermissionFlow {
    private val LOG = logger<PermissionFlow>()
    private var counter = 0

    private const val EXIT_PLAN_MODE = "ExitPlanMode"

    suspend fun handle(project: Project, session: WaveSession, requestId: String, context: JsonElement?) {
        val ctx = context?.jsonObject
        val toolName = ctx?.get("toolName")?.jsonPrimitive?.content ?: ""
        val confirmationType = confirmationTypeFor(toolName)
        val toolInput = ctx?.get("toolInput")
        val planContent = ctx?.get("planContent")?.jsonPrimitive?.content
        val suggestedPrefix = ctx?.get("suggestedPrefix")?.jsonPrimitive?.content
        val hidePersistentOption = ctx?.get("hidePersistentOption")?.jsonPrimitive?.content?.toBoolean() ?: false
        val permissionMode = ctx?.get("permissionMode")?.jsonPrimitive?.content

        // JB: ExitPlanMode plan preview lives in the editor-area tab (right column of the chat
        // split pane), not inside the confirmation dialog. Render it before showing the compact
        // dialog and strip planContent from the webview message so the dialog shrinks to just
        // the confirmation options. VS Code/desktop keep the in-dialog preview (they still send
        // planContent through showConfirmation). See docs/specs/core/plan-mode.md.
        val isPlanApproval = isPlanApproval(toolName)
        val preview = planPreviewFor(isPlanApproval, planContent)
        if (preview != null) {
            WavePanelHolder.getInstance(project).showPlanPreview(session, preview)
        }

        val confirmationId = "confirmation_${System.currentTimeMillis()}_${counter++}"
        val deferred = CompletableDeferred<JsonObject>()
        session.pendingConfirmations[confirmationId] = PendingConfirmation(
            confirmationId = confirmationId,
            requestId = requestId,
            deferred = deferred,
            toolName = toolName,
            confirmationType = confirmationType,
            toolInput = toolInput,
            planContent = if (isPlanApproval) null else planContent,
            permissionMode = permissionMode,
        )

        Edt.invokeLater {
            session.postMessage(
                "showConfirmation",
                buildConfirmationPayload(
                    confirmationId = confirmationId,
                    toolName = toolName,
                    confirmationType = confirmationType,
                    toolInput = toolInput,
                    planContent = planContent,
                    suggestedPrefix = suggestedPrefix,
                    hidePersistentOption = hidePersistentOption,
                    permissionMode = permissionMode,
                ),
            )
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

    /** True when the tool request is an ExitPlanMode plan approval (JB renders its preview in the editor tab). */
    internal fun isPlanApproval(toolName: String): Boolean = toolName == EXIT_PLAN_MODE

    /**
     * Plan content to route to the editor-tab preview column, or null when no preview should be
     * shown. Only ExitPlanMode requests with non-blank content render a preview; other tools keep
     * their plan content (if any) inside the confirmation dialog instead.
     */
    internal fun planPreviewFor(isPlanApproval: Boolean, planContent: String?): String? =
        if (isPlanApproval) planContent?.takeIf { it.isNotBlank() } else null

    /**
     * Builds the showConfirmation payload posted to the webview. For ExitPlanMode the planContent
     * is stripped (the plan is already rendered in the editor-tab preview column), which shrinks
     * the confirmation dialog to just the options row. Other tools keep planContent in the payload
     * so the shared webview renders the in-dialog preview (VS Code/desktop behavior).
     */
    internal fun buildConfirmationPayload(
        confirmationId: String,
        toolName: String,
        confirmationType: String,
        toolInput: JsonElement?,
        planContent: String?,
        suggestedPrefix: String?,
        hidePersistentOption: Boolean,
        permissionMode: String?,
    ): JsonObject {
        val planApproval = isPlanApproval(toolName)
        return buildJsonObject {
            put("confirmationId", confirmationId)
            put("toolName", toolName)
            put("confirmationType", confirmationType)
            if (toolInput != null) put("toolInput", toolInput)
            if (!planApproval && planContent != null) put("planContent", planContent)
            if (suggestedPrefix != null) put("suggestedPrefix", suggestedPrefix)
            put("hidePersistentOption", hidePersistentOption)
            if (permissionMode != null) put("permissionMode", permissionMode)
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
