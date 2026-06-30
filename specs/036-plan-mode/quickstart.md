# Quickstart: Support Plan Mode

## Overview
Plan Mode allows you to safely analyze your codebase and build a plan without making any changes to your files or running commands.

## How to use

1. **Switch to plan mode**: Press `Shift+Tab` until you see "plan" in the UI.
2. **Observe Plan File Path**: A new plan file path with a random name (e.g., `~/.wave/plans/gentle-breeze.md`) will be determined.
3. **Ask the system to Plan**: The system will now be able to read your files and will start building the plan by writing to the designated plan file.
4. **Review the Plan**: You can open the plan file to see the progress as it incrementally updates the file.
5. **Switch back**: Press `Shift+Tab` to return to "default" mode when you are ready to implement the plan (unless `bypassPermissions` was enabled at start).
6. **Bypass Mode**: If the session was started with `--dangerously-skip-permissions` or `--permission-mode bypassPermissions`, `bypassPermissions` will be included in the `Shift+Tab` cycle.

---

## Exiting Plan Mode via `ExitPlanMode` Tool

The `ExitPlanMode` tool is used by the agent to exit the planning phase and transition to execution. It requires user approval and offers three ways to proceed.

### Usage for Agent

1. **Write Plan**: First, write your plan to the file specified in the system message (e.g., using `Write` or `Edit` on the plan file).
2. **Call Tool**: Call `ExitPlanMode()` without any parameters.
   ```json
   {
     "tool": "ExitPlanMode",
     "parameters": {}
   }
   ```
3. **Handle Response**:
   - If the user selects **Default** or **Accept Edits**, the tool returns a success message and you exit plan mode.
   - If the user selects **Feedback**, the tool returns the user's feedback. You should then update your plan accordingly and call `ExitPlanMode` again when ready.

### User Experience

When the agent calls `ExitPlanMode`, you will see:
1. The contents of the plan file.
2. A confirmation prompt with three buttons:
   - **Default**: Approve the plan and proceed with normal tool confirmations.
   - **Accept Edits**: Approve the plan and allow the agent to make edits without further confirmation.
   - **Feedback**: Deny the current plan and provide instructions for improvement.
