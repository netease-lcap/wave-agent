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
- `TaskStop` can only be called on tasks in the `running` state.

## Notification Entities

### TaskNotificationBlock
Represents a background task completion notification displayed in the chat UI.

| Field | Type | Description |
|-------|------|-------------|
| `taskId` | `string` | ID of the background task |
| `taskType` | `'shell' \| 'agent'` | Type of the completed task |
| `status` | `'completed' \| 'failed' \| 'killed'` | Final state of the task |
| `summary` | `string` | Human-readable summary message |
| `outputFile` | `string?` | Path to the task's output log file (shell tasks only) |

### XML Serialization Format
Task notifications are serialized as XML when sent to the AI:

```xml
<task-notification>
<task-id>task_1</task-id>
<task-type>shell</task-type>
<output-file>/tmp/task_1_output.log</output-file>
<status>completed</status>
<summary>Command "ls -la" completed with exit code 0</summary>
</task-notification>
```

The `output-file` tag is only included for shell tasks.
