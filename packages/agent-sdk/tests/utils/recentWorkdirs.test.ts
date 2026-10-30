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
/** Paths that exist as *files* on the fixture machine (git pointers, commondir). */
const files = new Map<string, string>();
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
  statSync: (path: string) => ({ isFile: () => files.has(path) }),
  readFileSync: (path: string) => {
    if (readShouldThrow) throw new Error("EACCES");
    const content = files.get(path);
    if (content !== undefined) return content;
    if (path === join(HOME, ".wave", "recent-workdirs.json")) {
      return reads.length ? reads[reads.length - 1] : "";
    }
    // Only the stub's own files exist: a gitdir that points nowhere must read
    // as "cannot tell", not as the recent-workdirs JSON.
    throw new Error("ENOENT");
  },
}));

vi.mock("../../src/utils/atomicWrite.js", () => ({
  atomicWriteFileSync: (path: string, data: string) => {
    if (writeShouldThrow) throw new Error("EROFS");
    writes.push({ path, data });
  },
}));

const {
  MAX_RECENT_WORKDIRS,
  forgetRecentWorkdir,
  readRecentWorkdirs,
  rememberRecentWorkdir,
} = await import("../../src/utils/recentWorkdirs.js");

function store(dirs: unknown): void {
  reads.push(JSON.stringify({ dirs }));
}

function lastWritten(): string[] {
  return JSON.parse(writes[writes.length - 1].data).dirs;
}

/** A linked worktree of `repoRoot` named `name`, as git lays it out on disk. */
function makeWorktree(repoRoot: string, name: string): string {
  const worktree = join(repoRoot, ".wave", "worktrees", name);
  const gitDir = join(repoRoot, ".git", "worktrees", name);
  files.set(join(worktree, ".git"), `gitdir: ${gitDir}\n`);
  files.set(join(gitDir, "commondir"), "../..\n");
  return worktree;
}

beforeEach(() => {
  reads.length = 0;
  writes.length = 0;
  files.clear();
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

  it("shows a stored worktree path as its repository root, merged with it", () => {
    const repo = resolve("/mock/repo");
    const worktree = makeWorktree(repo, "wt");
    store([worktree, repo]);

    expect(readRecentWorkdirs()).toEqual([repo]);
  });

  it("keeps a directory that only looks like a worktree (no commondir)", () => {
    const submodule = resolve("/mock/submodule");
    files.set(join(submodule, ".git"), "gitdir: ../.git/modules/sub\n");
    store([submodule]);

    expect(readRecentWorkdirs()).toEqual([submodule]);
  });

  it("maps a worktree that is already gone, by Wave's own layout", () => {
    const repo = resolve("/mock/repo");
    // 会话删掉后目录与 git 元数据都没了：只剩 `.wave/worktrees/<name>` 这个
    // 布局能证明它曾经是工作树。
    store([join(repo, ".wave", "worktrees", "gone")]);

    expect(readRecentWorkdirs()).toEqual([repo]);
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

  it("records a worktree as its repository root and merges the stored entry", () => {
    const repo = resolve("/mock/repo");
    const worktree = makeWorktree(repo, "wt");
    store([worktree]);

    rememberRecentWorkdir(worktree);

    expect(lastWritten()).toEqual([repo]);
  });
});

describe("forgetRecentWorkdir", () => {
  it("removes the directory and writes the rest back", () => {
    store(["/b", "/a"]);
    forgetRecentWorkdir("/a");

    expect(lastWritten()).toEqual(["/b"]);
  });

  it("also removes a stored worktree path for the same repository", () => {
    const repo = resolve("/mock/repo");
    const worktree = makeWorktree(repo, "wt");
    store([worktree, "/other"]);

    forgetRecentWorkdir(repo);

    expect(lastWritten()).toEqual(["/other"]);
  });

  it("does nothing when the directory is not in the list", () => {
    store(["/b"]);
    forgetRecentWorkdir("/gone");
    forgetRecentWorkdir("   ");

    expect(writes).toHaveLength(0);
  });

  it("never throws on a failed write", () => {
    store(["/a"]);
    writeShouldThrow = true;

    expect(() => forgetRecentWorkdir("/a")).not.toThrow();
  });
});
