import * as fs from "fs";
import * as path from "path";
import type { JournalLine } from "./types.js";

export class Journal {
  private entries: JournalLine[] = [];
  private stream: fs.WriteStream | null = null;

  constructor(private filePath: string) {}

  async init(): Promise<void> {
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    // Create append-only write stream
    this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
  }

  append(entry: JournalLine): void {
    this.entries.push(entry);
    if (this.stream) {
      this.stream.write(JSON.stringify(entry) + "\n");
    }
  }

  appendLog(message: string): void {
    this.append({ type: "log", message });
  }

  getCachedResult(agentIndex: number): unknown | undefined {
    const agentEntries = this.entries.filter(
      (e): e is import("./types.js").JournalEntry => !("type" in e),
    );
    if (agentIndex < agentEntries.length) {
      return agentEntries[agentIndex].result;
    }
    return undefined;
  }

  get length(): number {
    return this.entries.length;
  }

  /** Count of agent entries (excluding log entries) */
  get agentEntryCount(): number {
    return this.entries.filter(
      (e): e is import("./types.js").JournalEntry => !("type" in e),
    ).length;
  }

  async close(): Promise<void> {
    if (this.stream) {
      await new Promise<void>((resolve) => {
        this.stream!.end(() => resolve());
      });
      this.stream = null;
    }
  }

  static async load(filePath: string): Promise<Journal> {
    const journal = new Journal(filePath);
    try {
      const content = await fs.promises.readFile(filePath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed) {
          journal.entries.push(JSON.parse(trimmed));
        }
      }
    } catch {
      // File doesn't exist yet — empty journal
    }
    return journal;
  }
}
