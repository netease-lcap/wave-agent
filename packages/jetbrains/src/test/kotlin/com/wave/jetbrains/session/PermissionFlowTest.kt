package com.wave.jetbrains.session

import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonPrimitive
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Tests for the JB-specific ExitPlanMode handling in [PermissionFlow]: the plan preview lives in
 * the editor-area tab (right column of the chat split pane) instead of inside the confirmation
 * dialog, so the dialog shrinks to just the options row. These pure functions are the decision
 * logic behind the side-effecting [PermissionFlow.handle]; the JCEF rendering itself is exercised
 * via jb:run.
 */
class PermissionFlowTest {

    // ── 确认框变小：ExitPlanMode 的 showConfirmation payload 不含 planContent ──

    @Test
    fun `ExitPlanMode payload omits planContent so the dialog shrinks`() {
        val payload = PermissionFlow.buildConfirmationPayload(
            confirmationId = "c1",
            toolName = "ExitPlanMode",
            confirmationType = "计划待确认",
            toolInput = null,
            planContent = "# 重构方案\n\n详细计划",
            suggestedPrefix = null,
            hidePersistentOption = false,
            permissionMode = null,
        )
        assertNull(payload["planContent"], "ExitPlanMode must not send planContent to the webview")
        assertEquals("ExitPlanMode", payload["toolName"]?.jsonPrimitive?.content)
    }

    @Test
    fun `non-plan tools keep planContent in the payload`() {
        val payload = PermissionFlow.buildConfirmationPayload(
            confirmationId = "c2",
            toolName = "Bash",
            confirmationType = "命令执行待确认",
            toolInput = JsonPrimitive("ls"),
            planContent = "保留在对话框内的计划",
            suggestedPrefix = null,
            hidePersistentOption = false,
            permissionMode = null,
        )
        assertEquals(
            "保留在对话框内的计划",
            payload["planContent"]?.jsonPrimitive?.contentOrNull,
            "Bash must keep planContent (webview in-dialog preview, VS Code/desktop behavior)",
        )
    }

    @Test
    fun `confirmation metadata still present on stripped payload`() {
        val payload = PermissionFlow.buildConfirmationPayload(
            confirmationId = "c3",
            toolName = "ExitPlanMode",
            confirmationType = "计划待确认",
            toolInput = JsonPrimitive("{}"),
            planContent = "plan",
            suggestedPrefix = "改",
            hidePersistentOption = true,
            permissionMode = "plan",
        )
        assertEquals("c3", payload["confirmationId"]?.jsonPrimitive?.content)
        assertEquals("计划待确认", payload["confirmationType"]?.jsonPrimitive?.content)
        assertEquals("{}", payload["toolInput"]?.jsonPrimitive?.content)
        assertEquals("改", payload["suggestedPrefix"]?.jsonPrimitive?.content)
        assertTrue(payload["hidePersistentOption"]?.jsonPrimitive?.content?.toBoolean() == true)
        assertEquals("plan", payload["permissionMode"]?.jsonPrimitive?.content)
    }

    // ── plan 移到预览 tab：ExitPlanMode 内容路由到预览列 ──

    @Test
    fun `ExitPlanMode with content routes to the plan preview column`() {
        assertEquals("# 方案", PermissionFlow.planPreviewFor(isPlanApproval = true, planContent = "# 方案"))
    }

    @Test
    fun `ExitPlanMode with blank content shows no preview`() {
        assertNull(PermissionFlow.planPreviewFor(isPlanApproval = true, planContent = "   "))
        assertNull(PermissionFlow.planPreviewFor(isPlanApproval = true, planContent = null))
    }

    @Test
    fun `non-plan tools never route to the plan preview column`() {
        assertNull(PermissionFlow.planPreviewFor(isPlanApproval = false, planContent = "# 方案"))
    }

    @Test
    fun `isPlanApproval only matches ExitPlanMode`() {
        assertTrue(PermissionFlow.isPlanApproval("ExitPlanMode"))
        assertFalse(PermissionFlow.isPlanApproval("Bash"))
        assertFalse(PermissionFlow.isPlanApproval("EnterPlanMode"))
    }
}
