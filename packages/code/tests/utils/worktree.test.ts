import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createWorktree,
  deriveWorktreeInfo,
  describeWorktreeSurvival,
  getWorktreeChanges,
  listWorktrees,
  removeWorktree,
  validateWorktreeSlug,
  worktreeCreationBranch,
  worktreeRemoveRetry,
} from "../../src/utils/worktree.js";
import { logger } from "../../src/utils/logger.js";
import {
  getDefaultRemoteBranch,
  getGitMainRepoRoot,
  performPostCreationSetup,
  loadMergedWaveConfig,
  hasWorktreeCreateHook,
  executeWorktreeCreateHook,
  executeWorktreeRemoveHook,
} from "wave-agent-sdk";

interface GitResult {
  stdout: string;
  stderr: string;
}

const { git, resolveGitResult } = vi.hoisted(() => {
  const git = {
    calls: [] as Array<{ cmd: string; args: string[]; opts: unknown }>,
    handler: (): GitResult => ({ stdout: "", stderr: "" }) as GitResult,
    // Branches `git branch --list` reports. `removeWorktree` confirms a branch
    // exists before deleting it, and every case below is about *which* branch
    // gets deleted, not about how the listing is spelled — so the shared mock
    // answers the listing off this set instead of each test's handler.
    branches: new Set<string>(),
  } as {
    calls: Array<{ cmd: string; args: string[]; opts: unknown }>;
    handler: (cmd: string, args: string[], opts: unknown) => GitResult;
    branches: Set<string>;
  };

  // The existence check `removeWorktree` runs before deleting a branch (see
  // `branchExists`): answer it from `git.branches`, exactly as git would — the
  // name back when the branch is there, nothing when it is not.
  const resolveGitResult = (
    cmd: string,
    args: string[],
    opts: unknown,
  ): GitResult => {
    if (args[0] === "branch" && args[1] === "--list") {
      const name = args[args.length - 1];
      return { stdout: git.branches.has(name) ? `${name}\n` : "", stderr: "" };
    }
    return git.handler(cmd, args, opts);
  };

  return { git, resolveGitResult };
});

/**
 * A filesystem the shared delete core can run against for real.
 *
 * `removeWorktree` no longer shells out to `git worktree remove`; it makes the
 * checks git used to make and then deletes the directory itself, so the facts
 * it decides on — does `<worktree>/.git` exist, what does it point at, is there
 * a `locked` file next to that admin dir, does the recursive delete fail — are
 * all filesystem calls. A handler-per-call mock can answer each in isolation
 * but cannot show the *order* (pointer before directory) that the rework is
 * about, so the fake keeps an op log the way the SDK's own suite does.
 */
const fakeFs = vi.hoisted(() => ({
  files: new Map<string, string>(),
  dirs: new Set<string>(),
  links: new Set<string>(),
  children: new Map<string, { name: string; dir: boolean; link: boolean }[]>(),
  /** Filesystem calls that mutate, in order — `["unlink:<path>", "rm:<path>"]` */
  ops: [] as string[],
  /** Content written back to a `.git` gitfile */
  written: [] as { file: string; content: string }[],
  rmError: null as unknown,
  unlinkError: null as unknown,
  writeError: null as unknown,
  /** Strip the Windows extended-length prefix so keys match on every platform */
  key(value: unknown) {
    return String(value).replace(/^\\\\\?\\/, "");
  },
  reset() {
    this.files.clear();
    this.dirs.clear();
    this.links.clear();
    this.children.clear();
    this.ops.length = 0;
    this.written.length = 0;
    this.rmError = null;
    this.unlinkError = null;
    this.writeError = null;
  },
}));

function fsError(code: string): Error {
  return Object.assign(new Error(`${code}: mocked failure`), { code });
}

vi.mock("node:child_process", () => ({
  // node's real callback shape: three arguments. `execFileAsyncHidden` builds
  // its `{ stdout, stderr }` result out of the last two, so a fake that merges
  // them into one object would test a API that does not exist.
  execFile: vi.fn(
    (
      cmd: string,
      args: string[],
      opts: unknown,
      cb?: (err: unknown, stdout?: string, stderr?: string) => void,
    ) => {
      git.calls.push({ cmd, args, opts });
      try {
        const result = resolveGitResult(cmd, args, opts);
        cb?.(null, result.stdout, result.stderr);
      } catch (error) {
        cb?.(error);
      }
      return {};
    },
  ),
  // Loading the real SDK barrel (see the `wave-agent-sdk` mock below) pulls in
  // modules that destructure these at import time. Nothing in this suite uses
  // them — a call through any of them fails loudly instead of hitting git.
  exec: vi.fn(() => {
    throw new Error("exec is not part of this suite");
  }),
  execSync: vi.fn(() => {
    throw new Error("execSync is not part of this suite");
  }),
  execFileSync: vi.fn(() => {
    throw new Error("execFileSync is not part of this suite");
  }),
  spawn: vi.fn(() => {
    throw new Error("spawn is not part of this suite");
  }),
  spawnSync: vi.fn(() => {
    throw new Error("spawnSync is not part of this suite");
  }),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  rmSync: vi.fn(),
  // The worktree delete core detaches and (on failure) restores the `.git`
  // gitfile, and removes Windows reparse points with unlink/rmdir: all three
  // have to be mockable per case.
  unlinkSync: vi.fn(),
  rmdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  // Synchronous reads `deriveWorktreeInfo` uses — it must never shell out to git
  // (it runs once per session row on every list refresh).
  statSync: vi.fn(),
  // `describeWorktreeRemovalOutcome` tells a `.git` *directory* (an independent
  // repository, whose history would die with `rm -rf`) from a gitfile, and that
  // distinction is a single lstat.
  lstatSync: vi.fn(),
  readFileSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    copyFile: vi.fn(),
    cp: vi.fn(),
  },
}));

// The barrel is replaced wholesale so the SDK runtime never loads; the one
// piece worktree.ts needs is execFileAsyncHidden — the SDK's hand-written
// promise wrapper, which must never be replaced by `promisify(execFileHidden)`
// (that drops `promisify.custom` and resolves stdout alone).
//
// The worktree delete core is the exception: it is imported for real. It *is*
// what these tests are about — the refusals, the `.git` detach and the restore
// have to be the shipped ones, running against this file's `node:fs` mock, or
// the suite would only prove that a fake behaves like itself. `importOriginal`
// resolves the SDK's built output, so the core has to be rebuilt
// (`pnpm -F wave-agent-sdk build`) after an edit or these run the old build.
vi.mock("wave-agent-sdk", async (importOriginal) => {
  const { execFile } = await import("node:child_process");
  const actual = await importOriginal<typeof import("wave-agent-sdk")>();
  const execFileAsyncHidden = (
    cmd: string,
    args: string[],
    opts?: unknown,
  ): Promise<GitResult> =>
    new Promise((resolve, reject) => {
      (
        execFile as unknown as (
          cmd: string,
          args: string[],
          opts: unknown,
          cb: (err: unknown, stdout?: string, stderr?: string) => void,
        ) => void
      )(cmd, args, opts, (err, stdout, stderr) => {
        if (err) {
          reject(err);
          return;
        }
        resolve({ stdout: stdout ?? "", stderr: stderr ?? "" });
      });
    });
  return {
    execFileAsyncHidden,
    getGitMainRepoRoot: vi.fn(),
    getDefaultRemoteBranch: vi.fn(),
    performPostCreationSetup: vi.fn(),
    loadMergedWaveConfig: vi.fn(),
    hasWorktreeCreateHook: vi.fn(),
    executeWorktreeCreateHook: vi.fn(),
    executeWorktreeRemoveHook: vi.fn(),
    // Real value: the CLI-side name validation rejects this reserved prefix, and
    // the point of the test is the rejection, not the string itself.
    EPHEMERAL_WORKTREE_PREFIX: "sa-",
    detachWorktreePointer: actual.detachWorktreePointer,
    removeWorktreeDirectory: actual.removeWorktreeDirectory,
    restoreWorktreePointer: actual.restoreWorktreePointer,
    describeRemovalFailure: actual.describeRemovalFailure,
    describeWorktreeResidue: actual.describeWorktreeResidue,
    // The message a caller prints when `removeWorktree` returned false: it has
    // to be the shipped diagnosis, not a copy of it.
    describeWorktreeRemovalOutcome: actual.describeWorktreeRemovalOutcome,
  };
});

function gitCallsWith(fragments: string[]) {
  return git.calls.filter((c) => fragments.every((f) => c.args.includes(f)));
}

function gitError(message: string, stderr: string) {
  return Object.assign(new Error(message), { stderr });
}

function enoent() {
  return Object.assign(new Error("ENOENT: no such file or directory"), {
    code: "ENOENT",
  });
}

describe("worktree utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    git.calls.length = 0;
    git.handler = () => ({ stdout: "", stderr: "" });
    // The branch `removeWorktree`'s fixtures were created on.
    git.branches = new Set(["worktree-my-feat"]);
    // Retries are two extra attempts on the fs fallback; zero the waits so the
    // failure cases do not spend a second sleeping (the attempt count itself is
    // asserted below).
    worktreeRemoveRetry.delaysMs = [0, 0];
    // Default: neither settings.local.json nor .worktreeinclude exist
    vi.mocked(fs.promises.readFile).mockRejectedValue(enoent());
    vi.mocked(fs.promises.writeFile).mockResolvedValue(undefined);
    vi.mocked(fs.promises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fs.promises.copyFile).mockResolvedValue(undefined);
    vi.mocked(fs.promises.cp).mockResolvedValue(undefined);
  });

  describe("createWorktree", () => {
    it("should create a new worktree", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.name).toBe("my-feat");
      expect(session.path).toBe(
        path.join("/repo/root", ".wave", "worktrees", "my-feat"),
      );
      expect(session.branch).toBe("worktree-my-feat");
      expect(session.repoRoot).toBe("/repo/root");
      expect(session.isNew).toBe(true);
      expect(
        gitCallsWith(["worktree", "add", "-b", "worktree-my-feat"]),
      ).toHaveLength(1);
    });

    it("should use HEAD as base when baseRef is 'head'", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const session = await createWorktree("my-feat", "/repo/root", {
        baseRef: "head",
      });

      expect(session.isNew).toBe(true);
      expect(gitCallsWith(["HEAD"])).toHaveLength(1);
      expect(getDefaultRemoteBranch).not.toHaveBeenCalled();
    });

    it("should use origin default branch when baseRef is 'fresh'", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await createWorktree("my-feat", "/repo/root", { baseRef: "fresh" });

      expect(getDefaultRemoteBranch).toHaveBeenCalledWith("/repo/root");
      expect(gitCallsWith(["origin/main"])).toHaveLength(1);
    });

    it("should reuse an existing worktree", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.name).toBe("my-feat");
      expect(session.isNew).toBe(false);
      expect(git.calls).toHaveLength(0);
    });

    it("should handle branch already exists error by adding worktree without -b", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      let n = 0;
      git.handler = () => {
        n++;
        if (n === 1) {
          throw gitError(
            "Command failed",
            "fatal: a branch named 'worktree-my-feat' already exists",
          );
        }
        return { stdout: "", stderr: "" };
      };

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.name).toBe("my-feat");
      expect(session.repoRoot).toBe("/repo/root");
      expect(session.isNew).toBe(true);
      expect(git.calls).toHaveLength(2);
      expect(git.calls[1].args).toEqual(
        expect.arrayContaining(["worktree", "add", "worktree-my-feat"]),
      );
      expect(git.calls[1].args).not.toContain("-b");
    });

    it("should throw error if worktree creation fails with other error", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      git.handler = () => {
        throw gitError("Some other error", "");
      };

      await expect(createWorktree("my-feat", "/repo/root")).rejects.toThrow(
        "Failed to create worktree",
      );
    });

    it("should throw error if adding existing branch fails", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      let n = 0;
      git.handler = () => {
        n++;
        if (n === 1) {
          throw gitError(
            "Command failed",
            "fatal: a branch named 'worktree-my-feat' already exists",
          );
        }
        throw gitError("Inner error", "");
      };

      await expect(createWorktree("my-feat", "/repo/root")).rejects.toThrow(
        "Failed to add existing worktree branch",
      );
    });

    it("should fetch default branch when not found locally, then create worktree", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      let n = 0;
      git.handler = () => {
        n++;
        if (n === 1) {
          throw gitError("Command failed", "not a valid object name");
        }
        return { stdout: "", stderr: "" };
      };

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.isNew).toBe(true);
      expect(gitCallsWith(["fetch", "origin", "main"])).toHaveLength(1);
      expect(git.calls).toHaveLength(3);
    });

    it("should fall back to HEAD when fetch also fails", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      let n = 0;
      git.handler = () => {
        n++;
        if (n === 1) {
          throw gitError("Command failed", "not a valid object name");
        }
        if (n === 2) {
          throw gitError("fetch failed", "");
        }
        return { stdout: "", stderr: "" };
      };

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.isNew).toBe(true);
      expect(
        gitCallsWith(["worktree", "add", "-b", "worktree-my-feat", "HEAD"]),
      ).toHaveLength(1);
    });

    it("should throw when both fetch and HEAD fallback fail", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      git.handler = (_cmd, args) => {
        if (args[0] === "fetch") {
          throw gitError("fetch failed", "");
        }
        throw gitError("Command failed", "not a valid object name");
      };

      await expect(createWorktree("my-feat", "/repo/root")).rejects.toThrow(
        "Failed to create worktree",
      );
    });

    it("should reject invalid worktree names before any side effects", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");

      await expect(createWorktree("../escape", "/repo/root")).rejects.toThrow(
        "must not contain",
      );

      expect(git.calls).toHaveLength(0);
      expect(getGitMainRepoRoot).not.toHaveBeenCalled();
    });

    it("should run post-creation setup for newly created worktrees", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.isNew).toBe(true);
      expect(performPostCreationSetup).toHaveBeenCalledWith(
        path.join("/repo/root", ".wave", "worktrees", "my-feat"),
        "/repo/root",
      );
    });

    it("should skip post-creation setup for existing worktrees", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.isNew).toBe(false);
      expect(performPostCreationSetup).not.toHaveBeenCalled();
    });

    it("should create worktree via WorktreeCreate hook when configured", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(loadMergedWaveConfig).mockReturnValue({
        hooks: {
          WorktreeCreate: [
            { hooks: [{ type: "command", command: "create.sh" }] },
          ],
        },
      });
      vi.mocked(hasWorktreeCreateHook).mockReturnValue(true);
      vi.mocked(executeWorktreeCreateHook).mockResolvedValue({
        worktreePath: "/custom/vcs/feature",
      });

      const session = await createWorktree("my-feat", "/repo/root");

      expect(executeWorktreeCreateHook).toHaveBeenCalledWith(
        "my-feat",
        expect.objectContaining({
          WorktreeCreate: expect.any(Array),
        }),
        expect.objectContaining({
          projectDir: "/repo/root",
          sessionId: "",
        }),
      );
      // Hook replaced git: no git calls, no post-creation setup
      expect(git.calls).toHaveLength(0);
      expect(performPostCreationSetup).not.toHaveBeenCalled();
      expect(session).toMatchObject({
        name: "my-feat",
        path: "/custom/vcs/feature",
        repoRoot: "/repo/root",
        isNew: true,
        hookBased: true,
      });
    });

    it("should fall back to the workdir as repoRoot for hook-based non-git creation", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue(undefined as never);
      vi.mocked(loadMergedWaveConfig).mockReturnValue({
        hooks: {
          WorktreeCreate: [
            { hooks: [{ type: "command", command: "create.sh" }] },
          ],
        },
      });
      vi.mocked(hasWorktreeCreateHook).mockReturnValue(true);
      vi.mocked(executeWorktreeCreateHook).mockResolvedValue({
        worktreePath: "/custom/vcs/feature",
      });

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.repoRoot).toBe("/repo/root");
      expect(session.hookBased).toBe(true);
    });

    it("should propagate WorktreeCreate hook failure as a thrown error", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(loadMergedWaveConfig).mockReturnValue({
        hooks: {
          WorktreeCreate: [
            { hooks: [{ type: "command", command: "create.sh" }] },
          ],
        },
      });
      vi.mocked(hasWorktreeCreateHook).mockReturnValue(true);
      vi.mocked(executeWorktreeCreateHook).mockRejectedValue(
        new Error("WorktreeCreate hook failed: create.sh: boom"),
      );

      await expect(createWorktree("my-feat", "/repo/root")).rejects.toThrow(
        "WorktreeCreate hook failed: create.sh: boom",
      );
      expect(git.calls).toHaveLength(0);
    });
  });

  describe("deriveWorktreeInfo", () => {
    // deriveWorktreeInfo resolves every path it looks up, so the fixtures must
    // be built with `path` too: on Windows "/repo/x" resolves to "D:\\repo\\x"
    // and a hard-coded POSIX key would never match.
    const REPO_ROOT = path.resolve("/repo");
    const WT = path.resolve("/repo/.wave/worktrees/feat");
    const GIT_DIR = path.resolve("/repo/.git/worktrees/feat");

    /** Lay out a linked worktree's metadata the way git writes it. */
    function stubLinkedWorktree(
      files: Record<string, string | undefined> = {},
    ) {
      const all: Record<string, string | undefined> = {
        [path.join(WT, ".git")]: `gitdir: ${GIT_DIR}`,
        [path.join(GIT_DIR, "HEAD")]: "ref: refs/heads/wave/feat",
        [path.join(GIT_DIR, "commondir")]: "../..",
        ...files,
      };
      vi.mocked(fs.statSync).mockImplementation(((p: string) => {
        if (p === path.join(WT, ".git")) return { isFile: () => true };
        throw enoent();
      }) as unknown as typeof fs.statSync);
      vi.mocked(fs.readFileSync).mockImplementation(((p: string) => {
        const content = all[p];
        if (content === undefined) throw enoent();
        return content;
      }) as unknown as typeof fs.readFileSync);
    }

    beforeEach(() => {
      vi.mocked(hasWorktreeCreateHook).mockReturnValue(false);
      vi.mocked(loadMergedWaveConfig).mockReturnValue({ hooks: undefined });
    });

    it("reads the worktree, its branch and the main repo root off the filesystem", () => {
      stubLinkedWorktree({});

      expect(deriveWorktreeInfo(WT)).toEqual({
        path: WT,
        branch: "wave/feat",
        repoRoot: REPO_ROOT,
        hookBased: false,
      });
      // No git process: this runs once per session row on every list refresh.
      expect(git.calls).toHaveLength(0);
    });

    it("reports hookBased for a repository whose worktrees come from a hook", () => {
      stubLinkedWorktree({});
      vi.mocked(hasWorktreeCreateHook).mockReturnValue(true);

      expect(deriveWorktreeInfo(WT)?.hookBased).toBe(true);
    });

    it("leaves the branch empty on a detached HEAD but still identifies the worktree", () => {
      stubLinkedWorktree({
        [path.join(GIT_DIR, "HEAD")]: "0123456789abcdef",
      });

      // Same thing `git branch --show-current` says; removeWorktree then keeps
      // any branch it cannot name.
      expect(deriveWorktreeInfo(WT)).toMatchObject({
        path: WT,
        branch: "",
        repoRoot: REPO_ROOT,
      });
    });

    it("returns undefined for a main working tree (.git is a directory)", () => {
      vi.mocked(fs.statSync).mockImplementation((() => ({
        isFile: () => false,
      })) as unknown as typeof fs.statSync);

      expect(deriveWorktreeInfo(REPO_ROOT)).toBeUndefined();
    });

    it("returns undefined when the directory is not a git checkout at all", () => {
      vi.mocked(fs.statSync).mockImplementation((() => {
        throw enoent();
      }) as unknown as typeof fs.statSync);

      expect(deriveWorktreeInfo("/tmp/scratch")).toBeUndefined();
    });

    it("returns undefined when the worktree metadata cannot be read", () => {
      stubLinkedWorktree({ [path.join(GIT_DIR, "commondir")]: undefined });

      expect(deriveWorktreeInfo(WT)).toBeUndefined();
    });

    it("returns undefined for an empty directory string", () => {
      expect(deriveWorktreeInfo("")).toBeUndefined();
    });
  });

  describe("worktreeCreationBranch", () => {
    // The layout createWorktree writes: <repoRoot>/.wave/worktrees/<name>, on
    // `worktree-<name>`. Built with `path` so the expectations hold on Windows.
    const REPO_ROOT = path.resolve("/repo");

    it("names the branch createWorktree gives a worktree it created", () => {
      expect(
        worktreeCreationBranch({
          path: path.join(REPO_ROOT, ".wave", "worktrees", "feat"),
          repoRoot: REPO_ROOT,
        }),
      ).toBe("worktree-feat");
    });

    it("keeps the slash-separated name intact", () => {
      // Names are slug paths (see validateWorktreeSlug), so the directory is
      // nested and the branch keeps the slashes.
      expect(
        worktreeCreationBranch({
          path: path.join(REPO_ROOT, ".wave", "worktrees", "team", "feat"),
          repoRoot: REPO_ROOT,
        }),
      ).toBe("worktree-team/feat");
    });

    it("returns undefined for a worktree wave did not create", () => {
      // A hand-made `git worktree add ../linked feat`: its branch is not ours to
      // name, and guessing would mean deleting whatever it has checked out.
      expect(
        worktreeCreationBranch({
          path: path.join(REPO_ROOT, "linked", "feat"),
          repoRoot: REPO_ROOT,
        }),
      ).toBeUndefined();
    });

    it("returns undefined for the worktrees directory itself", () => {
      expect(
        worktreeCreationBranch({
          path: path.join(REPO_ROOT, ".wave", "worktrees"),
          repoRoot: REPO_ROOT,
        }),
      ).toBeUndefined();
    });

    it("returns undefined when the repo root is unknown", () => {
      expect(
        worktreeCreationBranch({
          path: path.join(REPO_ROOT, ".wave", "worktrees", "feat"),
          repoRoot: "",
        }),
      ).toBeUndefined();
    });

    it("names the branch from the path tail whatever form the two paths are in", () => {
      // The two paths reach the function from different places: `path` is what
      // the OS/host handed over (mkdtemp, a session's cwd), `repoRoot` is what
      // git canonicalized into `<gitdir>/commondir`. On Windows the same
      // directory therefore arrives as an 8.3 short name, an unexpanded
      // junction, or a different letter case — and Windows compares paths
      // case-insensitively while a string compare does not. That is how the
      // parent-prefix compare passed on Linux (and on the PR gate) and failed
      // `check-windows` on main after #2721: expected 'worktree-feat', got
      // undefined. This test is red on Linux with that compare, so the gate
      // catches it before the Windows job does.
      const LONG_ROOT = path.resolve("/tmp/wave-worktree-real-8f2a");
      const SHORT_ROOT = path.resolve("/tmp/WAVE-W~1");
      const worktreeUnder = (root: string) =>
        path.join(root, ".wave", "worktrees");

      // 8.3 short name vs the long one git wrote.
      expect(
        worktreeCreationBranch({
          path: path.join(worktreeUnder(SHORT_ROOT), "feat"),
          repoRoot: LONG_ROOT,
        }),
      ).toBe("worktree-feat");
      // Same directory, different letter case.
      expect(
        worktreeCreationBranch({
          path: path.join(
            worktreeUnder(path.resolve("/repo/WaveRepo")),
            "feat",
          ),
          repoRoot: path.resolve("/repo/waverepo"),
        }),
      ).toBe("worktree-feat");
      // …and a nested slug name still survives the tail walk.
      expect(
        worktreeCreationBranch({
          path: path.join(worktreeUnder(SHORT_ROOT), "team", "feat"),
          repoRoot: LONG_ROOT,
        }),
      ).toBe("worktree-team/feat");
    });

    it("names the innermost worktree when the repo itself lives in one", () => {
      const OUTER = path.join(REPO_ROOT, ".wave", "worktrees", "outer");

      expect(
        worktreeCreationBranch({
          path: path.join(OUTER, ".wave", "worktrees", "inner"),
          repoRoot: OUTER,
        }),
      ).toBe("worktree-inner");
    });
  });

  describe("getWorktreeChanges", () => {
    it("counts uncommitted files and commits ahead of the base branch", async () => {
      git.handler = (_cmd, args) => {
        if (args[0] === "status") {
          return {
            stdout: " M src/a.ts\n?? src/b.ts\n M src/c.ts\n",
            stderr: "",
          };
        }
        if (args[0] === "rev-list") {
          expect(args).toContain("origin/main..HEAD");
          return { stdout: "3\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      };

      const changes = await getWorktreeChanges(
        "/repo/root/.wave/worktrees/my-feat",
        "origin/main",
      );

      expect(changes).toEqual({ files: 3, commits: 3 });
    });

    it("falls back to the repo default branch when no base is given", async () => {
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      git.handler = (_cmd, args) => {
        if (args[0] === "rev-list") {
          expect(args).toContain("origin/main..HEAD");
        }
        return { stdout: "", stderr: "" };
      };

      const changes = await getWorktreeChanges("/repo/root/.wave/worktrees/x");

      expect(changes).toEqual({ files: 0, commits: 0 });
    });

    it("reports zero commits when the base branch is unknown", async () => {
      git.handler = (_cmd, args) => {
        if (args[0] === "status") {
          return { stdout: " M src/a.ts\n", stderr: "" };
        }
        throw gitError("unknown revision", "fatal: bad revision");
      };

      const changes = await getWorktreeChanges("/repo/root/.wave/worktrees/x");

      // The file count is what the user loses; an unresolvable base must not
      // hide it.
      expect(changes).toEqual({ files: 1, commits: 0 });
    });

    it("returns null when the worktree is gone or not a git repository", async () => {
      git.handler = () => {
        throw gitError("not a git repository", "");
      };

      expect(
        await getWorktreeChanges("/repo/root/.wave/worktrees/gone"),
      ).toBeNull();
    });
  });

  describe("removeWorktree", () => {
    const REPO_ROOT = path.resolve("/repo/root");
    const WORKTREE_PATH = path.join(REPO_ROOT, ".wave", "worktrees", "my-feat");
    const GIT_DIR = path.join(REPO_ROOT, ".git", "worktrees", "my-feat");
    const DOT_GIT = path.join(WORKTREE_PATH, ".git");
    const session = {
      name: "my-feat",
      path: WORKTREE_PATH,
      branch: "worktree-my-feat",
      repoRoot: REPO_ROOT,
      hasUncommittedChanges: false,
      hasNewCommits: false,
      isNew: false,
    };

    /** Wire the fake filesystem behind the `node:fs` mock. */
    function installFakeFs() {
      vi.mocked(fs.existsSync).mockImplementation(((p: unknown) => {
        const key = fakeFs.key(p);
        return (
          fakeFs.files.has(key) || fakeFs.dirs.has(key) || fakeFs.links.has(key)
        );
      }) as unknown as typeof fs.existsSync);
      vi.mocked(fs.readFileSync).mockImplementation(((p: unknown) => {
        const key = fakeFs.key(p);
        const content = fakeFs.files.get(key);
        if (content === undefined) throw fsError("ENOENT");
        return content;
      }) as unknown as typeof fs.readFileSync);
      vi.mocked(fs.lstatSync).mockImplementation(((p: unknown) => {
        const key = fakeFs.key(p);
        if (
          !fakeFs.files.has(key) &&
          !fakeFs.dirs.has(key) &&
          !fakeFs.links.has(key)
        ) {
          throw fsError("ENOENT");
        }
        return {
          isSymbolicLink: () => fakeFs.links.has(key),
          isDirectory: () => fakeFs.dirs.has(key),
          isFile: () => fakeFs.files.has(key),
        };
      }) as unknown as typeof fs.lstatSync);
      vi.mocked(fs.readdirSync).mockImplementation(((
        p: unknown,
        options?: unknown,
      ) => {
        const entries = fakeFs.children.get(fakeFs.key(p)) ?? [];
        if (
          options &&
          typeof options === "object" &&
          "withFileTypes" in options
        ) {
          return entries.map((entry) => ({
            name: entry.name,
            isSymbolicLink: () => entry.link,
            isDirectory: () => entry.dir,
            isFile: () => !entry.dir && !entry.link,
          }));
        }
        return entries.map((entry) => entry.name);
      }) as unknown as typeof fs.readdirSync);
      vi.mocked(fs.rmSync).mockImplementation(((p: unknown) => {
        const key = fakeFs.key(p);
        if (fakeFs.rmError) throw fakeFs.rmError;
        fakeFs.ops.push(`rm:${key}`);
        fakeFs.dirs.delete(key);
        fakeFs.children.delete(key);
        fakeFs.links.delete(key);
        for (const file of [...fakeFs.files.keys()]) {
          if (file === key || file.startsWith(key + path.sep)) {
            fakeFs.files.delete(file);
          }
        }
      }) as unknown as typeof fs.rmSync);
      vi.mocked(fs.unlinkSync).mockImplementation(((p: unknown) => {
        const key = fakeFs.key(p);
        if (fakeFs.unlinkError) throw fakeFs.unlinkError;
        // A junction is a directory reparse point: unlink does not remove it.
        if (fakeFs.links.has(key)) throw fsError("EPERM");
        if (!fakeFs.files.has(key)) throw fsError("ENOENT");
        fakeFs.files.delete(key);
        fakeFs.ops.push(`unlink:${key}`);
      }) as unknown as typeof fs.unlinkSync);
      vi.mocked(fs.rmdirSync).mockImplementation(((p: unknown) => {
        const key = fakeFs.key(p);
        if (!fakeFs.links.has(key)) throw fsError("ENOTEMPTY");
        fakeFs.links.delete(key);
        fakeFs.ops.push(`rmdir:${key}`);
      }) as unknown as typeof fs.rmdirSync);
      vi.mocked(fs.writeFileSync).mockImplementation(((
        p: unknown,
        content: unknown,
      ) => {
        const key = fakeFs.key(p);
        if (fakeFs.writeError) throw fakeFs.writeError;
        fakeFs.files.set(key, String(content));
        fakeFs.written.push({ file: key, content: String(content) });
        fakeFs.ops.push(`write:${key}`);
      }) as unknown as typeof fs.writeFileSync);
    }

    /** A linked worktree of REPO_ROOT that git still registers. */
    function givenRegisteredWorktree() {
      fakeFs.dirs.add(WORKTREE_PATH);
      fakeFs.dirs.add(GIT_DIR);
      fakeFs.files.set(DOT_GIT, `gitdir: ${GIT_DIR}\n`);
      fakeFs.children.set(WORKTREE_PATH, []);
    }

    /** Every warning emitted, joined — most cases assert on one sentence. */
    function warnings(warnSpy: { mock: { calls: unknown[][] } }): string {
      return warnSpy.mock.calls.map((call) => call[0]).join(" ");
    }

    beforeEach(() => {
      fakeFs.reset();
      installFakeFs();
    });

    it("detaches the .git pointer before deleting the directory, then prunes and deletes the branch", async () => {
      givenRegisteredWorktree();

      expect(await removeWorktree(session)).toBe(true);

      // The order IS the implementation: pointer first, directory second. The
      // previous implementation ran `git worktree remove --force` here instead.
      expect(fakeFs.ops).toEqual([`unlink:${DOT_GIT}`, `rm:${WORKTREE_PATH}`]);
      expect(vi.mocked(fs.rmSync)).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ recursive: true, force: true }),
      );
      // prune has to run before branch -D: git refuses to delete a branch a
      // still-registered worktree has checked out.
      const pruneIndex = git.calls.findIndex(
        (c) => c.args[0] === "worktree" && c.args[1] === "prune",
      );
      const deleteIndex = git.calls.findIndex(
        (c) => c.args[0] === "branch" && c.args[1] === "-D",
      );
      expect(pruneIndex).toBeGreaterThanOrEqual(0);
      expect(deleteIndex).toBeGreaterThan(pruneIndex);
    });

    it("never asks git to delete the worktree", async () => {
      // git's exit code is what made the old path lie (it exits 0 with the
      // directory still there). The delete is ours now, on both platforms.
      givenRegisteredWorktree();

      await removeWorktree(session);

      expect(gitCallsWith(["worktree", "remove"])).toHaveLength(0);
    });

    it("deletes through an extended-length path on Windows", async () => {
      givenRegisteredWorktree();

      await removeWorktree(session);

      const [rmPath] = vi.mocked(fs.rmSync).mock.calls[0];
      if (process.platform === "win32") {
        // Bypasses the Windows MAX_PATH limit
        expect(String(rmPath)).toMatch(/^\\\\\?\\/);
      } else {
        expect(rmPath).toBe(WORKTREE_PATH);
      }
    });

    it("refuses a worktree git was told to lock", async () => {
      givenRegisteredWorktree();
      fakeFs.files.set(
        path.join(GIT_DIR, "locked"),
        "in use by a long build\n",
      );
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      // Nothing was deleted, so the answer to "is the directory gone" is no.
      expect(await removeWorktree(session)).toBe(false);

      expect(fakeFs.ops).toEqual([]);
      expect(git.calls).toHaveLength(0);
      expect(warnings(warnSpy)).toContain("git worktree unlock");
      expect(warnings(warnSpy)).toContain("in use by a long build");
      warnSpy.mockRestore();
    });

    it("refuses a directory whose .git points into another repository", async () => {
      // An independent clone: its `.git` holds the only copy of its history.
      fakeFs.dirs.add(WORKTREE_PATH);
      fakeFs.files.set(
        DOT_GIT,
        `gitdir: ${path.join(path.resolve("/elsewhere/clone"), ".git")}\n`,
      );
      fakeFs.children.set(WORKTREE_PATH, []);
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      expect(await removeWorktree(session)).toBe(false);

      expect(fakeFs.ops).toEqual([]);
      expect(gitCallsWith(["branch", "-D"])).toHaveLength(0);
      expect(warnings(warnSpy)).toContain("does not point into this repo");
      warnSpy.mockRestore();
    });

    it("refuses the main working tree", async () => {
      fakeFs.dirs.add(REPO_ROOT);
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      expect(await removeWorktree({ ...session, path: REPO_ROOT })).toBe(false);

      expect(fakeFs.ops).toEqual([]);
      expect(warnings(warnSpy)).toContain("main working tree");
      warnSpy.mockRestore();
    });

    it("puts the .git pointer back and keeps the branch when the delete fails", async () => {
      givenRegisteredWorktree();
      const original = fakeFs.files.get(DOT_GIT);
      fakeFs.rmError = fsError("EPERM");
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      expect(await removeWorktree(session)).toBe(false);

      // "Directory still there" must keep meaning "git still knows about it".
      expect(fakeFs.written).toEqual([{ file: DOT_GIT, content: original }]);
      expect(fakeFs.files.get(DOT_GIT)).toBe(original);
      // The branch is the only ref back to whatever is left in that checkout.
      expect(gitCallsWith(["branch", "-D"])).toHaveLength(0);
      expect(warnings(warnSpy)).toContain(
        "Worktree directory survived removal",
      );
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("restores the pointer only after the final attempt fails", async () => {
      givenRegisteredWorktree();
      // Fail the first two attempts, succeed on the last. A restore performed
      // inside the retry loop would leave a stray `.git` behind on success.
      let attempts = 0;
      vi.mocked(fs.rmSync).mockImplementation((() => {
        attempts++;
        if (attempts < 1 + worktreeRemoveRetry.delaysMs.length) {
          throw fsError("EPERM");
        }
        fakeFs.ops.push(`rm:${WORKTREE_PATH}`);
        fakeFs.dirs.delete(WORKTREE_PATH);
        fakeFs.files.delete(DOT_GIT);
      }) as unknown as typeof fs.rmSync);

      expect(await removeWorktree(session)).toBe(true);

      expect(vi.mocked(fs.rmSync)).toHaveBeenCalledTimes(
        1 + worktreeRemoveRetry.delaysMs.length,
      );
      // The pointer went before the first attempt, and never came back.
      expect(fakeFs.ops[0]).toBe(`unlink:${DOT_GIT}`);
      expect(fakeFs.written).toEqual([]);
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
    });

    it("logs the failing stage, the reason and the residue left behind", async () => {
      givenRegisteredWorktree();
      fakeFs.children.set(WORKTREE_PATH, [
        { name: "node_modules", dir: true, link: false },
        { name: "packages", dir: true, link: false },
      ]);
      fakeFs.rmError = Object.assign(
        new Error("EPERM: operation not permitted"),
        {
          code: "EPERM",
          syscall: "rmdir",
          path: path.join(WORKTREE_PATH, "node_modules"),
        },
      );
      const errorSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      await removeWorktree(session);

      const message = errorSpy.mock.calls[0].join(" ");
      expect(message).toContain("Failed to remove worktree directory");
      expect(message).toContain(`path=${WORKTREE_PATH}`);
      // Which stage failed, and the errno behind it
      expect(message).toContain("stage=fs");
      expect(message).toContain("code=EPERM");
      // The errno is translated: "EPERM" alone tells a user nothing to close.
      expect(message).toContain("one of the worktree's files open");
      expect(message).toContain("gitPointerRestored=true");
      // What is still on disk after the last attempt
      expect(message).toContain("residue=2[node_modules,packages]");
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("deletes a directory whose .git is already gone as a plain leftover", async () => {
      // A previous cleanup already removed the pointer: git does not know about
      // this directory any more, so there is nothing to unlink and nothing to
      // restore — it is just files.
      fakeFs.dirs.add(WORKTREE_PATH);
      fakeFs.children.set(WORKTREE_PATH, [
        { name: "src", dir: true, link: false },
      ]);
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      expect(await removeWorktree(session)).toBe(true);

      expect(fakeFs.ops).toEqual([`rm:${WORKTREE_PATH}`]);
      expect(warnings(warnSpy)).toContain("plain leftover");
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
      warnSpy.mockRestore();
    });

    it("prunes and deletes the branch when the directory is already gone", async () => {
      // Idempotent: a repeated removal finds no directory but must not leave
      // the branch behind.
      expect(await removeWorktree(session)).toBe(true);

      expect(fakeFs.ops).toEqual([]);
      expect(gitCallsWith(["worktree", "prune"])).toHaveLength(1);
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
    });

    it("keeps the branch when the directory survives a successful delete", async () => {
      givenRegisteredWorktree();
      // rmSync reports success but the directory is still there afterwards
      // (something re-created it): the branch is the only ref back to its work.
      vi.mocked(fs.rmSync).mockImplementation((() => {
        fakeFs.ops.push(`rm:${WORKTREE_PATH}`);
      }) as unknown as typeof fs.rmSync);
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      expect(await removeWorktree(session)).toBe(false);

      expect(gitCallsWith(["branch", "-D"])).toHaveLength(0);
      expect(warnings(warnSpy)).toContain(
        "Worktree directory survived removal",
      );
      warnSpy.mockRestore();
    });

    it("warns when git cannot drop the registration", async () => {
      givenRegisteredWorktree();
      git.handler = (_cmd, args) => {
        if (args[0] === "worktree" && args[1] === "prune") {
          throw gitError("Command failed", "error: could not prune");
        }
        return { stdout: "", stderr: "" };
      };
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      expect(await removeWorktree(session)).toBe(true);

      // The directory is gone either way; a stale entry only means a later
      // `prune` has something left to do, which the log has to say out loud.
      expect(warnings(warnSpy)).toContain(
        "git worktree prune failed after removing a worktree",
      );
      expect(warnings(warnSpy)).toContain("stderr=error: could not prune");
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
      warnSpy.mockRestore();
    });

    it("should confirm the branch exists before deleting it", async () => {
      await removeWorktree(session);

      const listIndex = git.calls.findIndex((c) => c.args.includes("--list"));
      const deleteIndex = git.calls.findIndex(
        (c) => c.args[0] === "branch" && c.args[1] === "-D",
      );
      expect(listIndex).toBeGreaterThanOrEqual(0);
      expect(deleteIndex).toBeGreaterThan(listIndex);
    });

    it("should delete no branch when the repository has no such branch", async () => {
      // A name inferred from the path layout is a candidate, not a record: the
      // layout says what name wave *would* have used, not that this repository
      // ever had that branch. An unconfirmed name must not delete anything.
      git.branches = new Set();
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      await removeWorktree(session);

      expect(gitCallsWith(["branch", "-D"])).toHaveLength(0);
      expect(warnings(warnSpy)).toContain(
        `No branch worktree-my-feat in ${REPO_ROOT} — keeping every branch`,
      );
      warnSpy.mockRestore();
    });

    it("should delete no branch when the caller could not name one", async () => {
      // The caller had no creation-time record and the path is not one wave
      // built, so it hands over an empty branch rather than the worktree's HEAD:
      // that one may be a branch the user owns.
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      await removeWorktree({ ...session, branch: "" });

      // No `git branch -D` at all — with any name.
      expect(gitCallsWith(["branch", "-D"])).toHaveLength(0);
      expect(warnings(warnSpy)).toContain("keeping every branch");
      warnSpy.mockRestore();
    });

    it("should delegate hook-based worktree removal to the WorktreeRemove hook", async () => {
      vi.mocked(loadMergedWaveConfig).mockReturnValue({
        hooks: {
          WorktreeRemove: [
            { hooks: [{ type: "command", command: "cleanup.sh" }] },
          ],
        },
      });
      vi.mocked(executeWorktreeRemoveHook).mockResolvedValue(true);

      await removeWorktree({ ...session, hookBased: true });

      expect(executeWorktreeRemoveHook).toHaveBeenCalledWith(
        WORKTREE_PATH,
        expect.objectContaining({
          WorktreeRemove: expect.any(Array),
        }),
        expect.objectContaining({
          projectDir: REPO_ROOT,
          sessionId: "",
        }),
      );
      // Hook replaced git: wave never runs `git worktree remove`
      expect(git.calls).toHaveLength(0);
    });

    it("should warn and leave hook-based worktree in place when no WorktreeRemove hook is configured", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.mocked(loadMergedWaveConfig).mockReturnValue({ hooks: undefined });
      vi.mocked(executeWorktreeRemoveHook).mockResolvedValue(false);
      // Nothing deleted it, so the directory is still there.
      fakeFs.dirs.add(WORKTREE_PATH);

      // The hook — not wave — owns the directory, so the filesystem is the only
      // honest answer to "was it removed".
      expect(await removeWorktree({ ...session, hookBased: true })).toBe(false);

      expect(warnings(warnSpy)).toContain(
        "No WorktreeRemove hook configured, hook-based worktree left at",
      );
      // Not even the git-free delete path runs: the hook owns the directory.
      expect(fakeFs.ops).toEqual([]);
      expect(git.calls).toHaveLength(0);
      warnSpy.mockRestore();
    });

    it("should NOT call the WorktreeRemove hook for git-based worktrees", async () => {
      vi.mocked(loadMergedWaveConfig).mockReturnValue({
        hooks: {
          WorktreeRemove: [
            { hooks: [{ type: "command", command: "cleanup.sh" }] },
          ],
        },
      });
      vi.mocked(executeWorktreeRemoveHook).mockResolvedValue(true);
      givenRegisteredWorktree();

      await removeWorktree(session);

      expect(executeWorktreeRemoveHook).not.toHaveBeenCalled();
      // The git-based path really ran: the pointer came off.
      expect(fakeFs.ops).toEqual([`unlink:${DOT_GIT}`, `rm:${WORKTREE_PATH}`]);
    });

    // `removeWorktree` answers one bit, and that bit covers four refusals as
    // well as a failed delete. These are the words the CLI prints for that bit —
    // the CLI, the print/daemon paths and the tool result all read them, so a
    // `rm -rf` here is an instruction users carry out by hand.
    describe("describeWorktreeSurvival", () => {
      /** The message a caller prints after `removeWorktree` returned false. */
      function survival(overrides: { path?: string } = {}): string {
        return describeWorktreeSurvival({ ...session, ...overrides });
      }

      it("advises cleaning up a genuine leftover, and only then", () => {
        // The delete was attempted and failed before the pointer came back, so
        // this really is a leftover of this repo: both commands are the fix.
        givenRegisteredWorktree();

        expect(survival()).toBe(
          `Worktree directory survived at ${WORKTREE_PATH}; kept branch ` +
            `${session.branch} so the leftover checkout stays reachable\n` +
            `Clean up manually: rm -rf ${WORKTREE_PATH} && git -C ` +
            `${REPO_ROOT} branch -D ${session.branch}`,
        );
      });

      it("never advises deleting the main working tree", () => {
        const text = survival({ path: REPO_ROOT });

        expect(text).toContain("main working tree");
        expect(text).toContain("nothing was deleted");
        expect(text).not.toContain("rm -rf");
        expect(text).not.toContain("branch -D");
      });

      it("never advises deleting an independent repository (.git is a directory)", () => {
        fakeFs.dirs.add(WORKTREE_PATH);
        fakeFs.dirs.add(DOT_GIT);

        const text = survival();

        expect(text).toContain("independent repository");
        expect(text).toContain("destroy the repository");
        expect(text).not.toContain("rm -rf");
        expect(text).not.toContain("branch -D");
      });

      it("treats a .git pointing outside this repo as an independent repository", () => {
        fakeFs.dirs.add(WORKTREE_PATH);
        fakeFs.files.set(
          DOT_GIT,
          `gitdir: ${path.join(path.resolve("/somewhere/else"), ".git")}\n`,
        );

        const text = survival();

        expect(text).toContain("independent repository");
        expect(text).not.toContain("rm -rf");
        expect(text).not.toContain("branch -D");
      });

      it("names the lock and offers the unlock command instead of a delete", () => {
        givenRegisteredWorktree();
        fakeFs.files.set(
          path.join(GIT_DIR, "locked"),
          "in use by a long build\n",
        );

        const text = survival();

        expect(text).toContain("is locked (in use by a long build)");
        expect(text).toContain(`git worktree unlock ${WORKTREE_PATH}`);
        expect(text).not.toContain("rm -rf");
        expect(text).not.toContain("branch -D");
      });

      it("asks the user to check a directory whose pointer it cannot read", () => {
        fakeFs.dirs.add(WORKTREE_PATH);
        fakeFs.files.set(DOT_GIT, "not a gitfile at all\n");

        const text = survival();

        expect(text).toContain("could not verify");
        expect(text).toContain(
          `git -C ${WORKTREE_PATH} rev-parse --show-toplevel`,
        );
        expect(text).not.toContain("rm -rf");
        expect(text).not.toContain("branch -D");
      });
    });
  });

  describe("validateWorktreeSlug", () => {
    it("should accept valid names", () => {
      expect(() => validateWorktreeSlug("my-feat")).not.toThrow();
      expect(() => validateWorktreeSlug("a")).not.toThrow();
      expect(() => validateWorktreeSlug("feature/123_abc.def")).not.toThrow();
    });

    it("should reject empty names", () => {
      expect(() => validateWorktreeSlug("")).toThrow(
        "segment must be non-empty",
      );
      expect(() => validateWorktreeSlug("/")).toThrow(
        "segment must be non-empty",
      );
    });

    it("should reject names longer than 64 characters", () => {
      expect(() => validateWorktreeSlug("a".repeat(65))).toThrow(
        "characters or fewer",
      );
      expect(() => validateWorktreeSlug("a".repeat(64))).not.toThrow();
    });

    it("should reject . and .. path segments", () => {
      expect(() => validateWorktreeSlug("..")).toThrow("must not contain");
      expect(() => validateWorktreeSlug("../x")).toThrow("must not contain");
      expect(() => validateWorktreeSlug("a/../b")).toThrow("must not contain");
      expect(() => validateWorktreeSlug(".")).toThrow("must not contain");
    });

    it("should reject invalid characters and leading/trailing slashes", () => {
      expect(() => validateWorktreeSlug("my feat")).toThrow(
        "only letters, digits",
      );
      expect(() => validateWorktreeSlug("feat@name")).toThrow(
        "only letters, digits",
      );
      expect(() => validateWorktreeSlug("/leading")).toThrow(
        "segment must be non-empty",
      );
      expect(() => validateWorktreeSlug("trailing/")).toThrow(
        "segment must be non-empty",
      );
    });

    it("should reject the reserved ephemeral prefix", () => {
      // `sa-*` worktrees are swept by the startup cleanup once stale, so a
      // user must not be able to name one into that namespace.
      expect(() => validateWorktreeSlug("sa-swift-fox-123")).toThrow(
        "reserved for wave-managed temporary worktrees",
      );
      expect(() => validateWorktreeSlug("sa-mine")).toThrow("reserved");
      expect(() => validateWorktreeSlug("my-feature")).not.toThrow();
    });
  });

  describe("listWorktrees", () => {
    it("should parse porcelain output with current worktree first", async () => {
      git.handler = (cmd, args) => {
        expect(args).toEqual(["worktree", "list", "--porcelain"]);
        return {
          stdout: [
            "worktree /repo/main",
            "HEAD abc123",
            "branch refs/heads/main",
            "",
            "worktree /repo/wt-feature",
            "HEAD def456",
            "branch refs/heads/feature",
            "",
            "worktree /repo/wt-other",
            "HEAD 789abc",
            "branch refs/heads/other",
            "",
          ].join("\n"),
          stderr: "",
        };
      };

      const paths = await listWorktrees("/repo/main");

      // Current worktree first, then alphabetical
      expect(paths).toEqual([
        "/repo/main",
        "/repo/wt-feature",
        "/repo/wt-other",
      ]);
      expect(gitCallsWith(["worktree", "list"])).toHaveLength(1);
    });

    it("should return a single worktree unchanged", async () => {
      git.handler = () => ({
        stdout: "worktree /repo/main\nHEAD abc123\nbranch refs/heads/main\n",
        stderr: "",
      });

      const paths = await listWorktrees("/repo/main");

      expect(paths).toEqual(["/repo/main"]);
    });

    it("should return an empty array when git fails (not a repo)", async () => {
      git.handler = () => {
        throw gitError(
          "Command failed: git worktree list",
          "fatal: not a git repository",
        );
      };

      const paths = await listWorktrees("/not-a-repo");

      expect(paths).toEqual([]);
    });
  });
});
