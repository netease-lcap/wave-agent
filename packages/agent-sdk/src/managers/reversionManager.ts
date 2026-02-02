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
      timestamp: Date.now(),
      operation,
    };

    // We temporarily store the content in the buffer, it will be saved to disk on commit
    const snapshotId = `${messageId}-${filePath}-${snapshot.timestamp}`;
    this.buffer.set(snapshotId, { ...snapshot, content } as FileSnapshot & {
      content: string | null;
    });
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
    const snapshotWithContent = this.buffer.get(snapshotId) as FileSnapshot & {
      content: string | null;
    };
    if (snapshotWithContent) {
      const { content, ...snapshot } = snapshotWithContent;
      const snapshotPath = await this.reversionService.saveSnapshot({
        ...snapshot,
        content,
      } as FileSnapshot);
      snapshot.snapshotPath = snapshotPath;
      this.buffer.delete(snapshotId);

      // We need to return the snapshot so it can be added to the message block
      // But the current API doesn't support it.
      // Let's store committed snapshots in another buffer for the current turn.
      this.committedSnapshots.push(snapshot);
    }
  }

  private committedSnapshots: FileSnapshot[] = [];

  /**
   * Gets and clears committed snapshots for the current turn.
   */
  getAndClearCommittedSnapshots(): FileSnapshot[] {
    const snapshots = [...this.committedSnapshots];
    this.committedSnapshots = [];
    return snapshots;
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
  async revertTo(
    messageIds: string[],
    allMessages: import("../types/index.js").Message[],
  ): Promise<number> {
    const messageIdSet = new Set(messageIds);
    const snapshots: FileSnapshot[] = [];

    for (const message of allMessages) {
      if (message.id && messageIdSet.has(message.id)) {
        const historyBlock = message.blocks.find(
          (b) => b.type === "file_history",
        ) as { type: "file_history"; snapshots: FileSnapshot[] } | undefined;
        if (historyBlock && historyBlock.snapshots) {
          snapshots.push(...historyBlock.snapshots);
        }
      }
    }

    // Revert in reverse chronological order (LIFO)
    const sortedSnapshots = snapshots.sort((a, b) => b.timestamp - a.timestamp);

    let revertedCount = 0;
    for (const snapshot of sortedSnapshots) {
      try {
        if (!snapshot.snapshotPath) {
          // File didn't exist before, so delete it
          await fs.rm(snapshot.filePath, { force: true });
        } else {
          // Restore previous content
          const content = await this.reversionService.readSnapshotContent(
            snapshot.snapshotPath,
          );
          if (content !== null) {
            await fs.writeFile(snapshot.filePath, content, "utf-8");
          } else {
            // If snapshotPath exists but content is null, it means the file should be deleted
            // (This handles the case where snapshotPath was set but content was null in saveSnapshot)
            await fs.rm(snapshot.filePath, { force: true });
          }
        }
        revertedCount++;
      } catch (error) {
        console.error(`Failed to revert file ${snapshot.filePath}:`, error);
      }
    }

    return revertedCount;
  }
}
