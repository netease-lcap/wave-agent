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

## State Transitions

- **Initializing**: Connection established, waiting for `initialize` request.
- **Active**: Connection initialized, sessions can be created or loaded.
- **Processing**: Agent is actively processing a prompt.
- **WaitingForPermission**: Agent is blocked waiting for user permission via ACP.
- **Closed**: Connection terminated, all sessions cleaned up.
