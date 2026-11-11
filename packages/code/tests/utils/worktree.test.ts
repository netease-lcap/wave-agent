import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createWorktree,
  deriveWorktreeInfo,
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
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  readdirSync: vi.fn(),
  rmSync: vi.fn(),
  // Synchronous reads `deriveWorktreeInfo` uses — it must never shell out to git
  // (it runs once per session row on every list refresh).
  statSync: vi.fn(),
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
vi.mock("wave-agent-sdk", async () => {
  const { execFile } = await import("node:child_process");
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
    const session = {
      name: "my-feat",
      path: "/repo/root/.wave/worktrees/my-feat",
      branch: "worktree-my-feat",
      repoRoot: "/repo/root",
      hasUncommittedChanges: false,
      hasNewCommits: false,
      isNew: false,
    };

    it("should remove worktree and branch", async () => {
      git.handler = (_cmd, args) => {
        if (args[0] === "rev-parse") {
          return { stdout: "worktree-my-feat\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      };
      // git removed the directory successfully
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // The return value answers "is the directory gone" — a caller that
      // reports the outcome to a user prints it instead of assuming success.
      expect(await removeWorktree(session)).toBe(true);

      expect(gitCallsWith(["worktree", "remove", "--force"])).toHaveLength(1);
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
    });

    it("should keep another branch checked out inside the worktree", async () => {
      git.handler = (_cmd, args) => {
        if (args[0] === "rev-parse") {
          return { stdout: "another-branch\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      };
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await removeWorktree(session);

      expect(gitCallsWith(["worktree", "remove", "--force"])).toHaveLength(1);
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
      // Commits on that branch may be reachable from nowhere else.
      expect(gitCallsWith(["branch", "-D", "another-branch"])).toHaveLength(0);
    });

    it("should confirm the branch exists before deleting it", async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

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
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await removeWorktree(session);

      expect(gitCallsWith(["branch", "-D"])).toHaveLength(0);
      expect(warnSpy.mock.calls.map((c) => c[0]).join(" ")).toContain(
        "No branch worktree-my-feat in /repo/root — keeping every branch",
      );
      warnSpy.mockRestore();
    });

    it("should delete no branch when the caller could not name one", async () => {
      // The caller had no creation-time record and the path is not one wave
      // built, so it hands over an empty branch rather than the worktree's HEAD:
      // that one may be a branch the user owns.
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await removeWorktree({ ...session, branch: "" });

      expect(gitCallsWith(["worktree", "remove", "--force"])).toHaveLength(1);
      // No `git branch -D` at all — with any name.
      expect(gitCallsWith(["branch", "-D"])).toHaveLength(0);
      expect(warnSpy.mock.calls.map((c) => c[0]).join(" ")).toContain(
        "keeping every branch",
      );
      warnSpy.mockRestore();
    });

    it("should fall back to fs.rmSync when git removal fails, then delete the branch", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      git.handler = (_cmd, args) => {
        if (args[0] === "worktree" && args[1] === "remove") {
          throw gitError("Filename too long", "");
        }
        return { stdout: "", stderr: "" };
      };
      // The fallback worked: the directory is gone once fs.rmSync returns
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await removeWorktree(session);

      expect(warnSpy.mock.calls[0][0]).toContain("falling back to fs.rmSync");
      const rmCalls = vi.mocked(fs.rmSync).mock.calls;
      expect(rmCalls).toHaveLength(1);
      expect(rmCalls[0][1]).toMatchObject({ recursive: true, force: true });
      if (process.platform === "win32") {
        // Extended-length path bypasses the Windows MAX_PATH limit
        expect(String(rmCalls[0][0])).toMatch(/^\\\\\?\\/);
      } else {
        expect(rmCalls[0][0]).toBe("/repo/root/.wave/worktrees/my-feat");
      }
      // Branch deletion and stale-metadata pruning still run despite the failure
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
      expect(gitCallsWith(["worktree", "prune"])).toHaveLength(1);
      warnSpy.mockRestore();
    });

    it("should retry the fs fallback while a just-exited process still holds the directory", async () => {
      // Windows releases a directory handle asynchronously: the first rmSync can
      // fail with EPERM while the process that had the worktree as its cwd is
      // still exiting (issue #2763). The retry is what turns that into a
      // success instead of an orphaned directory.
      let attempts = 0;
      vi.mocked(fs.rmSync).mockImplementation(() => {
        attempts++;
        if (attempts < 3) {
          throw Object.assign(new Error("EPERM: operation not permitted"), {
            code: "EPERM",
          });
        }
      });
      git.handler = (_cmd, args) => {
        if (args[0] === "rev-parse") {
          return { stdout: "worktree-my-feat\n", stderr: "" };
        }
        if (args[0] === "worktree" && args[1] === "remove") {
          throw gitError("Filename too long", "");
        }
        return { stdout: "", stderr: "" };
      };
      // Gone by the time the removal gives up retrying.
      vi.mocked(fs.existsSync).mockReturnValue(false);

      expect(await removeWorktree(session)).toBe(true);

      // One attempt plus the configured retries, not a single shot.
      expect(vi.mocked(fs.rmSync)).toHaveBeenCalledTimes(
        1 + worktreeRemoveRetry.delaysMs.length,
      );
      // The directory is gone, so its branch still goes away.
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
    });

    it("should keep the branch when the directory survived both removal attempts", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      git.handler = (_cmd, args) => {
        if (args[0] === "rev-parse") {
          return { stdout: "worktree-my-feat\n", stderr: "" };
        }
        if (args[0] === "worktree" && args[1] === "remove") {
          throw gitError("Filename too long", "");
        }
        return { stdout: "", stderr: "" };
      };
      vi.mocked(fs.rmSync).mockImplementation(() => {
        throw new Error("rm failed");
      });
      // The directory is still there, so its checkout (and any uncommitted work
      // in it) would be stranded outside git if the branch were deleted too.
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "node_modules",
      ] as unknown as Awaited<ReturnType<typeof fs.readdirSync>>);

      expect(await removeWorktree(session)).toBe(false);
      expect(loggerSpy.mock.calls[0][0]).toContain(
        "Failed to remove worktree or branch",
      );
      expect(gitCallsWith(["branch", "-D"])).toHaveLength(0);
      expect(warnSpy.mock.calls.map((c) => c[0]).join(" ")).toContain(
        "Worktree directory survived removal",
      );
      loggerSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("should keep the branch checked out in the worktree as well", async () => {
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      git.handler = (_cmd, args) => {
        if (args[0] === "rev-parse") {
          return { stdout: "another-branch\n", stderr: "" };
        }
        if (args[0] === "worktree" && args[1] === "remove") {
          throw gitError("Filename too long", "");
        }
        return { stdout: "", stderr: "" };
      };
      vi.mocked(fs.rmSync).mockImplementation(() => {
        throw new Error("rm failed");
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "node_modules",
      ] as unknown as Awaited<ReturnType<typeof fs.readdirSync>>);
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      await removeWorktree(session);

      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        0,
      );
      expect(gitCallsWith(["branch", "-D", "another-branch"])).toHaveLength(0);
      expect(warnSpy.mock.calls.map((c) => c[0]).join(" ")).toContain(
        "keeping worktree-my-feat",
      );
      loggerSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("should log the failing stage, error details and the residue left behind", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      git.handler = (_cmd, args) => {
        if (args[0] === "worktree" && args[1] === "remove") {
          throw gitError(
            "Filename too long",
            "error: failed to delete 'my-feat': Filename too long",
          );
        }
        return { stdout: "", stderr: "" };
      };
      vi.mocked(fs.rmSync).mockImplementation(() => {
        throw Object.assign(new Error("EPERM: operation not permitted"), {
          code: "EPERM",
          syscall: "rmdir",
          path: "C:\\repo\\root\\.wave\\worktrees\\my-feat\\node_modules",
        });
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "node_modules",
        "packages",
      ] as unknown as Awaited<ReturnType<typeof fs.readdirSync>>);

      await removeWorktree(session);

      const message = loggerSpy.mock.calls[0].join(" ");
      expect(message).toContain("Failed to remove worktree or branch");
      expect(message).toContain(`path=${session.path}`);
      // Which stage failed, with the OS error code and the offending path
      expect(message).toContain("stage=fs");
      expect(message).toContain("code=EPERM");
      expect(message).toContain(
        "at=C:\\repo\\root\\.wave\\worktrees\\my-feat\\node_modules",
      );
      // What git said before the fallback took over
      expect(message).toContain("Filename too long");
      // What is still on disk after both attempts
      expect(message).toContain("residue=2[node_modules,packages]");
      loggerSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("should fall back to fs.rmSync when git reports success but the directory survived", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      git.handler = (_cmd, args) => {
        if (args[0] === "rev-parse") {
          return { stdout: "worktree-my-feat\n", stderr: "" };
        }
        // git exits 0 even when it could not delete the directory: on Windows
        // it cannot remove the directory symlinks/junctions pnpm's node_modules
        // is made of.
        return { stdout: "", stderr: "" };
      };
      // Still there after git returned 0; gone once fs.rmSync deleted it
      vi.mocked(fs.existsSync).mockReturnValueOnce(true).mockReturnValue(false);
      // Stated explicitly: earlier cases leave a throwing implementation behind
      // (`clearAllMocks` keeps implementations), and this case is about a
      // fallback that works on its first attempt.
      vi.mocked(fs.rmSync).mockImplementation(() => {});
      vi.mocked(fs.readdirSync).mockReturnValue([
        "node_modules",
      ] as unknown as Awaited<ReturnType<typeof fs.readdirSync>>);

      expect(await removeWorktree(session)).toBe(true);

      const rmCalls = vi.mocked(fs.rmSync).mock.calls;
      expect(rmCalls).toHaveLength(1);
      expect(rmCalls[0][1]).toMatchObject({ recursive: true, force: true });
      if (process.platform === "win32") {
        expect(String(rmCalls[0][0])).toMatch(/^\\\\\?\\/);
      }
      expect(warnSpy.mock.calls[0][0]).toContain(
        "git worktree remove reported success but the directory survived",
      );
      // The fallback deleted the directory, so the branch still goes away
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
      warnSpy.mockRestore();
    });

    it("should keep the branch when git reports success yet the directory survives", async () => {
      git.handler = (_cmd, args) => {
        if (args[0] === "rev-parse") {
          return { stdout: "worktree-my-feat\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      };
      // fs.rmSync cannot delete the skeleton either (locked directory)
      vi.mocked(fs.rmSync).mockImplementation(() => {
        throw new Error("EPERM: operation not permitted");
      });
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "node_modules",
      ] as unknown as Awaited<ReturnType<typeof fs.readdirSync>>);
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      await removeWorktree(session);

      expect(gitCallsWith(["branch", "-D"])).toHaveLength(0);
      expect(warnSpy.mock.calls.map((c) => c[0]).join(" ")).toContain(
        "Worktree directory survived removal",
      );
      loggerSpy.mockRestore();
      warnSpy.mockRestore();
    });

    it("should not touch the filesystem when git succeeds and the directory is gone", async () => {
      git.handler = (_cmd, args) => {
        if (args[0] === "rev-parse") {
          return { stdout: "worktree-my-feat\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      };
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await removeWorktree(session);

      expect(vi.mocked(fs.rmSync)).not.toHaveBeenCalled();
    });

    it("should report the residue as none when the directory is already gone", async () => {
      const loggerSpy = vi.spyOn(logger, "error").mockImplementation(() => {});
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      git.handler = (_cmd, args) => {
        if (args[0] === "worktree" && args[1] === "remove") {
          throw gitError("Filename too long", "");
        }
        return { stdout: "", stderr: "" };
      };
      vi.mocked(fs.rmSync).mockImplementation(() => {
        throw new Error("rm failed");
      });
      vi.mocked(fs.existsSync).mockReturnValue(false);

      await removeWorktree(session);

      expect(loggerSpy.mock.calls[0].join(" ")).toContain("residue=none");
      loggerSpy.mockRestore();
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
        "/repo/root/.wave/worktrees/my-feat",
        expect.objectContaining({
          WorktreeRemove: expect.any(Array),
        }),
        expect.objectContaining({
          projectDir: "/repo/root",
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
      vi.mocked(fs.existsSync).mockReturnValue(true);

      // The hook — not wave — owns the directory, so the filesystem is the only
      // honest answer to "was it removed".
      expect(await removeWorktree({ ...session, hookBased: true })).toBe(false);

      expect(warnSpy.mock.calls[0][0]).toContain(
        "No WorktreeRemove hook configured, hook-based worktree left at",
      );
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
      git.handler = (_cmd, args) => {
        if (args[0] === "rev-parse") {
          return { stdout: "worktree-my-feat\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      };

      await removeWorktree(session);

      expect(executeWorktreeRemoveHook).not.toHaveBeenCalled();
      expect(gitCallsWith(["worktree", "remove", "--force"])).toHaveLength(1);
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
