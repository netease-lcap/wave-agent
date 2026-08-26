import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { getWorkspaceDiff, MAX_DIFF_LINES } from "../src/main/gitDiff";

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

/** Standard stub: repo with HEAD; per-command stdout via the given map. */
function stubGit(map: {
  hasHead?: boolean;
  status?: string;
  numstat?: Record<string, string>;
  patch?: Record<string, string>;
}) {
  h.gitHandler = (args) => {
    const key = args.join(" ");
    if (key === "rev-parse --is-inside-work-tree") return "true\n";
    if (key === "rev-parse --verify HEAD") {
      if (map.hasHead === false) throw new Error("no HEAD");
      return "abc123\n";
    }
    if (args[0] === "status") return map.status ?? "";
    if (args[0] === "diff" && args.includes("--numstat")) {
      const path = args[args.length - 1];
      return map.numstat?.[path] ?? "";
    }
    if (args[0] === "diff") {
      const path = args[args.length - 1];
      return map.patch?.[path] ?? "";
    }
    throw new Error(`unexpected git args: ${key}`);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.statResult = null;
  h.fileContent = null;
  h.sshCommands = [];
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
    stubGit({ status: "" });
    expect(await getWorkspaceDiff(CWD)).toEqual({ kind: "ok", files: [] });
  });

  it("parses a modified tracked file with numstat and hunks from the first @@", async () => {
    stubGit({
      status: " M src/a.ts\0",
      numstat: { "src/a.ts": "3\t1\tsrc/a.ts\n" },
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
    const result = await getWorkspaceDiff(CWD);
    expect(result).toEqual({
      kind: "ok",
      files: [
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
      ],
    });
  });

  it('marks binary tracked files from "-" numstat and skips the patch call', async () => {
    let patchRequested = false;
    stubGit({
      status: " M img.png\0",
      numstat: { "img.png": "-\t-\timg.png\n" },
    });
    const inner = h.gitHandler;
    h.gitHandler = (args) => {
      if (args[0] === "diff" && !args.includes("--numstat"))
        patchRequested = true;
      return inner(args);
    };
    const result = await getWorkspaceDiff(CWD);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.files[0]).toMatchObject({
      path: "img.png",
      binary: true,
      hunks: "",
    });
    expect(patchRequested).toBe(false);
  });

  it("parses renames: the second NUL record is the source path", async () => {
    stubGit({
      status: "R  src/new.ts\0src/old.ts\0",
      numstat: { "src/new.ts": "0\t0\tsrc/new.ts\n" },
      patch: { "src/new.ts": "" },
    });
    const result = await getWorkspaceDiff(CWD);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.files[0]).toMatchObject({
      path: "src/new.ts",
      oldPath: "src/old.ts",
      status: "renamed",
    });
  });

  it("diffs against --cached when the repo has no HEAD commit", async () => {
    const seen: string[][] = [];
    stubGit({ hasHead: false, status: "A  staged.ts\0" });
    const inner = h.gitHandler;
    h.gitHandler = (args) => {
      if (args[0] === "diff") seen.push(args);
      return inner(args);
    };
    const result = await getWorkspaceDiff(CWD);
    expect(result.kind).toBe("ok");
    expect(seen.length).toBeGreaterThan(0);
    for (const args of seen) expect(args).toContain("--cached");
  });

  it("reads untracked text files as all-added hunks", async () => {
    stubGit({ status: "?? notes.txt\0" });
    h.statResult = { isFile: true, size: 12 };
    h.fileContent = Buffer.from("hello\nworld\n");
    const result = await getWorkspaceDiff(CWD);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.files[0]).toEqual({
      path: "notes.txt",
      status: "untracked",
      oldPath: undefined,
      additions: 2,
      deletions: 0,
      hunks: "+hello\n+world",
      truncated: false,
      binary: false,
    });
  });

  it("treats untracked files containing NUL bytes as binary", async () => {
    stubGit({ status: "?? blob.bin\0" });
    h.statResult = { isFile: true, size: 4 };
    h.fileContent = Buffer.from([0x41, 0x00, 0x42, 0x43]);
    const result = await getWorkspaceDiff(CWD);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.files[0]).toMatchObject({
      path: "blob.bin",
      binary: true,
      hunks: "",
    });
  });

  it("treats oversized untracked files as binary without reading them", async () => {
    stubGit({ status: "?? huge.log\0" });
    h.statResult = { isFile: true, size: 3 * 1024 * 1024 };
    const result = await getWorkspaceDiff(CWD);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.files[0]).toMatchObject({ path: "huge.log", binary: true });
    expect(h.fileContent).toBeNull();
  });

  it("keeps a vanished untracked file as an unreadable entry (race tolerance)", async () => {
    stubGit({ status: "?? gone.txt\0" });
    // statResult stays null → stat rejects (ENOENT)
    const result = await getWorkspaceDiff(CWD);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.files[0]).toMatchObject({
      path: "gone.txt",
      status: "untracked",
      binary: true,
    });
  });

  it("resolves untracked paths against the repo root, not a subdirectory cwd", async () => {
    // `git status --porcelain` always emits paths relative to the repo root,
    // even when cwd is a subdirectory. A naive path.join(cwd, path) would
    // double up the prefix, miss the file, and fall back to "binary".
    const SUBCWD = "/repo/packages/desktop";
    const ROOT = "/repo";
    const relPath = "packages/desktop/scripts/prerun.mjs";
    stubGit({ status: `?? ${relPath}\0` });
    const inner = h.gitHandler;
    h.gitHandler = (args) => {
      if (args.join(" ") === "rev-parse --show-toplevel") return `${ROOT}\n`;
      return inner(args);
    };
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
    const result = await getWorkspaceDiff(SUBCWD);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
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
      status: " M big.ts\0",
      numstat: { "big.ts": `${MAX_DIFF_LINES + 50}\t0\tbig.ts\n` },
      patch: { "big.ts": body.join("\n") },
    });
    const result = await getWorkspaceDiff(CWD);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.files[0].truncated).toBe(true);
    expect(result.files[0].hunks.split("\n")).toHaveLength(MAX_DIFF_LINES);
  });

  // -- remote hosts (spec scenario 14) --------------------------------------

  it("runs git over ssh for remote hosts with the quoted remote cwd", async () => {
    stubGit({
      status: " M src/a.ts\0",
      numstat: { "src/a.ts": "3\t1\tsrc/a.ts\n" },
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
    const result = await getWorkspaceDiff("/remote/repo", "myhost");
    expect(result).toEqual({
      kind: "ok",
      files: [
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
      ],
    });
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
    stubGit({ status: "?? notes.txt\0" });
    // path.join keeps the fixture key identical to the abs path the source
    // builds (backslash-separated on Windows, forward-slash on POSIX).
    const remoteAbs = path.join("/remote/repo", "notes.txt");
    h.remoteFiles[remoteAbs] = {
      size: 12,
      content: Buffer.from("hello\nworld\n"),
    };
    const result = await getWorkspaceDiff("/remote/repo", "myhost");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.files[0]).toEqual({
      path: "notes.txt",
      status: "untracked",
      oldPath: undefined,
      additions: 2,
      deletions: 0,
      hunks: "+hello\n+world",
      truncated: false,
      binary: false,
    });
    expect(h.sshCommands).toContain(`stat -c %s '${remoteAbs}'`);
    expect(h.sshCommands).toContain(`cat '${remoteAbs}'`);
  });

  it("treats oversized remote untracked files as binary without downloading them", async () => {
    stubGit({ status: "?? huge.log\0" });
    h.remoteFiles["/remote/repo/huge.log"] = {
      size: 3 * 1024 * 1024,
      content: Buffer.from("x"),
    };
    const result = await getWorkspaceDiff("/remote/repo", "myhost");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.files[0]).toMatchObject({
      path: "huge.log",
      binary: true,
      hunks: "",
    });
    expect(h.sshCommands.some((c) => c.startsWith("cat "))).toBe(false);
  });

  it("keeps a vanished remote untracked file as an unreadable entry", async () => {
    stubGit({ status: "?? gone.txt\0" });
    // remoteFiles has no entry → the remote stat rejects.
    const result = await getWorkspaceDiff("/remote/repo", "myhost");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.files[0]).toMatchObject({
      path: "gone.txt",
      status: "untracked",
      binary: true,
    });
  });
});
