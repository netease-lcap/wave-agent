# Data Model: Long Text Placeholder

## Entities

### LongTextEntry
Used in `InputManager` to track compressed user inputs.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | The placeholder ID (e.g., `[LongText#1]`). |
| `originalText` | string | The full text that was pasted. |

## State Transitions

### Input Compression
1. **Pasting**: User pastes text > 200 characters.
2. **Placeholder Created**: Text is stored in `longTextMap`, placeholder is inserted into input.
3. **Submission**: User sends the message.
4. **Expansion**: Placeholders are replaced with `originalText` before sending to agent.
5. **Cleanup**: `longTextMap` is cleared.
