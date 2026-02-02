import fs from "fs/promises";
import { FileSnapshot } from "../types/reversion.js";
import { ReversionService } from "../services/reversionService.js";

export class ReversionManager {
  private buffer: Map<string, FileSnapshot> = new Map();
  private reversionService: ReversionService;

  constructor(reversionService: ReversionService) {
    this.reversionService = reversionService;
  }

  /**
   * Records the current state of a file into a temporary buffer.
   * Returns a snapshotId.
   */
  async recordSnapshot(
    messageId: string,
    filePath: string,
    operation: "create" | "modify" | "delete",
  ): Promise<string> {
    let content: string | null = null;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      // File doesn't exist, which is expected for 'create' operation
    }

    const snapshot: FileSnapshot = {
      messageId,
      filePath,
      content,
      timestamp: Date.now(),
      operation,
    };

    const snapshotId = `${messageId}-${filePath}-${snapshot.timestamp}`;
    this.buffer.set(snapshotId, snapshot);
    return snapshotId;
  }

  /**
   * Records the current state of a file into a temporary buffer.
   * Returns a snapshotId.
   */
  async recordSnapshotWithId(
    messageId: string,
    filePath: string,
    operation: "create" | "modify" | "delete",
  ): Promise<string> {
    return this.recordSnapshot(messageId, filePath, operation);
  }

  /**
   * Moves the buffered snapshot to the permanent session log.
   * Called only if the tool succeeds.
   */
  async commitSnapshot(snapshotId: string): Promise<void> {
    const snapshot = this.buffer.get(snapshotId);
    if (snapshot) {
      await this.reversionService.saveSnapshot(snapshot);
      this.buffer.delete(snapshotId);
    }
  }

  /**
   * Discards the buffered snapshot.
   * Called if the tool fails.
   */
  discardSnapshot(snapshotId: string): void {
    this.buffer.delete(snapshotId);
  }

  /**
   * Reverts all file changes associated with messages from the end of history
   * down to (and including) the specified message index.
   * This should be called by MessageManager.
   */
  async revertTo(messageIds: string[]): Promise<number> {
    const snapshots =
      await this.reversionService.getSnapshotsForMessages(messageIds);
    // Revert in reverse chronological order (LIFO)
    const sortedSnapshots = snapshots.sort((a, b) => b.timestamp - a.timestamp);

    let revertedCount = 0;
    for (const snapshot of sortedSnapshots) {
      try {
        if (snapshot.content === null) {
          // File didn't exist before, so delete it
          await fs.rm(snapshot.filePath, { force: true });
        } else {
          // Restore previous content
          await fs.writeFile(snapshot.filePath, snapshot.content, "utf-8");
        }
        revertedCount++;
      } catch (error) {
        console.error(`Failed to revert file ${snapshot.filePath}:`, error);
      }
    }

    // After reversion, remove these snapshots from the log
    await this.reversionService.deleteSnapshotsForMessages(messageIds);

    return revertedCount;
  }
}
