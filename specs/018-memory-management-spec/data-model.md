# Data Model: Memory Management

## Entities

### MemoryEntry
A single piece of persisted information.

| Field | Type | Description |
|-------|------|-------------|
| `content` | string | The text of the memory (e.g., "Use pnpm"). |
| `type` | 'project' \| 'user' | Whether it's stored in `AGENTS.md` or global memory. |
| `source` | string | The absolute path to the storage file. |

### MemorySelectorState
The state of the memory type selection UI.

| Field | Type | Description |
|-------|------|-------------|
| `isActive` | boolean | Whether the selection UI is visible. |
| `message` | string | The memory content to be saved (typed after `#`). |
| `selectedIndex` | number | The currently highlighted option (Project/User). |

## State Transitions

1. **Idle**: Normal input mode.
2. **Triggered**: User submits a message starting with `#`.
3. **Selecting**: `MemoryTypeSelector` is shown, user chooses storage type.
4. **Saving**: The entry is written to the selected file.
5. **Persisted**: The entry is now available for future AI requests.
6. **Cancelled**: User cancels the selection, memory is not saved.
