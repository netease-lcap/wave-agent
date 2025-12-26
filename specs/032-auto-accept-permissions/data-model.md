# Data Model: Auto-Accept Permissions

## Entities

### WaveConfiguration (Extended)
- **permissions**: (Optional) Object containing permission rules.
  - **allow**: (Optional) Array of strings representing allowed tool calls.
    - Format: `ToolName(arguments)`
    - Example: `Bash(ls -la)`, `Bash(pnpm build)`

### PermissionDecision (Extended)
- **behavior**: "allow" | "deny"
- **message**: (Optional) Explanation for denial.
- **newPermissionMode**: (Optional) `PermissionMode` to switch to for the remainder of the session.
- **newPermissionRule**: (Optional) A new rule string to persist to the local configuration.

## Validation Rules
- `newPermissionRule` must follow the `ToolName(arguments)` format.
- `newPermissionMode` must be one of the valid `PermissionMode` values.
- `permissions.allow` must be an array of strings.

## State Transitions
1. **Default -> acceptEdits**: Triggered when `PermissionDecision` contains `newPermissionMode: "acceptEdits"`.
2. **Rule Addition**: Triggered when `PermissionDecision` contains `newPermissionRule`. Results in updating `.wave/settings.local.json`.
