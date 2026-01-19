# Quickstart: ExitPlanMode Tool

## Overview
The `ExitPlanMode` tool is used by the agent to exit the planning phase and transition to execution. It requires user approval and offers three ways to proceed.

## Usage for Agent

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

## User Experience

When the agent calls `ExitPlanMode`, you will see:
1. The contents of the plan file.
2. A confirmation prompt with three buttons:
   - **Default**: Approve the plan and proceed with normal tool confirmations.
   - **Accept Edits**: Approve the plan and allow the agent to make edits without further confirmation.
   - **Feedback**: Deny the current plan and provide instructions for improvement.
