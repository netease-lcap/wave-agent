package com.wave.jetbrains.session

/**
 * Pure decision logic for the /plan command (spec plan-mode.md):
 * - Outside plan mode, bare `/plan` switches to plan mode.
 * - Outside plan mode, `/plan <描述>` also starts the plan query immediately.
 * - `/plan open` was removed on all ends (no external editor) and is treated
 *   as a bare /plan.
 * - Inside plan mode, /plan displays the current plan file contents.
 *
 * Kept as a pure function so the branching is unit-testable without an agent
 * or IDE project (mirrors PermissionFlow's pure helpers).
 */
object PlanCommand {
    sealed class Decision {
        /** Switch to plan mode only (no query). */
        object Switch : Decision()

        /** Switch to plan mode and immediately start the plan query. */
        data class Query(val description: String) : Decision()

        /** Already in plan mode — show the current plan file. */
        object Show : Decision()
    }

    fun decide(args: String?, permissionMode: String?): Decision {
        val description = args?.trim().orEmpty()
        val wantsOpen = description.split(Regex("\\s+")).firstOrNull() == "open"
        return if (permissionMode != "plan") {
            if (description.isNotEmpty() && !wantsOpen) {
                Decision.Query(description)
            } else {
                Decision.Switch
            }
        } else {
            Decision.Show
        }
    }
}
