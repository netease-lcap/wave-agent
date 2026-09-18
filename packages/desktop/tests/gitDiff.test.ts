import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { getWorkspaceDiff, MAX_DIFF_LINES } from "../src/main/gitDiff";
import type { WorkspaceDiffResult } from "../src/main/gitDiff";

/**
 * gitDiff shells out via `promisify(execFile)` bound at module load. The mock
 * therefore implements the promisify-custom signature (resolved value =
 * { stdout }) and dispatches on the git args that follow `-C <cwd>`.
 */

const h = vi.hoisted(() => ({
  // Receives git args (after `-C cwd`); return stdout or throw.
  gitHandler: (args: string[]): string => {
    throw new Error(`git not stubbed: ${args.join(" ")}`);
  },
  // Every git invocation (local or via ssh), in order — lets tests assert on
  // what was NOT called (no patch for binaries, no ls-files for one commit).
  gitCommands: [] as string[],
  // Receives the ssh argv (base options + host + remote command); dispatches
  // stat/cat/git commands and records every remote command issued.
  sshHandler: (args: string[]): string | Buffer => {
    throw new Error(`ssh not stubbed: ${args.join(" ")}`);
  },
  sshCommands: [] as string[],
  // Remote untracked-file fixtures, keyed by absolute remote path.
  remoteFiles: {} as Record<string, { size: number; content: Buffer }>,
  // Untracked-file fs stubs.
  statResult: null as null | { isFile: boolean; size: number },
  fileContent: null as null | Buffer,
}));

/** Unwrap a shellQuote'd token (single quotes, no embedded quotes in fixtures). */
function unquote(t: string): string {
  return t.length >= 2 && t.startsWith("'") && t.endsWith("'")
    ? t.slice(1, -1)
    : t;
}

/**
 * Default ssh dispatcher: records the remote command, then routes it like the
 * real implementation — `stat -c %s` → size, `cat` → content bytes, and
 * `git -C <cwd> …` → the git handler (reconstructed as local git args).
 */
function defaultSshHandler(args: string[]): string | Buffer {
  const remoteCmd = args[args.length - 1];
  h.sshCommands.push(remoteCmd);
  const statM = /^stat -c %s (.+)$/.exec(remoteCmd);
  if (statM) {
    const f = h.remoteFiles[unquote(statM[1])];
    if (!f) throw new Error(`stat: cannot stat ${statM[1]}`);
    return String(f.size);
  }
  const catM = /^cat (.+)$/.exec(remoteCmd);
  if (catM) {
    const f = h.remoteFiles[unquote(catM[1])];
    if (!f) throw new Error(`cat: ${catM[1]}: No such file or directory`);
    return f.content;
  }
  const gitM = /^git -C '([^']*)' (.*)$/.exec(remoteCmd);
  if (gitM) {
    const gitArgs = gitM[2].split(" ").map(unquote);
    return h.gitHandler(gitArgs);
  }
  throw new Error(`unexpected ssh command: ${remoteCmd}`);
}

vi.mock("child_process", async () => {
  const { promisify } = await import("util");
  const execFileMock = Object.assign(vi.fn(), {
    [promisify.custom]: (file: string, args: string[]) => {
      if (file === "ssh")
        return Promise.resolve({ stdout: h.sshHandler(args) });
      return Promise.resolve({ stdout: h.gitHandler(args.slice(2)) });
    },
  });
  return { execFile: execFileMock };
});

vi.mock("fs", async () => {
  const actual = await vi.importActual<typeof import("fs")>("fs");
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(async () => {
        if (!h.statResult) throw new Error("ENOENT");
        return { isFile: () => h.statResult.isFile, size: h.statResult.size };
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
  /** Per-file patches, keyed by the joined pathspec. */
  patch?: Record<string, string>;
  /** `rev-parse --show-toplevel`. */
  toplevel?: string;
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
      const paths = args.slice(args.indexOf("--") + 1).join(" ");
      return map.patch?.[paths] ?? "";
    }
    throw new Error(`unexpected git args: ${key}`);
  };
}

/** Successful result or a loud failure (keeps each test free of narrowing). */
async function ok(
  cwd = CWD,
  host?: string,
  options?: { commit?: string },
): Promise<Extract<WorkspaceDiffResult, { kind: "ok" }>> {
  const result = await getWorkspaceDiff(cwd, host, options);
  if (result.kind !== "ok")
    throw new Error(`expected an ok result, got ${result.kind}`);
  return result;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.statResult = null;
  h.fileContent = null;
  h.sshCommands = [];
  h.gitCommands = [];
  h.remoteFiles = {};
  h.sshHandler = defaultSshHandler;
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
  });

  it("parses a modified tracked file with numstat and hunks from the first @@", async () => {
    stubGit({
      nameStatus: "M\0src/a.ts\0",
      numstat: "3\t1\tsrc/a.ts\0",
      patch: {
        "src/a.ts": [
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
      },
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
    ]);
  });

  it('marks binary tracked files from "-" numstat and skips the patch call', async () => {
    stubGit({ nameStatus: "M\0img.png\0", numstat: "-\t-\timg.png\0" });
    const result = await ok();
    expect(result.files[0]).toMatchObject({
      path: "img.png",
      binary: true,
      hunks: "",
    });
    expect(h.gitCommands.some((c) => c.includes(" -- img.png"))).toBe(false);
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
          "similarity index 80%",
          "rename from src/old.ts",
          "rename to src/new.ts",
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
    expect(
      h.gitCommands.some((c) => c.endsWith("-- src/old.ts src/new.ts")),
    ).toBe(true);
  });

  it("skips the patch call for a file with no net change", async () => {
    // A pure rename: no hunks to fetch, so the extra git call is wasted.
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
    expect(h.gitCommands.some((c) => c.endsWith("src/new.ts"))).toBe(false);
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
      patch: { "big.ts": body.join("\n") },
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
      patch: {
        "src/a.ts": "@@ -1,1 +1,2 @@\n ctx\n+added",
      },
    });
    const result = await ok(CWD, undefined, { commit: sha });
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
    const result = await ok(CWD, undefined, {
      commit: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    });
    expect(result.scope).toEqual({ kind: "all" });
    for (const call of h.gitCommands.filter((c) => c.startsWith("diff ")))
      expect(call).toContain("base123");
  });

  // -- remote hosts (spec scenario 14) --------------------------------------

  it("runs git over ssh for remote hosts with the quoted remote cwd", async () => {
    stubGit({
      nameStatus: "M\0src/a.ts\0",
      numstat: "3\t1\tsrc/a.ts\0",
      patch: {
        "src/a.ts": [
          "diff --git a/src/a.ts b/src/a.ts",
          "@@ -1,2 +1,4 @@",
          "-old",
          "+new1",
          "+new2",
          "+new3",
        ].join("\n"),
      },
    });
    const result = await ok("/remote/repo", "myhost");
    expect(result.files).toEqual([
      {
        path: "src/a.ts",
        status: "modified",
        oldPath: undefined,
        additions: 3,
        deletions: 1,
        hunks: "@@ -1,2 +1,4 @@\n-old\n+new1\n+new2\n+new3",
        truncated: false,
        binary: false,
      },
    ]);
    expect(h.sshCommands[0]).toBe(
      "git -C '/remote/repo' 'rev-parse' '--is-inside-work-tree'",
    );
    // Every git invocation went through ssh, never the local `git` executable.
    expect(h.sshCommands.length).toBeGreaterThan(0);
  });

  it("returns not-a-repo when the remote ssh probe fails", async () => {
    h.sshHandler = () => {
      throw new Error("Connection refused");
    };
    expect(await getWorkspaceDiff("/remote/repo", "dead-host")).toEqual({
      kind: "not-a-repo",
    });
  });

  it("reads remote untracked files via ssh stat + cat", async () => {
    stubGit({ untracked: "notes.txt\0" });
    // path.join keeps the fixture key identical to the abs path the source
    // builds (backslash-separated on Windows, forward-slash on POSIX).
    const remoteAbs = path.join("/remote/repo", "notes.txt");
    h.remoteFiles[remoteAbs] = {
      size: 12,
      content: Buffer.from("hello\nworld\n"),
    };
    const result = await ok("/remote/repo", "myhost");
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
    expect(h.sshCommands).toContain(`stat -c %s '${remoteAbs}'`);
    expect(h.sshCommands).toContain(`cat '${remoteAbs}'`);
  });

  it("treats oversized remote untracked files as binary without downloading them", async () => {
    stubGit({ untracked: "huge.log\0" });
    h.remoteFiles["/remote/repo/huge.log"] = {
      size: 3 * 1024 * 1024,
      content: Buffer.from("x"),
    };
    const result = await ok("/remote/repo", "myhost");
    expect(result.files[0]).toMatchObject({
      path: "huge.log",
      binary: true,
      hunks: "",
    });
    expect(h.sshCommands.some((c) => c.startsWith("cat "))).toBe(false);
  });

  it("keeps a vanished remote untracked file as an unreadable entry", async () => {
    stubGit({ untracked: "gone.txt\0" });
    // remoteFiles has no entry → the remote stat rejects.
    const result = await ok("/remote/repo", "myhost");
    expect(result.files[0]).toMatchObject({
      path: "gone.txt",
      status: "untracked",
      binary: true,
    });
  });
});
