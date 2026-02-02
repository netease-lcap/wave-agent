import { readFile, writeFile, mkdir, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { createHash } from "crypto";
import { FileSnapshot } from "../types/reversion.js";

export class ReversionService {
  private historyBaseDir: string;
  private sessionId: string;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.historyBaseDir = join(homedir(), ".wave", "file-history", sessionId);
  }

  private getFilePathHash(filePath: string): string {
    return createHash("md5").update(filePath).digest("hex");
  }

  private async getNextVersion(fileHashDir: string): Promise<number> {
    try {
      const files = await readFile(join(fileHashDir, "versions"), "utf-8");
      const versions = files
        .split("\n")
        .map((v) => parseInt(v, 10))
        .filter((v) => !isNaN(v));
      return versions.length > 0 ? Math.max(...versions) + 1 : 1;
    } catch {
      return 1;
    }
  }

  private async updateVersionsFile(
    fileHashDir: string,
    version: number,
  ): Promise<void> {
    await appendFile(join(fileHashDir, "versions"), `${version}\n`, "utf-8");
  }

  /**
   * Saves a single snapshot to the file history directory.
   * Returns the snapshot path.
   */
  async saveSnapshot(snapshot: FileSnapshot): Promise<string> {
    const fileHash = this.getFilePathHash(snapshot.filePath);
    const fileHashDir = join(this.historyBaseDir, fileHash);
    await this.ensureDirectory(fileHashDir);

    const version = await this.getNextVersion(fileHashDir);
    const snapshotPath = join(fileHashDir, `v${version}`);

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

    await this.updateVersionsFile(fileHashDir, version);
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

  private async ensureDirectory(dirPath: string): Promise<void> {
    await mkdir(dirPath, { recursive: true });
  }
}

// Helper to avoid appendFile import error if not imported
import { appendFile } from "fs/promises";
