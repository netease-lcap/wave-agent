# Data Model: Status Line Component Refactoring

## Entities

### StatusLineProps
The interface defining the properties passed to the `StatusLine` component.

| Property | Type | Description |
|----------|------|-------------|
| `permissionMode` | `string` | The current permission mode (e.g., "plan", "normal"). |
| `isShellCommand` | `boolean` | Whether the current input is a shell command (starts with `!`). |
| `isBtwActive` | `boolean` | Whether BTW (by-the-way) mode is active. |
| `latestTotalTokens` | `number?` | Total input tokens consumed so far (default: 0). |
| `maxInputTokens` | `number?` | Maximum context window size in tokens (default: 200000). |

### LoadingIndicatorProps
The interface defining the properties passed to the `LoadingIndicator` component.

| Property | Type | Description |
|----------|------|-------------|
| `isLoading` | `boolean?` | Whether the AI is currently generating a response. |
| `isCommandRunning` | `boolean?` | Whether a shell command is running. |
| `isCompacting` | `boolean?` | Whether message compaction is in progress. |
| `latestTotalTokens` | `number?` | Total input tokens consumed so far (default: 0). |
| `maxInputTokens` | `number?` | Maximum context window size in tokens (default: 200000). |
