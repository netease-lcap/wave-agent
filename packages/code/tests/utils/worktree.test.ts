import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createWorktree,
  listWorktrees,
  removeWorktree,
  validateWorktreeSlug,
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

const { git } = vi.hoisted(() => {
  const git = {
    calls: [] as Array<{ cmd: string; args: string[]; opts: unknown }>,
    handler: (): GitResult => ({ stdout: "", stderr: "" }) as GitResult,
  } as {
    calls: Array<{ cmd: string; args: string[]; opts: unknown }>;
    handler: (cmd: string, args: string[], opts: unknown) => GitResult;
  };
  return { git };
});

vi.mock("node:child_process", async () => {
  const { promisify } = await import("node:util");
  const execFile = vi.fn(() => {
    throw new Error("execFile must only be used via util.promisify");
  });
  // worktree.ts wraps execFile with util.promisify, which prefers the
  // promisify.custom symbol — mirror node's { stdout, stderr } result shape.
  (execFile as unknown as Record<PropertyKey, unknown>)[promisify.custom] = (
    cmd: string,
    args: string[],
    opts?: unknown,
  ): Promise<GitResult> => {
    git.calls.push({ cmd, args, opts });
    try {
      return Promise.resolve(git.handler(cmd, args, opts));
    } catch (error) {
      return Promise.reject(error);
    }
  };
  return { execFile };
});

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  rmSync: vi.fn(),
  promises: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    mkdir: vi.fn(),
    copyFile: vi.fn(),
    cp: vi.fn(),
  },
}));

vi.mock("wave-agent-sdk", () => ({
  getGitMainRepoRoot: vi.fn(),
  getDefaultRemoteBranch: vi.fn(),
  performPostCreationSetup: vi.fn(),
  loadMergedWaveConfig: vi.fn(),
  hasWorktreeCreateHook: vi.fn(),
  executeWorktreeCreateHook: vi.fn(),
  executeWorktreeRemoveHook: vi.fn(),
}));

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

      await removeWorktree(session);

      expect(gitCallsWith(["worktree", "remove", "--force"])).toHaveLength(1);
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
    });

    it("should remove worktree, original branch, and current branch if different", async () => {
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      git.handler = (_cmd, args) => {
        if (args[0] === "rev-parse") {
          return { stdout: "another-branch\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      };

      await removeWorktree(session);

      expect(gitCallsWith(["worktree", "remove", "--force"])).toHaveLength(1);
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
      expect(gitCallsWith(["branch", "-D", "another-branch"])).toHaveLength(1);
    });

    it("should NOT remove current branch if it is a protected branch", async () => {
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      git.handler = (_cmd, args) => {
        if (args[0] === "rev-parse") {
          return { stdout: "main\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      };

      await removeWorktree(session);

      expect(gitCallsWith(["worktree", "remove", "--force"])).toHaveLength(1);
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
      expect(gitCallsWith(["branch", "-D", "main"])).toHaveLength(0);
    });

    it("should fall back to fs.rmSync and still delete the branch when git removal fails", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      git.handler = (_cmd, args) => {
        if (args[0] === "worktree" && args[1] === "remove") {
          throw gitError("Filename too long", "");
        }
        return { stdout: "", stderr: "" };
      };

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

    it("should log error but still delete the branch when git and fs.rmSync both fail", async () => {
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

      await removeWorktree(session);

      expect(loggerSpy.mock.calls[0][0]).toContain(
        "Failed to remove worktree or branch",
      );
      // Branch deletion still runs even when both removal attempts fail
      expect(gitCallsWith(["branch", "-D", "worktree-my-feat"])).toHaveLength(
        1,
      );
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

      await removeWorktree({ ...session, hookBased: true });

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
