import { readFile, writeFile, appendFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { FileSnapshot } from "../types/reversion.js";

export class ReversionService {
  private reversionFilePath: string;

  constructor(sessionFilePath: string) {
    // Store snapshots in a sidecar file: .reversion-[sessionId].jsonl
    const dir = dirname(sessionFilePath);
    const filename = sessionFilePath.split("/").pop() || "";
    this.reversionFilePath = `${dir}/.reversion-${filename}`;
  }

  /**
   * Saves a single snapshot to the JSONL file.
   */
  async saveSnapshot(snapshot: FileSnapshot): Promise<void> {
    await this.ensureDirectory(dirname(this.reversionFilePath));
    const line = JSON.stringify(snapshot) + "\n";
    await appendFile(this.reversionFilePath, line, "utf-8");
  }

  /**
   * Retrieves all snapshots associated with the given message IDs.
   */
  async getSnapshotsForMessages(messageIds: string[]): Promise<FileSnapshot[]> {
    const allSnapshots = await this.readAllSnapshots();
    const messageIdSet = new Set(messageIds);
    return allSnapshots.filter((s) => messageIdSet.has(s.messageId));
  }

  /**
   * Deletes snapshots associated with the given message IDs.
   */
  async deleteSnapshotsForMessages(messageIds: string[]): Promise<void> {
    const allSnapshots = await this.readAllSnapshots();
    const messageIdSet = new Set(messageIds);
    const remainingSnapshots = allSnapshots.filter(
      (s) => !messageIdSet.has(s.messageId),
    );

    const content =
      remainingSnapshots.map((s) => JSON.stringify(s)).join("\n") +
      (remainingSnapshots.length > 0 ? "\n" : "");
    await writeFile(this.reversionFilePath, content, "utf-8");
  }

  /**
   * Reads all snapshots from the JSONL file.
   */
  private async readAllSnapshots(): Promise<FileSnapshot[]> {
    try {
      const content = await readFile(this.reversionFilePath, "utf-8");
      return content
        .split(/\r?\n/)
        .filter((line) => line.trim().length > 0)
        .map((line) => JSON.parse(line) as FileSnapshot);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw error;
    }
  }

  private async ensureDirectory(dirPath: string): Promise<void> {
    try {
      await mkdir(dirPath, { recursive: true });
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== "EEXIST") {
        throw error;
      }
    }
  }
}
