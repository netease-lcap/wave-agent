# Data Model: Support Plan Mode

## Entities

### PermissionMode (Enum/Type)
Represents the current restriction level of the system.
- **Fields**:
  - `default`: Standard mode with manual confirmation for restricted tools.
  - `acceptEdits`: Automatically accepts file modifications in the Safe Zone.
  - `plan`: Read-only mode for the codebase, with write access only to a specific plan file.

### PermissionDecision (Interface)
The result of a user confirmation request.
- `behavior`: `'allow' | 'deny'`
- `message`: (Optional) String containing feedback if denied.
- `newPermissionMode`: (Optional) `'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'`. Specifies the target mode if allowed.

### ExitPlanMode Tool
- **Name**: `ExitPlanMode`
- **Parameters**: None
- **Output**: String (Success message or user feedback)

### PlanFile (Entity)
Represents a plan file created during Plan Mode.
- **Fields**:
  - `path`: Absolute path to the plan file (e.g., `~/.wave/plans/gentle-breeze.md`).
  - `name`: Human-readable name (adjective-noun). This name is deterministic within a session chain, generated using the `rootSessionId` as a seed.
  - `createdAt`: Timestamp of creation.

## State Transitions
- **default -> acceptEdits**: Triggered by Shift+Tab.
- **acceptEdits -> plan**: Triggered by Shift+Tab. Determines or reuses a `PlanFile` based on the `rootSessionId`.
- **plan -> default**: Triggered by Shift+Tab.
- **plan -> default**: Triggered by `ExitPlanMode` tool (User selects "Default").
- **plan -> acceptEdits**: Triggered by `ExitPlanMode` tool (User selects "Accept Edits").
- **plan -> plan**: Triggered by `ExitPlanMode` tool (User selects "Feedback").

## Validation Rules
- `ExitPlanMode` MUST NOT be called if `PermissionMode` is not `plan`.
- If `PermissionMode` is `acceptEdits`, tools like `Edit` and `Write` should skip the `canUseTool` check (or be auto-approved).
