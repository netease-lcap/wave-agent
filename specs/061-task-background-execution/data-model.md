# Data Model: Task Background Execution

## Entities

### BackgroundTask
Represents any operation running asynchronously in the background.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier (e.g., `task_1`) |
| `type` | `'shell' \| 'subagent'` | The nature of the task |
| `status` | `'running' \| 'completed' \| 'failed' \| 'killed'` | Current execution state |
| `startTime` | `number` | Timestamp when task started |
| `endTime` | `number?` | Timestamp when task finished |
| `command` | `string?` | The shell command (if type is 'shell') |
| `description` | `string?` | Task description (if type is 'subagent') |
| `stdout` | `string` | Accumulated standard output |
| `stderr` | `string` | Accumulated error output |
| `exitCode` | `number?` | Process exit code or subagent result status |

## State Transitions

1. **`running` → `completed`**: Task finished successfully.
2. **`running` → `failed`**: Task encountered an error or exited with non-zero code.
3. **`running` → `killed`**: Task was manually terminated via `TaskStop`.

## Validation Rules
- `task_id` must follow the pattern `task_\d+`.
- `TaskOutput` timeout must be between 0 and 600,000 ms.
- `TaskStop` can only be called on tasks in the `running` state.
