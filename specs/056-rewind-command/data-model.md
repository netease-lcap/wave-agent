# Data Model: Rewind Command

## Entities

### FileSnapshot
Represents the state of a file before an agent operation.

| Field | Type | Description |
|-------|------|-------------|
| `messageId` | `string` | The ID of the message/turn this snapshot is associated with. |
| `filePath` | `string` | Absolute path to the file. |
| `content` | `string \| null` | The content of the file before the operation. `null` if the file did not exist. |
| `timestamp` | `number` | When the snapshot was taken. |
| `operation` | `'create' \| 'modify' \| 'delete'` | The operation that triggered this snapshot. |

### Checkpoint
A point in the conversation history that can be reverted to.

| Field | Type | Description |
|-------|------|-------------|
| `index` | `number` | The index of the user message in the history. |
| `messageId` | `string` | The unique ID of the user message. |
| `preview` | `string` | A short snippet of the message content for the UI. |
| `timestamp` | `number` | When the message was sent. |

## Relationships
- A **Message** can have multiple **FileSnapshots** (if multiple tools were called or a tool affected multiple files).
- A **Checkpoint** corresponds to a specific **User Message**.
- **Rewinding** to a **Checkpoint** deletes all **Messages** after it and reverts all **FileSnapshots** associated with those deleted messages in reverse order.

## Validation Rules
- `filePath` must be absolute.
- `content` must be the exact bytes/string of the file at the time of snapshot.
- Reversion must happen in LIFO order based on `timestamp`.
