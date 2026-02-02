# Research: Rewind Command

## Decision: ReversionManager in agent-sdk
- **Rationale**: Centralizes the logic for tracking file snapshots and performing rollbacks. This ensures consistency across different tools and allows the `MessageManager` to trigger reversions during history truncation.
- **Alternatives considered**: 
    - Tool-level reversion: Rejected because it would be difficult to coordinate sequential reversion across multiple tools and turns.
    - Git-based reversion: Rejected because the agent might not be running in a git repo, or the user might have uncommitted changes they don't want the agent to touch.

## Decision: Atomic Snapshots
- **Rationale**: If a tool fails (e.g., permission error, invalid path), no change was made to the disk. Recording a snapshot for a failed operation would result in an unnecessary (and potentially destructive) "reversion" later. Snapshots will be buffered and only committed to the session log if the tool returns `success: true`.
- **Alternatives considered**: 
    - Always record: Rejected because reverting a failed "Delete" might try to restore a file that was never deleted, potentially overwriting newer user changes.

## Decision: Snapshot before execution
- **Rationale**: To ensure we can revert to the exact state before the agent's action, we must capture the file content (or non-existence) immediately before the tool performs its operation.
- **Alternatives considered**: 
    - Post-action snapshots: Rejected because they don't capture the "before" state needed for undo.

## Decision: Sequential Reverse Rollback (LIFO)
- **Rationale**: File operations are often dependent on previous ones (e.g., Edit after Write). Reverting in reverse chronological order ensures that the filesystem state is restored correctly step-by-step.
- **Alternatives considered**: 
    - Batch restoration: Rejected because it's harder to handle multiple edits to the same file correctly without following the sequence.

## Decision: Overwrite External Changes
- **Rationale**: The requirement (FR-007 and Edge Cases) specifies that the system MUST restore the file to its exact state at the checkpoint. Overwriting external changes is the most reliable way to achieve this.
- **Alternatives considered**: 
    - Merge changes: Rejected as it introduces significant complexity and potential for conflict that the user would have to resolve manually.

## Decision: Ink-based Selection UI
- **Rationale**: The `code` package already uses Ink for its CLI interface. Using a searchable list or a simple selection component in Ink maintains consistency with the existing UI.
- **Alternatives considered**: 
    - Simple prompt: Rejected because it's less user-friendly for long histories.

## Integration Points
- `SlashCommandManager`: Register `/rewind`.
- `MessageManager`: Add `truncateHistory(index)` which calls `ReversionManager.revertTo(index)`.
- `File Tools`: Call `ReversionManager.recordSnapshot(filePath)` before execution.
- `Session`: Store snapshots in a sidecar file (e.g., `.reversion.jsonl`) or within the session data if appropriate.
