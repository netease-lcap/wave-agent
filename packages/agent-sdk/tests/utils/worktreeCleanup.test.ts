import { describe, it, expect, vi, beforeEach } from "vitest";
import * as path from "node:path";

const REPO_ROOT = path.resolve("/fake/repo");
const WORKTREES_DIR = path.join(REPO_ROOT, ".wave", "worktrees");
const STALE_NAME = "sa-swift-fox-123";
const STALE_PATH = path.join(WORKTREES_DIR, STALE_NAME);

/** One day, so tests can backdate mtime relative to the retention period. */
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fake git. `status` / `rev-list` output is what decides whether a worktree is
 * clean and fully pushed; every command is recorded so tests can assert that a
 * rejected worktree never reached the removal step.
 */
const git = vi.hoisted(() => {
  const state = {
    calls: [] as Array<{ args: string[]; cwd?: string }>,
    status: "",
    unpushed: "",
    failStatus: false,
    failUnpushed: false,
    failPrune: false,
    reset() {
      state.calls = [];
      state.status = "";
      state.unpushed = "";
      state.failStatus = false;
      state.failUnpushed = false;
      state.failPrune = false;
    },
  };
  return state;
});

const fsMocks = vi.hoisted(() => ({
  entries: [] as Array<{ name: string; isDirectory: () => boolean }>,
  readdirRejects: false,
  mtimes: new Map<string, number>(),
  statRejects: new Set<string>(),
  /** Pretend the directory survived `removeWorktree` */
  dirSurvivesRemoval: false,
  reset() {
    fsMocks.entries = [];
    fsMocks.readdirRejects = false;
    fsMocks.mtimes = new Map();
    fsMocks.statRejects = new Set();
    fsMocks.dirSurvivesRemoval = false;
  },
}));

const moduleMocks = vi.hoisted(() => ({
  removeWorktree: vi.fn(),
  resolveGitDir: vi.fn(),
  getGitMainRepoRoot: vi.fn(),
}));

vi.mock("node:child_process", async () => {
  // execFileAsyncHidden answers through node native callback shape —
  // (error, stdout, stderr) — so the fake must speak it too.
  const execFile = vi.fn(
    (
      cmd: string,
      args: string[],
      opts: { cwd?: string } | undefined,
      cb?: (err: unknown, stdout?: string, stderr?: string) => void,
    ) => {
      git.calls.push({ args, cwd: opts?.cwd });
      const done = (res: { stdout: string; stderr: string }) =>
        cb?.(null, res.stdout, res.stderr);
      const fail = (message: string) => cb?.(new Error(message), "", message);
      if (args.includes("status")) {
        if (git.failStatus) fail("git status failed");
        else done({ stdout: git.status, stderr: "" });
      } else if (args.includes("rev-list")) {
        if (git.failUnpushed) fail("git rev-list failed");
        else done({ stdout: git.unpushed, stderr: "" });
      } else if (args.includes("prune")) {
        if (git.failPrune) fail("git prune failed");
        else done({ stdout: "", stderr: "" });
      } else {
        done({ stdout: "", stderr: "" });
      }
      return {};
    },
  );
  return { execFile, execFileSync: vi.fn() };
});

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(() => fsMocks.dirSurvivesRemoval),
    promises: {
      ...actual.promises,
      readdir: vi.fn(async () => {
        if (fsMocks.readdirRejects) throw new Error("EACCES");
        return fsMocks.entries;
      }),
      stat: vi.fn(async (p: string) => {
        if (fsMocks.statRejects.has(p)) throw new Error("ENOENT");
        return { mtimeMs: fsMocks.mtimes.get(p) ?? 0 } as unknown as Awaited<
          ReturnType<typeof actual.promises.stat>
        >;
      }),
    },
  };
});

vi.mock("../../src/utils/gitUtils.js", () => ({
  resolveGitDir: moduleMocks.resolveGitDir,
  getGitMainRepoRoot: moduleMocks.getGitMainRepoRoot,
}));

// Keep the real name/branch helpers — they are the contract under test — and
// stub only the filesystem-touching removal.
vi.mock("../../src/utils/worktreeUtils.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/utils/worktreeUtils.js")>();
  return { ...actual, removeWorktree: moduleMocks.removeWorktree };
});

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

import { cleanupStaleEphemeralWorktrees } from "../../src/utils/worktreeCleanup.js";
import { logger } from "../../src/utils/globalLogger.js";

function dirEntry(name: string, isDirectory = true) {
  return { name, isDirectory: () => isDirectory };
}

/** Register a candidate that exists on the fake filesystem. */
function addWorktree(
  name: string,
  options: { ageDays?: number; isDirectory?: boolean } = {},
) {
  const { ageDays = 60, isDirectory = true } = options;
  fsMocks.entries.push(dirEntry(name, isDirectory));
  const p = path.join(WORKTREES_DIR, name);
  fsMocks.mtimes.set(p, Date.now() - ageDays * DAY_MS);
  return p;
}

beforeEach(() => {
  vi.clearAllMocks();
  git.reset();
  fsMocks.reset();
  moduleMocks.resolveGitDir.mockReturnValue(path.join(REPO_ROOT, ".git"));
  moduleMocks.getGitMainRepoRoot.mockReturnValue(REPO_ROOT);
});

describe("cleanupStaleEphemeralWorktrees", () => {
  it("removes a stale, clean, fully pushed ephemeral worktree", async () => {
    addWorktree(STALE_NAME);

    const result = await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30);

    expect(result).toEqual({ removed: 1, errors: 0 });
    expect(moduleMocks.removeWorktree).toHaveBeenCalledTimes(1);
    expect(moduleMocks.removeWorktree).toHaveBeenCalledWith({
      name: STALE_NAME,
      path: STALE_PATH,
      branch: `worktree-${STALE_NAME}`,
      repoRoot: REPO_ROOT,
      isNew: true,
    });
    // One prune after the sweep, from the main repo (not the deleted worktree).
    const pruneCalls = git.calls.filter(
      (c) => c.args.includes("worktree") && c.args.includes("prune"),
    );
    expect(pruneCalls).toHaveLength(1);
    expect(pruneCalls[0].cwd).toBe(REPO_ROOT);
  });

  it("checks cleanliness without --untracked-files=no so new files survive", async () => {
    addWorktree(STALE_NAME);

    await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30);

    const statusCall = git.calls.find((c) => c.args.includes("status"));
    expect(statusCall?.args).toContain("--no-optional-locks");
    expect(statusCall?.args).not.toContain("-uno");
    expect(statusCall?.cwd).toBe(STALE_PATH);
  });

  it("keys staleness on directory mtime", async () => {
    addWorktree(STALE_NAME, { ageDays: 29 });

    const result = await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30);

    expect(result).toEqual({ removed: 0, errors: 0 });
    expect(moduleMocks.removeWorktree).not.toHaveBeenCalled();
    // Young enough → not even asked whether it is dirty.
    expect(git.calls).toHaveLength(0);
  });

  it("honours a longer retention period", async () => {
    addWorktree(STALE_NAME, { ageDays: 45 });

    expect(await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30)).toEqual({
      removed: 1,
      errors: 0,
    });

    git.reset();
    addWorktree("sa-calm-owl-456", { ageDays: 45 });
    expect(await cleanupStaleEphemeralWorktrees(REPO_ROOT, 60)).toEqual({
      removed: 0,
      errors: 0,
    });
  });

  it("keeps a worktree with uncommitted changes", async () => {
    addWorktree(STALE_NAME);
    git.status = " M src/index.ts\n";

    const result = await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30);

    expect(result).toEqual({ removed: 0, errors: 0 });
    expect(moduleMocks.removeWorktree).not.toHaveBeenCalled();
  });

  it("keeps a worktree with an untracked file", async () => {
    addWorktree(STALE_NAME);
    git.status = "?? notes.md\n";

    await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30);

    expect(moduleMocks.removeWorktree).not.toHaveBeenCalled();
  });

  it("keeps a worktree holding an unpushed commit", async () => {
    addWorktree(STALE_NAME);
    git.unpushed = "abc1234\n";

    const result = await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30);

    expect(result).toEqual({ removed: 0, errors: 0 });
    expect(moduleMocks.removeWorktree).not.toHaveBeenCalled();
  });

  it("keeps a worktree when the git probes fail", async () => {
    addWorktree(STALE_NAME);
    git.failStatus = true;

    expect(await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30)).toEqual({
      removed: 0,
      errors: 0,
    });

    git.reset();
    git.failUnpushed = true;
    await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30);

    expect(moduleMocks.removeWorktree).not.toHaveBeenCalled();
  });

  it("never touches user worktrees, whatever their state", async () => {
    // A pre-prefix ephemeral name, a session worktree auto name, and a
    // user-chosen name — none may be swept.
    addWorktree("swift-fox-123");
    addWorktree("narrow-quiet-glacier");
    addWorktree("my-feature");

    const result = await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30);

    expect(result).toEqual({ removed: 0, errors: 0 });
    expect(moduleMocks.removeWorktree).not.toHaveBeenCalled();
    expect(git.calls).toHaveLength(0);
  });

  it("skips the worktree this session was opened in", async () => {
    addWorktree(STALE_NAME);

    const result = await cleanupStaleEphemeralWorktrees(
      REPO_ROOT,
      30,
      STALE_NAME,
    );

    expect(result).toEqual({ removed: 0, errors: 0 });
    expect(moduleMocks.removeWorktree).not.toHaveBeenCalled();
  });

  it("skips a worktree the session is physically inside", async () => {
    addWorktree(STALE_NAME);
    const nestedWorkdir = path.join(STALE_PATH, "src", "nested");

    const result = await cleanupStaleEphemeralWorktrees(nestedWorkdir, 30);

    expect(result).toEqual({ removed: 0, errors: 0 });
    expect(moduleMocks.removeWorktree).not.toHaveBeenCalled();
  });

  it("ignores plain files sitting in the worktrees directory", async () => {
    addWorktree(STALE_NAME, { isDirectory: false });

    const result = await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30);

    expect(result).toEqual({ removed: 0, errors: 0 });
    expect(moduleMocks.removeWorktree).not.toHaveBeenCalled();
  });

  it("skips a candidate whose stat fails", async () => {
    const p = addWorktree(STALE_NAME);
    fsMocks.statRejects.add(p);

    const result = await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30);

    expect(result).toEqual({ removed: 0, errors: 0 });
    expect(moduleMocks.removeWorktree).not.toHaveBeenCalled();
  });

  it("counts a surviving directory as an error and keeps its branch", async () => {
    addWorktree(STALE_NAME);
    fsMocks.dirSurvivesRemoval = true;

    const result = await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30);

    expect(result).toEqual({ removed: 0, errors: 1 });
    expect(moduleMocks.removeWorktree).toHaveBeenCalledTimes(1);
    // Nothing was removed, so the metadata prune is pointless work.
    expect(git.calls.some((c) => c.args.includes("prune"))).toBe(false);
  });

  it("counts a throwing removal as an error and continues", async () => {
    addWorktree(STALE_NAME);
    addWorktree("sa-calm-owl-456");
    moduleMocks.removeWorktree
      .mockImplementationOnce(() => {
        throw new Error("EPERM");
      })
      .mockImplementationOnce(() => undefined);

    const result = await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30);

    expect(result).toEqual({ removed: 1, errors: 1 });
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("failed to remove"),
    );
    expect(git.calls.some((c) => c.args.includes("prune"))).toBe(true);
  });

  it("sweeps nothing when the retention period is zero", async () => {
    addWorktree(STALE_NAME);

    expect(await cleanupStaleEphemeralWorktrees(REPO_ROOT, 0)).toEqual({
      removed: 0,
      errors: 0,
    });
    expect(moduleMocks.removeWorktree).not.toHaveBeenCalled();
    expect(git.calls).toHaveLength(0);
  });

  it("does nothing outside a git repository", async () => {
    addWorktree(STALE_NAME);
    moduleMocks.resolveGitDir.mockReturnValue(null);

    expect(await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30)).toEqual({
      removed: 0,
      errors: 0,
    });
    expect(moduleMocks.removeWorktree).not.toHaveBeenCalled();
  });

  it("is silent when there is no worktrees directory", async () => {
    fsMocks.readdirRejects = true;

    expect(await cleanupStaleEphemeralWorktrees(REPO_ROOT, 30)).toEqual({
      removed: 0,
      errors: 0,
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
