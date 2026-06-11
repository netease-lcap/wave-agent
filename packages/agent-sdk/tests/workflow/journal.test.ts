import { describe, it, expect, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Journal } from "../../src/workflow/journal.js";
import type { JournalEntry } from "../../src/workflow/types.js";

describe("Journal", () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await fs.promises.rm(tmpDir, { recursive: true, force: true });
    }
  });

  function tmpPath(name: string): string {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "journal-test-"));
    return path.join(tmpDir, name);
  }

  it("creates and initializes a new journal", async () => {
    const filePath = tmpPath("test.journal");
    const journal = new Journal(filePath);
    await journal.init();

    expect(journal.length).toBe(0);
    await journal.close();
  });

  it("appends entries and retrieves cached results", async () => {
    const filePath = tmpPath("test.journal");
    const journal = new Journal(filePath);
    await journal.init();

    const entry1: JournalEntry = {
      agentIndex: 0,
      prompt: "hello",
      opts: {},
      result: { answer: 42 },
      tokens: 100,
    };
    const entry2: JournalEntry = {
      agentIndex: 1,
      prompt: "world",
      opts: { model: "fast" },
      result: "done",
      tokens: 200,
    };

    journal.append(entry1);
    journal.append(entry2);

    expect(journal.length).toBe(2);
    expect(journal.getCachedResult(0)).toEqual({ answer: 42 });
    expect(journal.getCachedResult(1)).toBe("done");

    await journal.close();
  });

  it("getCachedResult returns undefined for out-of-bounds index", async () => {
    const filePath = tmpPath("test.journal");
    const journal = new Journal(filePath);
    await journal.init();

    journal.append({
      agentIndex: 0,
      prompt: "test",
      opts: {},
      result: "ok",
      tokens: 10,
    });

    expect(journal.getCachedResult(5)).toBeUndefined();
    await journal.close();
  });

  it("persists data to file on close", async () => {
    const filePath = tmpPath("test.journal");
    const journal = new Journal(filePath);
    await journal.init();

    journal.append({
      agentIndex: 0,
      prompt: "persist me",
      opts: {},
      result: "persisted",
      tokens: 50,
    });

    await journal.close();

    // Verify the file has content
    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      agentIndex: 0,
      prompt: "persist me",
      result: "persisted",
    });
  });

  it("loads from existing file", async () => {
    const filePath = tmpPath("test.journal");

    // Write a journal file manually
    await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
    const entry: JournalEntry = {
      agentIndex: 0,
      prompt: "loaded",
      opts: {},
      result: "restored",
      tokens: 30,
    };
    await fs.promises.writeFile(filePath, JSON.stringify(entry) + "\n");

    const journal = await Journal.load(filePath);
    expect(journal.length).toBe(1);
    expect(journal.getCachedResult(0)).toBe("restored");
  });

  it("returns empty journal when file does not exist", async () => {
    const filePath = tmpPath("nonexistent.journal");
    const journal = await Journal.load(filePath);

    expect(journal.length).toBe(0);
    expect(journal.getCachedResult(0)).toBeUndefined();
  });

  it("agentEntryCount excludes log entries", async () => {
    const filePath = tmpPath("test.journal");
    const journal = new Journal(filePath);
    await journal.init();

    journal.append({
      agentIndex: 0,
      prompt: "hello",
      opts: {},
      result: "ok",
      tokens: 10,
    });
    journal.appendLog("some log message");
    journal.append({
      agentIndex: 1,
      prompt: "world",
      opts: {},
      result: "done",
      tokens: 20,
    });

    expect(journal.length).toBe(3);
    expect(journal.agentEntryCount).toBe(2);
    await journal.close();
  });

  it("load + init allows appending to existing journal (resume)", async () => {
    const filePath = tmpPath("resume.journal");

    // Phase 1: write initial entries
    const j1 = new Journal(filePath);
    await j1.init();
    j1.append({
      agentIndex: 0,
      prompt: "first",
      opts: {},
      result: "cached",
      tokens: 10,
    });
    j1.appendLog("some log");
    await j1.close();

    // Phase 2: load, init, append more (simulate resume)
    const j2 = await Journal.load(filePath);
    expect(j2.agentEntryCount).toBe(1);
    expect(j2.getCachedResult(0)).toBe("cached");

    await j2.init(); // re-open for append
    j2.append({
      agentIndex: 1,
      prompt: "second",
      opts: {},
      result: "new",
      tokens: 20,
    });
    await j2.close();

    // Verify file has 3 lines (1 agent + 1 log + 1 agent)
    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(3);
  });

  it("getCachedResult returns undefined for failed agent", async () => {
    const filePath = tmpPath("test.journal");
    const journal = new Journal(filePath);
    await journal.init();

    journal.append({
      agentIndex: 0,
      prompt: "hello",
      opts: {},
      result: "ok",
      tokens: 10,
    });
    journal.append({
      type: "agent_failed",
      agentIndex: 1,
      error: "something went wrong",
    });

    expect(journal.getCachedResult(0)).toBe("ok");
    expect(journal.getCachedResult(1)).toBeUndefined();
    await journal.close();
  });

  it("removeFailedEntry removes agent_failed entry", async () => {
    const filePath = tmpPath("test.journal");
    const journal = new Journal(filePath);
    await journal.init();

    journal.append({
      agentIndex: 0,
      prompt: "hello",
      opts: {},
      result: "ok",
      tokens: 10,
    });
    journal.append({
      type: "agent_failed",
      agentIndex: 1,
      error: "failed",
    });
    journal.append({
      type: "agent_failed",
      agentIndex: 2,
      error: "also failed",
    });

    expect(journal.length).toBe(3);

    // Remove only agent 1's failed entry
    journal.removeFailedEntry(1);
    expect(journal.length).toBe(2);

    // Agent 2's failed entry is still there
    expect(journal.getCachedResult(2)).toBeUndefined();

    // Agent 0 is unaffected
    expect(journal.getCachedResult(0)).toBe("ok");

    await journal.close();
  });

  it("does not write to closed stream", async () => {
    const filePath = tmpPath("test.journal");
    const journal = new Journal(filePath);
    await journal.init();

    journal.append({
      agentIndex: 0,
      prompt: "hello",
      opts: {},
      result: "ok",
      tokens: 10,
    });

    await journal.close();

    // Append after close should not throw
    journal.append({
      agentIndex: 1,
      prompt: "after close",
      opts: {},
      result: "should not persist",
      tokens: 5,
    });

    // In-memory entry is added
    expect(journal.length).toBe(2);
    // But file only has 1 entry (written before close)
    const content = await fs.promises.readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    expect(lines).toHaveLength(1);
  });
});
