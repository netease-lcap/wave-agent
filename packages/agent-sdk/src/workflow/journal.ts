import * as fs from "fs";
import * as path from "path";
import type { JournalLine } from "./types.js";

export class Journal {
  private entries: JournalLine[] = [];
  private stream: fs.WriteStream | null = null;

  constructor(public readonly filePath: string) {}

  async init(): Promise<void> {
    // Ensure directory exists
    await fs.promises.mkdir(path.dirname(this.filePath), { recursive: true });
    // Create append-only write stream
    this.stream = fs.createWriteStream(this.filePath, { flags: "a" });
  }

  append(entry: JournalLine): void {
    this.entries.push(entry);
    if (this.stream && !this.stream.destroyed && !this.stream.writableEnded) {
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
    // Check if this agent was marked as failed
    const failedEntry = this.entries.find(
      (e): e is import("./types.js").AgentFailedEntry =>
        "type" in e && e.type === "agent_failed" && e.agentIndex === agentIndex,
    );
    if (failedEntry) {
      return undefined; // Failed agents don't have cached results
    }
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

  /** Remove the agent_failed entry for a given agent index (for retry support) */
  removeFailedEntry(agentIndex: number): void {
    this.entries = this.entries.filter(
      (e) =>
        !(
          "type" in e &&
          e.type === "agent_failed" &&
          e.agentIndex === agentIndex
        ),
    );
  }

  async close(): Promise<void> {
    const s = this.stream;
    this.stream = null;
    if (s) {
      await new Promise<void>((resolve) => {
        s.end(() => resolve());
      });
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
