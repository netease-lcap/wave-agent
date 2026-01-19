# Data Model: ExitPlanMode Tool

## Entities

### PermissionMode (Enum/Type)
Represents the current operational mode of the agent regarding permissions.
- `default`: Standard mode with user confirmation for sensitive tools.
- `plan`: Restricted mode where only certain tools are allowed, primarily for planning.
- `acceptEdits`: Mode where edit-related tools are automatically approved.

### PermissionDecision (Interface)
The result of a user confirmation request.
- `behavior`: `'allow' | 'deny'`
- `message`: (Optional) String containing feedback if denied.
- `newPermissionMode`: (Optional) `'default' | 'acceptEdits' | 'plan' | 'bypassPermissions'`. Specifies the target mode if allowed.

### ExitPlanMode Tool
- **Name**: `ExitPlanMode`
- **Parameters**: None
- **Output**: String (Success message or user feedback)

## State Transitions

| Current Mode | Action | User Choice | New Mode |
|--------------|--------|-------------|----------|
| `plan` | Call `ExitPlanMode` | Default | `default` |
| `plan` | Call `ExitPlanMode` | Accept Edits | `acceptEdits` |
| `plan` | Call `ExitPlanMode` | Feedback | `plan` (remains) |

## Validation Rules
- `ExitPlanMode` MUST NOT be called if `PermissionMode` is not `plan`.
- If `PermissionMode` is `acceptEdits`, tools like `Edit`, `MultiEdit`, and `Write` should skip the `canUseTool` check (or be auto-approved).
