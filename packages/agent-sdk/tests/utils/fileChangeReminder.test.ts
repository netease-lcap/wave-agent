import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import {
  getChangedFilesReminder,
  buildChangedSnippet,
  CHANGED_FILES_MAX_FILES,
  CHANGED_FILES_TOTAL_MAX_BYTES,
} from "@/utils/fileChangeReminder.js";
import type { ReadFileState } from "@/tools/types.js";

/**
 * External file-change detection. Uses the real filesystem so the mtime/stat
 * comparisons are exercised end to end.
 */
describe("getChangedFilesReminder", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "wave-changed-files-"));
  });

  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true });
  });

  async function makeFile(name: string, content: string): Promise<string> {
    const filePath = path.join(dir, name);
    await fsp.writeFile(filePath, content, "utf-8");
    return filePath;
  }

  /** A read-state entry recording the file as it is right now. */
  async function record(
    filePath: string,
    content: string,
    overrides: Partial<{
      mtime: number;
      offset: number;
      limit: number;
      source: "read" | "edit" | "write" | "changed";
    }> = {},
  ): Promise<ReadFileState> {
    const stats = await fsp.stat(filePath);
    return new Map([
      [
        filePath,
        {
          mtime: stats.mtime.getTime(),
          hash: createHash("sha256").update(content).digest("hex"),
          source: "read" as const,
          content,
          ...overrides,
        },
      ],
    ]);
  }

  /** Rewrite the file and force a strictly newer mtime. */
  async function modify(filePath: string, content: string): Promise<void> {
    await fsp.writeFile(filePath, content, "utf-8");
    const later = new Date(Date.now() + 60_000);
    await fsp.utimes(filePath, later, later);
  }

  it("notifies when a fully-read file changed on disk", async () => {
    const filePath = await makeFile("a.ts", "line1\nline2\n");
    const state = await record(filePath, "line1\nline2\n");

    await modify(filePath, "line1\nCHANGED\n");

    const reminder = await getChangedFilesReminder(state);
    expect(reminder).not.toBeNull();
    expect(reminder).toContain(filePath);
    expect(reminder).toContain("CHANGED");
    expect(reminder).not.toContain("line2");
  });

  it("does not notify when the on-disk mtime is not newer than the recorded read", async () => {
    const filePath = await makeFile("b.ts", "current\n");
    const state = await record(filePath, "current\n");

    // Content differs but the file is *older* than our baseline — e.g. an older
    // copy restored with its original timestamps. Only a strictly newer mtime
    // counts as a change (same comparison as CC's `mtime > lastMtime`).
    await fsp.writeFile(filePath, "restored older copy\n", "utf-8");
    const past = new Date(Date.now() - 120_000);
    await fsp.utimes(filePath, past, past);

    expect(await getChangedFilesReminder(state)).toBeNull();
    // The baseline is left alone, so a later genuine edit is still caught.
    expect(state.get(filePath)?.content).toBe("current\n");
  });

  it("does not notify when the file was touched but its content is unchanged", async () => {
    const filePath = await makeFile("c.ts", "same\n");
    const state = await record(filePath, "same\n");

    const later = new Date(Date.now() + 60_000);
    await fsp.utimes(filePath, later, later);

    expect(await getChangedFilesReminder(state)).toBeNull();
  });

  it("skips partial-read entries (offset/limit) and leaves them untouched", async () => {
    const filePath = await makeFile("d.ts", "line1\nline2\n");
    const state = await record(filePath, "line1\nline2\n", {
      offset: 1,
      limit: 5,
    });

    await modify(filePath, "line1\nCHANGED\n");

    expect(await getChangedFilesReminder(state)).toBeNull();
    expect(state.get(filePath)?.content).toBe("line1\nline2\n");
  });

  it("reports a change once, then refreshes the baseline", async () => {
    const filePath = await makeFile("e.ts", "a\n");
    const state = await record(filePath, "a\n");

    await modify(filePath, "b\n");

    expect(await getChangedFilesReminder(state)).toContain(filePath);
    // Second pass over the refreshed state reports nothing new.
    expect(await getChangedFilesReminder(state)).toBeNull();

    const entry = state.get(filePath);
    expect(entry?.content).toBe("b\n");
    // Non-"read" source so a later Read is not wrongly deduped against the
    // stale earlier read.
    expect(entry?.source).toBe("changed");
  });

  it("caps the number of files per reminder and defers the remainder", async () => {
    const total = CHANGED_FILES_MAX_FILES + 2;
    const state: ReadFileState = new Map();
    const paths: string[] = [];

    for (let i = 0; i < total; i++) {
      const name = `f${String(i).padStart(2, "0")}.ts`;
      const filePath = await makeFile(name, "old\n");
      const one = await record(filePath, "old\n");
      state.set(filePath, one.get(filePath)!);
      await modify(filePath, "new\n");
      paths.push(filePath);
    }

    const first = await getChangedFilesReminder(state);
    expect(first).not.toBeNull();
    expect(paths.filter((p) => first!.includes(p))).toHaveLength(
      CHANGED_FILES_MAX_FILES,
    );

    // The overflow is deferred, not dropped: a second pass reports it.
    const second = await getChangedFilesReminder(state);
    expect(second).not.toBeNull();
    expect(paths.filter((p) => second!.includes(p))).toHaveLength(
      total - CHANGED_FILES_MAX_FILES,
    );
  });

  it("defers files that would exceed the total byte budget instead of dropping them", async () => {
    const fileCount = 6;
    const state: ReadFileState = new Map();
    const paths: string[] = [];

    for (let i = 0; i < fileCount; i++) {
      const filePath = await makeFile(`big${i}.ts`, "old\n");
      const one = await record(filePath, "old\n");
      state.set(filePath, one.get(filePath)!);
      // ~2 KB of changed lines each: the per-file snippet budget is 2048 bytes,
      // so it is the *total* budget that starts deferring files.
      await modify(
        filePath,
        Array.from({ length: 300 }, (_, j) => `new ${i}-${j}`).join("\n"),
      );
      paths.push(filePath);
    }

    const first = await getChangedFilesReminder(state);
    expect(first).not.toBeNull();
    const reported = paths.filter((p) => first!.includes(p));
    expect(reported.length).toBeGreaterThan(0);
    expect(reported.length).toBeLessThan(fileCount);

    // Deferred files keep their original baseline, so nothing is silently
    // dropped — they are reported on a later turn.
    const deferred = paths.filter((p) => !first!.includes(p));
    for (const p of deferred) {
      expect(state.get(p)?.content).toBe("old\n");
    }

    const second = await getChangedFilesReminder(state);
    expect(second).not.toBeNull();
    expect(paths.filter((p) => second!.includes(p))).toEqual(deferred);
  });

  it("truncates a large changed region and stays within the total budget", async () => {
    const filePath = await makeFile("g.ts", "header\nold\n");
    const state = await record(filePath, "header\nold\n");

    const newContent =
      "header\n" +
      Array.from({ length: 500 }, (_, i) => `new line ${i}`).join("\n");
    await modify(filePath, newContent);

    const reminder = await getChangedFilesReminder(state);
    expect(reminder).not.toBeNull();
    expect(reminder).toContain("lines truncated");
    expect(Buffer.byteLength(reminder!, "utf-8")).toBeLessThanOrEqual(
      CHANGED_FILES_TOTAL_MAX_BYTES,
    );
  });

  it("returns null for an empty or missing read state", async () => {
    expect(await getChangedFilesReminder(new Map())).toBeNull();
    expect(await getChangedFilesReminder(undefined)).toBeNull();
  });
});

describe("buildChangedSnippet", () => {
  it("returns empty string when contents are identical", () => {
    expect(buildChangedSnippet("a\nb\n", "a\nb\n")).toBe("");
  });

  it("renders only the changed region with line numbers", () => {
    const snippet = buildChangedSnippet(
      "keep1\nkeep2\nOLD\nkeep3\n",
      "keep1\nkeep2\nNEW\nkeep3\n",
    );
    expect(snippet).toBe("   3 | NEW");
    expect(snippet).not.toContain("keep2");
  });

  it("renders an addition at the end of the file", () => {
    const snippet = buildChangedSnippet("a\n", "a\nb\n");
    expect(snippet).toContain("   2 | b");
  });

  it("reports a deletion-only region as a removal note", () => {
    const snippet = buildChangedSnippet("a\nb\nc\nd\n", "a\nd\n");
    expect(snippet).toBe("(2 lines removed at line 2)");
  });

  it("ignores pure CRLF/LF differences", () => {
    expect(buildChangedSnippet("a\r\nb\r\n", "a\nb\n")).toBe("");
  });

  it("truncates at a line boundary with a marker", () => {
    const newContent = Array.from({ length: 200 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const snippet = buildChangedSnippet("", newContent, 200);
    expect(snippet).toContain("lines truncated");
    expect(Buffer.byteLength(snippet, "utf-8")).toBeLessThan(300);
  });
});
