package com.wave.jetbrains.session

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Tests for the /plan command decision logic ([PlanCommand.decide]) — the pure
 * branching shared by the JB host's handlePlanCommand (spec plan-mode.md):
 * - `/plan` outside plan mode switches to plan mode without a query.
 * - `/plan <描述>` outside plan mode also starts the plan query.
 * - `/plan open` (removed on all ends) is treated as a bare /plan.
 * - `/plan` inside plan mode shows the current plan.
 */
class PlanCommandTest {

    @Test
    fun `bare plan outside plan mode switches to plan mode`() {
        val decision = PlanCommand.decide(args = null, permissionMode = "default")
        assertEquals(PlanCommand.Decision.Switch, decision)
    }

    @Test
    fun `empty args outside plan mode switches to plan mode`() {
        val decision = PlanCommand.decide(args = "   ", permissionMode = "default")
        assertEquals(PlanCommand.Decision.Switch, decision)
    }

    @Test
    fun `plan with description outside plan mode starts a query`() {
        val decision = PlanCommand.decide(args = "Add user auth", permissionMode = "default")
        assertEquals(PlanCommand.Decision.Query("Add user auth"), decision)
    }

    @Test
    fun `plan open is treated as a bare plan`() {
        val decision = PlanCommand.decide(args = "open", permissionMode = "default")
        assertEquals(PlanCommand.Decision.Switch, decision)
    }

    @Test
    fun `plan inside plan mode shows the current plan`() {
        val decision = PlanCommand.decide(args = null, permissionMode = "plan")
        assertTrue(decision is PlanCommand.Decision.Show)
    }

    @Test
    fun `plan with description inside plan mode still shows the current plan`() {
        // Spec: in plan mode /plan displays the current plan — a description
        // does not trigger a new query.
        val decision = PlanCommand.decide(args = "another query", permissionMode = "plan")
        assertTrue(decision is PlanCommand.Decision.Show)
    }
}
