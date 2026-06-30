# Data Model: Status Command

## Entity: AgentStatus

Represents the current state and configuration of the Wave Agent.

| Field | Type | Description |
|-------|------|-------------|
| `version` | `string` | The version of the `wave-code` package. |
| `sessionId` | `string` | The unique ID of the current session. |
| `cwd` | `string` | The absolute path of the current working directory. |
| `baseURL` | `string` | The Wave base URL configured for the agent. |
| `model` | `string` | The name of the active AI model. |

## Validation Rules
- `version` must be a valid semver string.
- `sessionId` must be a valid UUID.
- `cwd` must be an absolute path.
- `baseURL` must be a valid URL.
- `model` must be a non-empty string.

## State Transitions
- **Hidden**: The default state.
- **Visible**: Triggered by the `/status` command.
- **Dismissed**: Triggered by the `Escape` key, returning to the previous state.
