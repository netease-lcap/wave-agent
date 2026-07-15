import { readFile, writeFile, mkdir, rm, readdir, stat } from "fs/promises";
import { join, dirname } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { FileSnapshot } from "../types/reversion.js";

export class ReversionService {
  private historyBaseDir: string;
  private rootSessionId: string;

  constructor(rootSessionId: string) {
    this.rootSessionId = rootSessionId || "default";
    this.historyBaseDir = join(
      homedir(),
      ".wave",
      "file-history",
      this.rootSessionId,
    );
  }

  private getFilePathHash(filePath: string): string {
    return createHash("sha256").update(filePath).digest("hex").slice(0, 16);
  }

  private async getNextVersion(filePath: string): Promise<number> {
    const hash = this.getFilePathHash(filePath);
    const prefix = `${hash}@v`;
    try {
      const files = await readdir(this.historyBaseDir);
      let maxVersion = 0;
      for (const file of files) {
        if (file.startsWith(prefix)) {
          const v = parseInt(file.slice(prefix.length), 10);
          if (!isNaN(v) && v > maxVersion) {
            maxVersion = v;
          }
        }
      }
      return maxVersion + 1;
    } catch {
      return 1;
    }
  }

  /**
   * Saves a single snapshot to the file history directory.
   * Returns the snapshot path.
   */
  async saveSnapshot(snapshot: FileSnapshot): Promise<string> {
    const fileHash = this.getFilePathHash(snapshot.filePath);
    await this.ensureDirectory(this.historyBaseDir);

    const version = await this.getNextVersion(snapshot.filePath);
    const snapshotPath = join(this.historyBaseDir, `${fileHash}@v${version}`);

    const snapshotWithContent = snapshot as FileSnapshot & {
      content: string | null;
    };
    if (snapshotWithContent.content !== null) {
      await writeFile(snapshotPath, snapshotWithContent.content, "utf-8");
    } else {
      // For 'create' operation, the file didn't exist, so we don't write a content file.
      // The absence of the file at snapshotPath will indicate it should be deleted on reversion.
      return ""; // Return empty string to indicate no snapshot file
    }

    return snapshotPath;
  }

  /**
   * Reads snapshot content from the given path.
   */
  async readSnapshotContent(snapshotPath: string): Promise<string | null> {
    try {
      return await readFile(snapshotPath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw error;
    }
  }

  /**
   * Deletes all snapshots for this session.
   */
  async deleteSessionHistory(): Promise<void> {
    await rm(this.historyBaseDir, { recursive: true, force: true });
  }

  /**
   * Cleans up session directories older than the given number of days.
   * Skips the current session.
   */
  async cleanupOldSessions(days: number = 30): Promise<void> {
    const threshold = Date.now() - days * 24 * 60 * 60 * 1000;
    const parentDir = dirname(this.historyBaseDir);
    try {
      const entries = await readdir(parentDir);
      await Promise.all(
        entries.map(async (entry) => {
          if (entry === this.rootSessionId) return;
          const dirPath = join(parentDir, entry);
          try {
            const stats = await stat(dirPath);
            if (stats.isDirectory() && stats.mtimeMs < threshold) {
              await rm(dirPath, { recursive: true, force: true });
            }
          } catch {
            // ENOENT — concurrently deleted, skip
          }
        }),
      );
    } catch {
      // parent dir doesn't exist — nothing to clean
    }
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
  }
}
