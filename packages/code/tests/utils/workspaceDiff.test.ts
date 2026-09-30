import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  getWorkspaceDiff,
  MAX_DIFF_LINES,
} from "../../src/utils/workspaceDiff.js";
import type { WorkspaceDiffResult } from "../../src/utils/workspaceDiff.js";

/**
 * workspaceDiff shells out via `promisify(execFile)` bound at module load. The
 * mock therefore implements the promisify-custom signature (resolved value =
 * { stdout }) and dispatches on the git args that follow `-C <cwd>`.
 */

const h = vi.hoisted(() => ({
  // Receives git args (after `-C cwd`); return stdout or throw.
  gitHandler: (args: string[]): string => {
    throw new Error(`git not stubbed: ${args.join(" ")}`);
  },
  // Every git invocation, in order — lets tests assert on what was NOT called
  // (no patch for binaries, no ls-files for one commit).
  gitCommands: [] as string[],
  // Whole-tree `git diff <rev>` calls (no pathspec) and per-file fallback
  // calls (pathspec after `--`), recorded separately so a test can tell which
  // path the hunks actually came from.
  wholeTreeCalls: [] as string[],
  perFileCalls: [] as string[],
  // Untracked-file fs stubs.
  statResult: null as null | { isFile: boolean; size: number },
  fileContent: null as null | Buffer,
}));

vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const execFileMock = Object.assign(vi.fn(), {
    [promisify.custom]: (file: string, args: string[]) => {
      // The diff service always shells out to git — never ssh. It runs on the
      // host that owns the repository (spec desktop-sessions.md scenario 14).
      if (file !== "git") throw new Error(`unexpected executable: ${file}`);
      return Promise.resolve({ stdout: h.gitHandler(args.slice(2)) });
    },
  });
  return { execFile: execFileMock };
});

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(async () => {
        const stat = h.statResult;
        if (!stat) throw new Error("ENOENT");
        return { isFile: () => stat.isFile, size: stat.size };
      }),
      readFile: vi.fn(async () => {
        if (!h.fileContent) throw new Error("ENOENT");
        return h.fileContent;
      }),
    },
  };
});

const CWD = "/repo";
const HEAD_SHA = "head123";

interface StubMap {
  /** false → the repo has no commit yet. */
  hasHead?: boolean;
  /** `refs/remotes/origin/HEAD` target; null → not a symbolic ref. */
  originHead?: string | null;
  /** The remote-tracking default branch no longer exists (stale symref). */
  staleRemote?: boolean;
  localMain?: boolean;
  localMaster?: boolean;
  /** null → no common ancestor with the default branch. */
  mergeBase?: string | null;
  /** `--name-status -z` records. */
  nameStatus?: string;
  /** `--numstat -z` records. */
  numstat?: string;
  /** `ls-files --others --exclude-standard -z` records. */
  untracked?: string;
  /** `log …` records. */
  log?: string;
  /** The single whole-tree `git diff` output. */
  wholeTreePatch?: string;
  /** Per-file patches, keyed by the joined pathspec (fallback path only). */
  patch?: Record<string, string>;
  /** `rev-parse --show-toplevel`. */
  toplevel?: string;
}

/** The whole-tree patch call: `git diff <rev>` with no pathspec and no `--name-status`/`--numstat`. */
function isWholeTreeDiff(args: string[]): boolean {
  return (
    args[0] === "diff" &&
    !args.includes("--name-status") &&
    !args.includes("--numstat") &&
    !args.includes("--")
  );
}

/**
 * Standard stub: a repo branched off `origin/main` at `base123`, with per-command
 * stdout from the map. The unknown-command throw is deliberate — it turns any
 * git command shape change into a loud failure instead of a silent empty diff.
 */
function stubGit(map: StubMap = {}) {
  const hasHead = map.hasHead !== false;
  const originHead =
    map.originHead === undefined ? "origin/main" : map.originHead;
  const mergeBase = map.mergeBase === undefined ? "base123" : map.mergeBase;
  h.gitHandler = (args) => {
    const key = args.join(" ");
    h.gitCommands.push(key);
    if (key === "rev-parse --is-inside-work-tree") return "true\n";
    if (key === "rev-parse --show-toplevel") return `${map.toplevel ?? ""}\n`;
    if (key === "rev-parse --verify HEAD") {
      if (!hasHead) throw new Error("fatal: Needed a single revision");
      return `${HEAD_SHA}\n`;
    }
    if (
      args[0] === "rev-parse" &&
      args[1] === "--verify" &&
      args[2] === "--quiet"
    ) {
      const ref = args[3] ?? "";
      if (ref.startsWith("refs/remotes/"))
        return map.staleRemote
          ? (() => {
              throw new Error("fatal: bad revision");
            })()
          : `${HEAD_SHA}\n`;
      if (ref === "refs/heads/main^{commit}") {
        if (map.localMain === false) throw new Error("fatal: bad revision");
        return "main456\n";
      }
      if (ref === "refs/heads/master^{commit}") {
        if (!map.localMaster) throw new Error("fatal: bad revision");
        return "master789\n";
      }
      throw new Error(`fatal: bad revision ${ref}`);
    }
    if (args[0] === "symbolic-ref") {
      if (!originHead) throw new Error("fatal: ref is not a symbolic ref");
      return `${originHead}\n`;
    }
    if (args[0] === "merge-base") {
      if (mergeBase === null) throw new Error("fatal: no merge base");
      return `${mergeBase}\n`;
    }
    if (args[0] === "log") return map.log ?? "";
    if (args[0] === "ls-files") return map.untracked ?? "";
    if (args[0] === "diff") {
      if (args.includes("--name-status")) return map.nameStatus ?? "";
      if (args.includes("--numstat")) return map.numstat ?? "";
      const sep = args.indexOf("--");
      // No pathspec → the whole-tree patch every file's hunks come from.
      if (isWholeTreeDiff(args)) {
        h.wholeTreeCalls.push(key);
        return map.wholeTreePatch ?? "";
      }
      const paths = args.slice(sep + 1).join(" ");
      h.perFileCalls.push(paths);
      return map.patch?.[paths] ?? "";
    }
    throw new Error(`unexpected git args: ${key}`);
  };
}

/** Successful result or a loud failure (keeps each test free of narrowing). */
async function ok(
  cwd = CWD,
  options?: { commit?: string },
): Promise<Extract<WorkspaceDiffResult, { kind: "ok" }>> {
  const result = await getWorkspaceDiff(cwd, options);
  if (result.kind !== "ok")
    throw new Error(`expected an ok result, got ${result.kind}`);
  return result;
}

/** Two files' worth of one `git diff <rev>` output, blocks in path order. */
function wholeTree(...blocks: string[]): string {
  return blocks.join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  h.statResult = null;
  h.fileContent = null;
  h.gitCommands = [];
  h.wholeTreeCalls = [];
  h.perFileCalls = [];
});

describe("getWorkspaceDiff", () => {
  it("returns not-a-repo when rev-parse fails", async () => {
    h.gitHandler = () => {
      throw new Error("not a git repository");
    };
    expect(await getWorkspaceDiff(CWD)).toEqual({ kind: "not-a-repo" });
  });

  it("returns an empty file list when the worktree is clean", async () => {
    stubGit();
    const result = await ok();
    expect(result.files).toEqual([]);
    expect(result.scope).toEqual({ kind: "all" });
    // Nothing changed → no patch is worth fetching at all.
    expect(h.wholeTreeCalls).toEqual([]);
  });

  it("takes every changed file's hunks from ONE whole-tree diff", async () => {
    stubGit({
      nameStatus: "M\0src/a.ts\0M\0src/b.ts\0",
      numstat: "3\t1\tsrc/a.ts\u00002\t0\tsrc/b.ts\u0000",
      wholeTreePatch: wholeTree(
        [
          "diff --git a/src/a.ts b/src/a.ts",
          "index 111..222 100644",
          "--- a/src/a.ts",
          "+++ b/src/a.ts",
          "@@ -1,2 +1,4 @@",
          " ctx",
          "-old",
          "+new1",
          "+new2",
          "+new3",
        ].join("\n"),
        ["diff --git a/src/b.ts b/src/b.ts", "@@ -1 +1,3 @@", "+x", "+y"].join(
          "\n",
        ),
      ),
    });
    const result = await ok();
    expect(result.files).toEqual([
      {
        path: "src/a.ts",
        status: "modified",
        oldPath: undefined,
        additions: 3,
        deletions: 1,
        hunks: "@@ -1,2 +1,4 @@\n ctx\n-old\n+new1\n+new2\n+new3",
        truncated: false,
        binary: false,
      },
      {
        path: "src/b.ts",
        status: "modified",
        oldPath: undefined,
        additions: 2,
        deletions: 0,
        hunks: "@@ -1 +1,3 @@\n+x\n+y",
        truncated: false,
        binary: false,
      },
    ]);
    // One git process for both files — the whole point of the change.
    expect(h.wholeTreeCalls).toHaveLength(1);
    expect(h.perFileCalls).toEqual([]);
  });

  it("matches a renamed file's block by its old→new header", async () => {
    stubGit({
      nameStatus: "R100\0src/old.ts\0src/new.ts\0",
      numstat: "1\t2\t\0src/old.ts\0src/new.ts\0",
      wholeTreePatch: wholeTree(
        [
          "diff --git a/src/old.ts b/src/new.ts",
          "similarity index 80%",
          "rename from src/old.ts",
          "rename to src/new.ts",
          "--- a/src/old.ts",
          "+++ b/src/new.ts",
          "@@ -1,2 +1,2 @@",
          "-before",
          "+after",
        ].join("\n"),
      ),
    });
    const result = await ok();
    expect(result.files).toEqual([
      {
        path: "src/new.ts",
        oldPath: "src/old.ts",
        status: "renamed",
        additions: 1,
        deletions: 2,
        hunks: "@@ -1,2 +1,2 @@\n-before\n+after",
        truncated: false,
        binary: false,
      },
    ]);
    expect(h.perFileCalls).toEqual([]);
  });

  it("re-fetches per file when the whole-tree header does not match", async () => {
    // git quotes paths in the `diff --git` header (`core.quotePath`), so the
    // index misses them: the per-file call covers the gap rather than leaving
    // the file with no hunks at all.
    stubGit({
      nameStatus: "M\0中文.ts\0",
      numstat: "1\t0\t中文.ts\0",
      wholeTreePatch: 'diff --git "a/中文.ts" "b/中文.ts"\n@@ -1 +1 @@\n+x',
      patch: { "中文.ts": "@@ -1 +1 @@\n+y" },
    });
    const result = await ok();
    expect(result.files[0].hunks).toBe("@@ -1 +1 @@\n+y");
    // Both paths must be passed: limiting the pathspec to the new path turns
    // rename detection off, and the patch then reads as a full file rewrite.
    expect(h.perFileCalls).toEqual(["中文.ts"]);
  });

  it("falls back per file when the whole-tree diff fails outright", async () => {
    // A whole-tree patch past maxBuffer makes execFile reject, which the
    // whole-tree fetch swallows — the per-file calls are then the safety net
    // rather than an empty panel.
    stubGit({
      nameStatus: "M\0src/a.ts\0",
      numstat: "1\t0\tsrc/a.ts\0",
      patch: { "src/a.ts": "@@ -1 +1,2 @@\n ctx\n+added" },
    });
    const inner = h.gitHandler;
    h.gitHandler = (args) => {
      if (isWholeTreeDiff(args))
        throw new Error("stdout maxBuffer length exceeded");
      return inner(args);
    };
    const result = await ok();
    expect(result.files[0].hunks).toBe("@@ -1 +1,2 @@\n ctx\n+added");
    expect(h.perFileCalls).toEqual(["src/a.ts"]);
  });

  it('marks binary tracked files from "-" numstat and skips the patch call', async () => {
    stubGit({ nameStatus: "M\0img.png\0", numstat: "-\t-\timg.png\0" });
    const result = await ok();
    expect(result.files[0]).toMatchObject({
      path: "img.png",
      binary: true,
      hunks: "",
    });
    expect(h.perFileCalls).toEqual([]);
  });

  it("reads a rename's OLD path first and the NEW path second", async () => {
    // The record order is the opposite of `status --porcelain -z` (which puts
    // the new path first), and the two fixture names differ on purpose: with
    // equal names the two parsings are indistinguishable.
    stubGit({
      nameStatus: "R100\0src/old.ts\0src/new.ts\0",
      numstat: "1\t2\t\0src/old.ts\0src/new.ts\0",
      patch: {
        "src/old.ts src/new.ts": [
          "diff --git a/src/old.ts b/src/new.ts",
          "@@ -1,2 +1,2 @@",
          "-before",
          "+after",
        ].join("\n"),
      },
    });
    const result = await ok();
    expect(result.files).toEqual([
      {
        path: "src/new.ts",
        oldPath: "src/old.ts",
        status: "renamed",
        additions: 1,
        deletions: 2,
        hunks: "@@ -1,2 +1,2 @@\n-before\n+after",
        truncated: false,
        binary: false,
      },
    ]);
    // Both pathspecs are passed: the new path alone disables rename detection.
    expect(h.perFileCalls).toEqual(["src/old.ts src/new.ts"]);
  });

  it("skips the patch call for a file with no net change", async () => {
    // A pure rename: no hunks to fetch, so no lookup is worth doing at all.
    stubGit({
      nameStatus: "R100\0src/old.ts\0src/new.ts\0",
      numstat: "0\t0\t\0src/old.ts\0src/new.ts\0",
    });
    const result = await ok();
    expect(result.files[0]).toMatchObject({
      path: "src/new.ts",
      oldPath: "src/old.ts",
      status: "renamed",
      additions: 0,
      deletions: 0,
      hunks: "",
    });
    expect(h.perFileCalls).toEqual([]);
    expect(h.wholeTreeCalls).toHaveLength(1);
  });

  it("diffs against --cached when the repo has no HEAD commit", async () => {
    stubGit({ hasHead: false, nameStatus: "A\0staged.ts\0" });
    const result = await ok();
    expect(result.base).toEqual({
      label: "索引",
      sha: null,
      kind: "index",
      ref: null,
    });
    const diffCalls = h.gitCommands.filter((c) => c.startsWith("diff "));
    expect(diffCalls.length).toBeGreaterThan(0);
    for (const call of diffCalls) expect(call).toContain("--cached");
    // Nothing to list without HEAD, and no range to walk.
    expect(h.gitCommands.some((c) => c.startsWith("log "))).toBe(false);
  });

  it("reads untracked text files as all-added hunks", async () => {
    stubGit({ untracked: "notes.txt\0" });
    h.statResult = { isFile: true, size: 12 };
    h.fileContent = Buffer.from("hello\nworld\n");
    const result = await ok();
    expect(result.files).toEqual([
      {
        path: "notes.txt",
        status: "untracked",
        oldPath: undefined,
        additions: 2,
        deletions: 0,
        hunks: "+hello\n+world",
        truncated: false,
        binary: false,
      },
    ]);
  });

  it("treats untracked files containing NUL bytes as binary", async () => {
    stubGit({ untracked: "blob.bin\0" });
    h.statResult = { isFile: true, size: 4 };
    h.fileContent = Buffer.from([0x41, 0x00, 0x42, 0x43]);
    const result = await ok();
    expect(result.files[0]).toMatchObject({
      path: "blob.bin",
      binary: true,
      hunks: "",
    });
  });

  it("treats oversized untracked files as binary without reading them", async () => {
    stubGit({ untracked: "huge.log\0" });
    h.statResult = { isFile: true, size: 3 * 1024 * 1024 };
    const result = await ok();
    expect(result.files[0]).toMatchObject({ path: "huge.log", binary: true });
    expect(h.fileContent).toBeNull();
  });

  it("keeps a vanished untracked file as an unreadable entry (race tolerance)", async () => {
    stubGit({ untracked: "gone.txt\0" });
    // statResult stays null → stat rejects (ENOENT)
    const result = await ok();
    expect(result.files[0]).toMatchObject({
      path: "gone.txt",
      status: "untracked",
      binary: true,
    });
  });

  it("resolves untracked paths against the repo root, not a subdirectory cwd", async () => {
    // Diff output paths are relative to the repo root even when cwd is a
    // subdirectory. A naive path.join(cwd, path) would double up the prefix,
    // miss the file, and fall back to "binary".
    const SUBCWD = "/repo/packages/desktop";
    const ROOT = "/repo";
    const relPath = "packages/desktop/scripts/prerun.mjs";
    stubGit({ untracked: `${relPath}\0`, toplevel: ROOT });
    const correctAbs = path.join(ROOT, relPath);
    vi.mocked(fs.promises.stat).mockImplementationOnce(async (p) => {
      if (p === correctAbs)
        return { isFile: () => true, size: 5 } as unknown as Awaited<
          ReturnType<typeof fs.promises.stat>
        >;
      throw new Error("ENOENT");
    });
    vi.mocked(fs.promises.readFile).mockImplementationOnce(async (p) => {
      if (p === correctAbs) return Buffer.from("hello");
      throw new Error("ENOENT");
    });
    const result = await ok(SUBCWD);
    expect(result.files[0]).toMatchObject({
      path: relPath,
      status: "untracked",
      binary: false,
      hunks: "+hello",
    });
  });

  it("truncates per-file hunks beyond MAX_DIFF_LINES", async () => {
    const body = [
      "@@ -1 +1 @@",
      ...Array.from({ length: MAX_DIFF_LINES + 50 }, (_, i) => `+line${i}`),
    ];
    stubGit({
      nameStatus: "M\0big.ts\0",
      numstat: `${MAX_DIFF_LINES + 50}\t0\tbig.ts\0`,
      wholeTreePatch: wholeTree(
        ["diff --git a/big.ts b/big.ts", ...body].join("\n"),
      ),
    });
    const result = await ok();
    expect(result.files[0].truncated).toBe(true);
    expect(result.files[0].hunks.split("\n")).toHaveLength(MAX_DIFF_LINES);
  });

  // -- base resolution (spec scenario 2) ------------------------------------

  it("diffs against the fork point with the default branch, not HEAD", async () => {
    stubGit({ nameStatus: "M\0src/a.ts\0", numstat: "3\t1\tsrc/a.ts\0" });
    const result = await ok();
    expect(result.base).toEqual({
      label: "origin/main",
      sha: "base123",
      kind: "default-branch",
      ref: "refs/remotes/origin/main",
    });
    // The merge base is the revision every diff is taken against — diffing HEAD
    // would hide everything the agent already committed.
    const diffCalls = h.gitCommands.filter((c) => c.startsWith("diff "));
    expect(diffCalls.length).toBeGreaterThan(0);
    for (const call of diffCalls) expect(call).toContain("base123");
    for (const call of diffCalls) expect(call).not.toContain("HEAD");
  });

  it("falls back to a local main, then master, when origin/HEAD is unset", async () => {
    stubGit({ originHead: null, nameStatus: "M\0a.ts\0" });
    expect((await ok()).base).toEqual({
      label: "main",
      sha: "base123",
      kind: "default-branch",
      ref: "refs/heads/main",
    });

    stubGit({
      originHead: null,
      localMain: false,
      localMaster: true,
      nameStatus: "M\0a.ts\0",
    });
    expect((await ok()).base.label).toBe("master");
  });

  it("skips a stale origin/HEAD pointing at a deleted branch", async () => {
    stubGit({ staleRemote: true, nameStatus: "M\0a.ts\0" });
    expect((await ok()).base).toMatchObject({
      label: "main",
      kind: "default-branch",
    });
  });

  it("falls back to HEAD when no default branch exists at all", async () => {
    stubGit({
      originHead: null,
      localMain: false,
      nameStatus: "M\0a.ts\0",
      numstat: "1\t0\ta.ts\0",
    });
    const result = await ok();
    expect(result.base).toEqual({
      label: "HEAD",
      sha: HEAD_SHA,
      kind: "head",
      ref: null,
    });
    expect(result.commits).toEqual([]);
    for (const call of h.gitCommands.filter((c) => c.startsWith("diff ")))
      expect(call).toContain("HEAD");
    // HEAD..HEAD can never contain a commit, so the log call is skipped.
    expect(h.gitCommands.some((c) => c.startsWith("log "))).toBe(false);
  });

  it("falls back to HEAD when the fork point cannot be determined", async () => {
    stubGit({ mergeBase: null, nameStatus: "M\0a.ts\0" });
    expect((await ok()).base).toEqual({
      label: "HEAD",
      sha: HEAD_SHA,
      kind: "head",
      ref: null,
    });
  });

  it("lists the session's own commits newest first, merges excluded", async () => {
    stubGit({
      log: [
        "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb second commit",
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa first commit",
      ].join("\0"),
    });
    const result = await ok();
    expect(result.commits).toEqual([
      {
        sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        shortSha: "bbbbbbb",
        subject: "second commit",
      },
      {
        sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        shortSha: "aaaaaaa",
        subject: "first commit",
      },
    ]);
    const logCall = h.gitCommands.find((c) => c.startsWith("log "));
    expect(logCall).toContain("--no-merges");
    expect(logCall).toContain("base123..HEAD");
  });

  // -- single-commit scope (spec 提交选择) -----------------------------------

  it("diffs one commit against its own parent and skips untracked files", async () => {
    const sha = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    stubGit({
      log: `${sha} first commit\0`,
      nameStatus: "M\0src/a.ts\0",
      numstat: "2\t1\tsrc/a.ts\0",
      untracked: "notes.txt\0",
      wholeTreePatch: wholeTree(
        [
          "diff --git a/src/a.ts b/src/a.ts",
          "@@ -1,1 +1,2 @@",
          " ctx",
          "+added",
        ].join("\n"),
      ),
    });
    const result = await ok(CWD, { commit: sha });
    expect(result.scope).toEqual({
      kind: "commit",
      sha,
      shortSha: "aaaaaaa",
      subject: "first commit",
    });
    expect(result.files.map((f) => f.path)).toEqual(["src/a.ts"]);
    for (const call of h.gitCommands.filter((c) => c.startsWith("diff ")))
      expect(call).toContain(`${sha}^!`);
    // A commit cannot contain untracked files, so the worktree is not queried.
    expect(h.gitCommands.some((c) => c.startsWith("ls-files"))).toBe(false);
  });

  it("falls back to the whole range when the commit is no longer reachable", async () => {
    // A rebase leaves the old object dangling: existence is not the test,
    // membership in the session's own range is.
    stubGit({
      log: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb rebased\0",
      nameStatus: "M\0src/a.ts\0",
      numstat: "2\t1\tsrc/a.ts\0",
    });
    const result = await ok(CWD, {
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(result.scope).toEqual({ kind: "all" });
    for (const call of h.gitCommands.filter((c) => c.startsWith("diff ")))
      expect(call).toContain("base123");
  });
});
