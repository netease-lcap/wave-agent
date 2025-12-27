# Data Model: Bash Confirmation Safety

## Modified Entities

### `ToolPermissionContext` (in `agent-sdk`)

Added a new optional field to control the visibility of the persistent permission option in the UI.

| Field | Type | Description |
|-------|------|-------------|
| `hidePersistentOption` | `boolean` (optional) | If `true`, the UI should not display the "Don't ask again" or "Auto-accept" option for this tool call. |

## Validation Rules

- `hidePersistentOption` should be set to `true` if:
    - The tool is `Bash` and the command is in the `DANGEROUS_COMMANDS` blacklist.
    - The tool is `Bash` and the command is `cd` or `ls` with a path argument that resolves outside the current `workdir`.
    - Any other tool call that is deemed too risky for persistent authorization (none identified yet).
