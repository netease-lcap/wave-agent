# Data Model: Memory Management

## Entities

### MemoryEntry
A single piece of persisted information.

| Field | Type | Description |
|-------|------|-------------|
| `content` | string | The text of the memory (e.g., "Use pnpm"). |
| `type` | 'project' \| 'user' | Whether it's stored in `AGENTS.md` or global memory. |
| `source` | string | The absolute path to the storage file. |

## State Transitions

1. **Idle**: Normal input mode.
2. **Triggered**: User asks the agent to remember something.
3. **Saving**: The entry is written to the appropriate file (AGENTS.md, global memory, or auto-memory).
4. **Persisted**: The entry is now available for future AI requests.
