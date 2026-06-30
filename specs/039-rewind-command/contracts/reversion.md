# Reversion API Contracts

## ReversionManager (Internal SDK API)

### `recordSnapshot(messageId: string, filePath: string, operation: 'create' | 'modify' | 'delete'): Promise<string>`
Records the current state of a file into a temporary buffer. Returns a `snapshotId`.

### `commitSnapshot(snapshotId: string): Promise<void>`
Moves the buffered snapshot to the permanent session log. Called only if the tool succeeds.

### `discardSnapshot(snapshotId: string): void`
Discards the buffered snapshot. Called if the tool fails.

### `revertTo(messageIndex: number): Promise<void>`
Reverts all file changes associated with messages from the end of history down to (and including) the specified message index.

### `getSnapshotsForMessage(messageId: string): Promise<FileSnapshot[]>`
Retrieves all snapshots associated with a specific message.

## MessageManager Extensions

### `truncateHistory(index: number): Promise<void>`
Removes messages from the history starting from `index` to the end, and triggers the corresponding file reversions.

## Slash Command

### `/rewind`
- **Input**: None (triggers UI selection)
- **Action**: 
    1. Fetch all user messages as checkpoints.
    2. Display selection UI.
    3. On selection, call `MessageManager.truncateHistory(selectedIndex)`.
    4. Notify user of success and number of files reverted.
