/**
 * 机器级最近工作目录（spec core/recent-workdirs.md）。
 *
 * 这里测的是**文件契约**：MRU 顺序、去重口径、上限、坏文件的兜底，以及「写不
 * 进去也不打扰调用方」。文件位置由 `homedir()` 决定，所以 home 与 fs 都换成桩。
 */
import { join, resolve } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const reads: string[] = [];
const writes: Array<{ path: string; data: string }> = [];
let readShouldThrow = false;
let writeShouldThrow = false;

/**
 * The fixture home is resolved through `path` so the stub hands the production
 * code the same shape of absolute path the real `homedir()` does: on Windows
 * `resolve("/mock/home")` is `C:\mock\home`, and `join()` then yields `\`
 * separators — hardcoding "/mock/home" here only matches on POSIX.
 */
const HOME = resolve("/mock/home");

vi.mock("node:os", () => ({
  homedir: () => HOME,
}));

vi.mock("node:fs", () => ({
  existsSync: () => true,
  mkdirSync: vi.fn(),
  readFileSync: () => {
    if (readShouldThrow) throw new Error("EACCES");
    return reads.length ? reads[reads.length - 1] : "";
  },
}));

vi.mock("../../src/utils/atomicWrite.js", () => ({
  atomicWriteFileSync: (path: string, data: string) => {
    if (writeShouldThrow) throw new Error("EROFS");
    writes.push({ path, data });
  },
}));

const { MAX_RECENT_WORKDIRS, readRecentWorkdirs, rememberRecentWorkdir } =
  await import("../../src/utils/recentWorkdirs.js");

function store(dirs: unknown): void {
  reads.push(JSON.stringify({ dirs }));
}

function lastWritten(): string[] {
  return JSON.parse(writes[writes.length - 1].data).dirs;
}

beforeEach(() => {
  reads.length = 0;
  writes.length = 0;
  readShouldThrow = false;
  writeShouldThrow = false;
});

describe("readRecentWorkdirs", () => {
  it("returns an empty list when the file is missing", () => {
    readShouldThrow = true;
    expect(readRecentWorkdirs()).toEqual([]);
  });

  it("returns an empty list when the file is not valid JSON", () => {
    reads.push("{ not json");
    expect(readRecentWorkdirs()).toEqual([]);
  });

  it("drops non-strings and duplicates, keeping the MRU order", () => {
    store(["/b", 42, "/a/", "/b/", null]);
    expect(readRecentWorkdirs()).toEqual(["/b", "/a"]);
  });

  it("caps the list", () => {
    store(Array.from({ length: MAX_RECENT_WORKDIRS + 3 }, (_, i) => `/d${i}`));
    expect(readRecentWorkdirs()).toHaveLength(MAX_RECENT_WORKDIRS);
  });
});

describe("rememberRecentWorkdir", () => {
  it("puts the directory first, keeping one entry per path", () => {
    store(["/b", "/a"]);
    rememberRecentWorkdir("/a");
    expect(lastWritten()).toEqual(["/a", "/b"]);
  });

  it("treats a trailing separator as the same directory", () => {
    store(["/repo/"]);
    rememberRecentWorkdir("/repo");
    expect(lastWritten()).toEqual(["/repo"]);
  });

  it("keeps a drive root's separator", () => {
    store([]);
    rememberRecentWorkdir("C:\\");
    expect(lastWritten()).toEqual(["C:\\"]);
  });

  it("caps the list at the newest entries", () => {
    store(Array.from({ length: MAX_RECENT_WORKDIRS }, (_, i) => `/d${i}`));
    rememberRecentWorkdir("/new");
    const written = lastWritten();
    expect(written).toHaveLength(MAX_RECENT_WORKDIRS);
    expect(written[0]).toBe("/new");
    expect(written).not.toContain(`/d${MAX_RECENT_WORKDIRS - 1}`);
  });

  it("writes to ~/.wave/recent-workdirs.json", () => {
    store([]);
    rememberRecentWorkdir("/repo");
    expect(writes[writes.length - 1].path).toBe(
      join(HOME, ".wave", "recent-workdirs.json"),
    );
  });

  it("ignores an empty directory and never throws on a failed write", () => {
    store([]);
    rememberRecentWorkdir("   ");
    expect(writes).toHaveLength(0);

    writeShouldThrow = true;
    expect(() => rememberRecentWorkdir("/repo")).not.toThrow();
  });
});
