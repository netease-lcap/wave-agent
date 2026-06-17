# Data Model: ACP Bridge

## Entity: AcpSession

Represents an active session managed by the ACP bridge.

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `string` | The unique ID of the session. |
| `agent` | `WaveAgent` | The underlying Wave Agent instance. |
| `cwd` | `string` | The working directory for this session. |
| `permissionMode` | `string` | The current permission mode (e.g., `default`, `plan`). |

## Entity: ToolCallState

Tracks the state of a tool call for ACP reporting.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | The unique ID of the tool call. |
| `name` | `string` | The name of the tool being called. |
| `status` | `string` | Current status (`pending`, `in_progress`, `completed`, `failed`). |
| `parameters` | `object` | The input parameters for the tool. |
| `result` | `any` | The output of the tool call. |

## Entity: TaskCache

Per-session cache of the latest task list, populated by `onTasksChange` and consumed by `wave/create_plan`.

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | `string` | The session ID (Map key). |
| `tasks` | `Task[]` | Current task list including deleted tasks (filtered at consumption time). |

## Extension Method Payloads

### `wave/ask_question` Request

| Field | Type | Description |
|-------|------|-------------|
| `toolCallId` | `string` | The tool call ID. |
| `title` | `string?` | Optional title from the question header. |
| `questions` | `Array` | Structured questions with id, prompt, options, allowMultiple. |

### `wave/ask_question` Response

| Field | Type | Description |
|-------|------|-------------|
| `outcome` | `string` | `"answered"` or `"cancelled"`. |
| `answers` | `Array` | When answered: array of `{ questionId, selectedOptionIds }`. |

### `wave/create_plan` Request

| Field | Type | Description |
|-------|------|-------------|
| `toolCallId` | `string` | The tool call ID. |
| `plan` | `string` | The plan content. |
| `todos` | `Array` | Current tasks with id, content, status (excluding deleted). |

### `wave/create_plan` Response

| Field | Type | Description |
|-------|------|-------------|
| `outcome` | `string` | `"accepted"`, `"rejected"`, or `"cancelled"`. |
| `reason` | `string?` | When rejected: optional rejection reason. |

## State Transitions

- **Initializing**: Connection established, waiting for `initialize` request.
- **Active**: Connection initialized, sessions can be created or loaded.
- **Processing**: Agent is actively processing a prompt.
- **WaitingForPermission**: Agent is blocked waiting for user permission via ACP.
- **Closed**: Connection terminated, all sessions cleaned up.
