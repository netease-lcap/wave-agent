import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { stat, readFile } from "node:fs/promises";
import {
  getChangedFilesReminder,
  buildChangedSnippet,
  CHANGED_FILES_MAX_FILES,
  CHANGED_FILES_SNIPPET_MAX_BYTES,
  CHANGED_FILES_TOTAL_MAX_BYTES,
} from "@/utils/fileChangeReminder.js";
import type { ReadFileState } from "@/tools/types.js";

// The change detection only needs stat + readFile; mock them so the tests
// describe the disk state directly instead of touching the real filesystem.
vi.mock("node:fs/promises", () => ({
  stat: vi.fn(),
  readFile: vi.fn(),
}));

const T0 = 1_700_000_000_000;

/** The fake on-disk state, keyed by absolute path. */
let disk: Map<string, { content: string; mtime: number }>;

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Point the fs mocks at the current `disk` map. */
function wireDisk(): void {
  vi.mocked(stat).mockImplementation((async (filePath: string) => {
    const entry = disk.get(filePath);
    if (!entry) {
      throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" });
    }
    return { mtime: new Date(entry.mtime) };
  }) as unknown as typeof stat);

  vi.mocked(readFile).mockImplementation((async (filePath: string) => {
    const entry = disk.get(filePath);
    if (!entry) {
      throw Object.assign(new Error(`ENOENT: ${filePath}`), { code: "ENOENT" });
    }
    return entry.content;
  }) as unknown as typeof readFile);
}

/** Write a file into the fake disk. */
function put(filePath: string, content: string, mtime: number): void {
  disk.set(filePath, { content, mtime });
}

/** A read-state entry recording a file exactly as it is on the fake disk. */
function recordEntry(
  filePath: string,
  content: string,
  mtime: number,
  overrides: Partial<{ offset: number; limit: number }> = {},
): ReadFileState {
  return new Map([
    [
      filePath,
      {
        mtime,
        hash: sha256(content),
        source: "read" as const,
        content,
        ...overrides,
      },
    ],
  ]);
}

/** Simulate an external writer touching the file at a strictly newer mtime. */
function externallyModify(filePath: string, content: string): void {
  put(filePath, content, T0 + 60_000);
}

describe("getChangedFilesReminder", () => {
  beforeEach(() => {
    disk = new Map();
    wireDisk();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("notifies when a fully-read file changed on disk", async () => {
    const filePath = "/project/a.ts";
    const state = recordEntry(filePath, "line1\nline2\n", T0);
    externallyModify(filePath, "line1\nCHANGED\n");

    const reminder = await getChangedFilesReminder(state);

    expect(reminder).not.toBeNull();
    expect(reminder).toContain(filePath);
    expect(reminder).toContain("CHANGED");
    // Only the changed region, not the unchanged lines.
    expect(reminder).not.toContain("line2");
  });

  it("does not notify when the on-disk mtime is not newer than the recorded read", async () => {
    const filePath = "/project/b.ts";
    const state = recordEntry(filePath, "current\n", T0);
    // Content differs but the file is *older* than our baseline — e.g. an older
    // copy restored with its original timestamps. Only a strictly newer mtime
    // counts as a change (same comparison as CC's `mtime > lastMtime`).
    put(filePath, "restored older copy\n", T0 - 120_000);

    expect(await getChangedFilesReminder(state)).toBeNull();
    // The baseline is left alone, so... (nothing to refresh, entry unchanged)
    expect(state.get(filePath)?.content).toBe("current\n");
  });

  it("does not notify when the file was touched but its content is unchanged", async () => {
    const filePath = "/project/c.ts";
    const state = recordEntry(filePath, "same\n", T0);
    put(filePath, "same\n", T0 + 60_000);

    expect(await getChangedFilesReminder(state)).toBeNull();
  });

  it("skips partial-read entries (offset/limit) and leaves them untouched", async () => {
    const filePath = "/project/d.ts";
    const state = recordEntry(filePath, "line1\nline2\n", T0, {
      offset: 1,
      limit: 5,
    });
    externallyModify(filePath, "line1\nCHANGED\n");

    expect(await getChangedFilesReminder(state)).toBeNull();
    expect(state.get(filePath)?.content).toBe("line1\nline2\n");
  });

  it("skips a file that was deleted since the read", async () => {
    const filePath = "/project/e.ts";
    const state = recordEntry(filePath, "gone\n", T0);
    disk.delete(filePath);

    expect(await getChangedFilesReminder(state)).toBeNull();
  });

  it("reports a change once, then refreshes the baseline", async () => {
    const filePath = "/project/f.ts";
    const state = recordEntry(filePath, "a\n", T0);
    externallyModify(filePath, "b\n");

    expect(await getChangedFilesReminder(state)).toContain(filePath);
    // Second pass over the refreshed state reports nothing new — the same
    // change is never re-notified on later turns.
    expect(await getChangedFilesReminder(state)).toBeNull();

    const entry = state.get(filePath);
    expect(entry?.content).toBe("b\n");
    expect(entry?.mtime).toBe(T0 + 60_000);
    // Non-"read" source so a later Read is not wrongly deduped against the
    // stale earlier read.
    expect(entry?.source).toBe("changed");
  });

  it("caps the number of files per reminder and defers the remainder", async () => {
    const total = CHANGED_FILES_MAX_FILES + 2;
    const state: ReadFileState = new Map();

    for (let i = 0; i < total; i++) {
      const filePath = `/project/f${String(i).padStart(2, "0")}.ts`;
      put(filePath, "old\n", T0);
      const one = recordEntry(filePath, "old\n", T0);
      state.set(filePath, one.get(filePath)!);
      externallyModify(filePath, "new\n");
    }

    const first = await getChangedFilesReminder(state);
    expect(first).not.toBeNull();
    const reportedFirst = [...state.keys()].filter((p) => first!.includes(p));
    expect(reportedFirst).toHaveLength(CHANGED_FILES_MAX_FILES);

    // The overflow is deferred, not dropped: a second pass reports it.
    const second = await getChangedFilesReminder(state);
    expect(second).not.toBeNull();
    const reportedSecond = [...state.keys()].filter((p) => second!.includes(p));
    expect(reportedSecond).toHaveLength(total - CHANGED_FILES_MAX_FILES);
  });

  it("defers files that would exceed the total byte budget instead of dropping them", async () => {
    const fileCount = 6;
    const state: ReadFileState = new Map();

    for (let i = 0; i < fileCount; i++) {
      const filePath = `/project/big${i}.ts`;
      put(filePath, "old\n", T0);
      const one = recordEntry(filePath, "old\n", T0);
      state.set(filePath, one.get(filePath)!);
      // ~2 KB of changed lines each: the per-file snippet budget is 2048 bytes,
      // so it is the *total* budget that starts deferring files.
      externallyModify(
        filePath,
        Array.from({ length: 300 }, (_, j) => `new ${i}-${j}`).join("\n"),
      );
    }

    const first = await getChangedFilesReminder(state);
    expect(first).not.toBeNull();
    const reported = [...state.keys()].filter((p) => first!.includes(p));
    expect(reported.length).toBeGreaterThan(0);
    expect(reported.length).toBeLessThan(fileCount);

    // The whole reminder can never blow up the context: the changed blocks are
    // bounded by the total budget, and the fixed header sentence is far smaller
    // than one per-file snippet budget.
    expect(Buffer.byteLength(first!, "utf-8")).toBeLessThan(
      CHANGED_FILES_TOTAL_MAX_BYTES + CHANGED_FILES_SNIPPET_MAX_BYTES,
    );

    // Deferred files keep their original baseline, so nothing is silently
    // dropped — they are reported on a later turn.
    const deferred = [...state.keys()].filter((p) => !first!.includes(p));
    for (const p of deferred) {
      expect(state.get(p)?.content).toBe("old\n");
    }

    const second = await getChangedFilesReminder(state);
    expect(second).not.toBeNull();
    expect([...state.keys()].filter((p) => second!.includes(p))).toEqual(
      deferred,
    );
  });

  it("bounds a multi-file reminder with many simultaneous changes", async () => {
    const fileCount = 40;
    const state: ReadFileState = new Map();

    for (let i = 0; i < fileCount; i++) {
      const filePath = `/project/many${String(i).padStart(2, "0")}.ts`;
      put(filePath, "old\n", T0);
      const one = recordEntry(filePath, "old\n", T0);
      state.set(filePath, one.get(filePath)!);
      externallyModify(filePath, `changed ${i}\n`);
    }

    // Every one of the 40 files changed in the same turn.
    const reminder = await getChangedFilesReminder(state);
    expect(reminder).not.toBeNull();

    const reported = [...state.keys()].filter((p) => reminder!.includes(p));
    expect(reported.length).toBeLessThanOrEqual(CHANGED_FILES_MAX_FILES);
    expect(Buffer.byteLength(reminder!, "utf-8")).toBeLessThan(
      CHANGED_FILES_TOTAL_MAX_BYTES + CHANGED_FILES_SNIPPET_MAX_BYTES,
    );

    // Each reported entry is refreshed, so the still-unreported ones drain
    // across turns without ever repeating an already-sent change.
    const notified = new Set(reported);
    for (let round = 0; round < fileCount; round++) {
      const next = await getChangedFilesReminder(state);
      if (!next) break;
      for (const p of [...state.keys()].filter((x) => next.includes(x))) {
        expect(notified.has(p)).toBe(false);
        notified.add(p);
      }
    }
    expect(notified.size).toBe(fileCount);
  });

  it("truncates a large changed region and stays within the total budget", async () => {
    const filePath = "/project/g.ts";
    const state = recordEntry(filePath, "header\nold\n", T0);
    externallyModify(
      filePath,
      "header\n" +
        Array.from({ length: 500 }, (_, i) => `new line ${i}`).join("\n"),
    );

    const reminder = await getChangedFilesReminder(state);

    expect(reminder).not.toBeNull();
    expect(reminder).toContain("lines truncated");
    expect(Buffer.byteLength(reminder!, "utf-8")).toBeLessThan(
      CHANGED_FILES_TOTAL_MAX_BYTES + CHANGED_FILES_SNIPPET_MAX_BYTES,
    );
  });

  it("returns null for an empty or missing read state", async () => {
    expect(await getChangedFilesReminder(new Map())).toBeNull();
    expect(await getChangedFilesReminder(undefined)).toBeNull();
    // Nothing on disk was consulted.
    expect(vi.mocked(stat)).not.toHaveBeenCalled();
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
