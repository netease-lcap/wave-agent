import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  createWorktree,
  performPostCreationSetup,
  removeWorktree,
  validateWorktreeSlug,
} from "../../src/utils/worktree.js";
import { getDefaultRemoteBranch, getGitMainRepoRoot } from "wave-agent-sdk";

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

/** readFile mock that returns content for exact paths and ENOENT otherwise */
function mockReadFile(map: Record<string, string>) {
  vi.mocked(fs.promises.readFile).mockImplementation(async (p) => {
    for (const [filePath, content] of Object.entries(map)) {
      if (p === filePath) return content;
    }
    throw enoent();
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

    it("should copy settings.local.json into newly created worktrees", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);
      mockReadFile({
        [path.join("/repo/root", ".wave", "settings.local.json")]:
          '{"model":"claude"}',
      });

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.isNew).toBe(true);
      expect(vi.mocked(fs.promises.writeFile)).toHaveBeenCalledWith(
        path.join(
          "/repo/root",
          ".wave",
          "worktrees",
          "my-feat",
          ".wave",
          "settings.local.json",
        ),
        '{"model":"claude"}',
      );
    });

    it("should skip post-creation setup for existing worktrees", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.promises.readFile).mockResolvedValue("{}");

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.isNew).toBe(false);
      expect(vi.mocked(fs.promises.readFile)).not.toHaveBeenCalled();
      expect(vi.mocked(fs.promises.writeFile)).not.toHaveBeenCalled();
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

    it("should log error if removal fails", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      git.handler = () => {
        throw gitError("Removal failed", "");
      };

      await removeWorktree(session);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to remove worktree or branch"),
      );
      consoleSpy.mockRestore();
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

  describe("performPostCreationSetup", () => {
    it("should copy settings.local.json into the worktree when present", async () => {
      mockReadFile({
        [path.join("/repo/root", ".wave", "settings.local.json")]:
          '{"model":"claude"}',
      });

      await performPostCreationSetup(
        "/repo/root/.wave/worktrees/my-feat",
        "/repo/root",
      );

      expect(vi.mocked(fs.promises.writeFile)).toHaveBeenCalledWith(
        path.join(
          "/repo/root/.wave/worktrees/my-feat",
          ".wave",
          "settings.local.json",
        ),
        '{"model":"claude"}',
      );
    });

    it("should not copy settings.local.json when the main repo lacks it", async () => {
      await performPostCreationSetup(
        "/repo/root/.wave/worktrees/my-feat",
        "/repo/root",
      );

      expect(vi.mocked(fs.promises.writeFile)).not.toHaveBeenCalled();
      expect(git.calls.filter((c) => c.args.includes("ls-files"))).toHaveLength(
        0,
      );
    });

    it("should copy matched files and skip unmatched ones", async () => {
      mockReadFile({
        [path.join("/repo/root", ".worktreeinclude")]:
          "dist/\n*.env\n!prod.env\nconfig/secret.key\n",
      });
      git.handler = (_cmd, args) => {
        if (args[0] === "ls-files") {
          return {
            stdout:
              "dist/\n.env\nprod.env\nconfig/secret.key\nconfig/other.key\n",
            stderr: "",
          };
        }
        throw new Error("unexpected git call: " + args.join(" "));
      };

      await performPostCreationSetup(
        "/repo/root/.wave/worktrees/my-feat",
        "/repo/root",
      );

      // dist/ matches the dir-only pattern -> copied wholesale
      expect(vi.mocked(fs.promises.cp)).toHaveBeenCalledWith(
        path.join("/repo/root", "dist"),
        path.join("/repo/root/.wave/worktrees/my-feat", "dist"),
        { recursive: true },
      );
      // .env matches *.env at any level
      expect(vi.mocked(fs.promises.copyFile)).toHaveBeenCalledWith(
        path.join("/repo/root", ".env"),
        path.join("/repo/root/.wave/worktrees/my-feat", ".env"),
      );
      // prod.env excluded by the later !prod.env negation
      expect(vi.mocked(fs.promises.copyFile)).not.toHaveBeenCalledWith(
        path.join("/repo/root", "prod.env"),
        expect.anything(),
      );
      // config/secret.key matches its literal pattern
      expect(vi.mocked(fs.promises.copyFile)).toHaveBeenCalledWith(
        path.join("/repo/root", "config", "secret.key"),
        path.join("/repo/root/.wave/worktrees/my-feat", "config", "secret.key"),
      );
      // config/other.key does not match any pattern
      expect(vi.mocked(fs.promises.copyFile)).not.toHaveBeenCalledWith(
        path.join("/repo/root", "config", "other.key"),
        expect.anything(),
      );
      // no dirs needed expansion -> exactly one ls-files call
      expect(git.calls.filter((c) => c.args.includes("ls-files"))).toHaveLength(
        1,
      );
    });

    it("should expand collapsed dirs whose contents match patterns", async () => {
      mockReadFile({
        [path.join("/repo/root", ".worktreeinclude")]:
          "config/secrets/api.key\n",
      });
      let lsCalls = 0;
      git.handler = (_cmd, args) => {
        if (args[0] === "ls-files") {
          lsCalls++;
          if (lsCalls === 1) {
            return { stdout: "config/secrets/\n", stderr: "" };
          }
          return {
            stdout: "config/secrets/api.key\nconfig/secrets/other.key\n",
            stderr: "",
          };
        }
        throw new Error("unexpected git call: " + args.join(" "));
      };

      await performPostCreationSetup(
        "/repo/root/.wave/worktrees/my-feat",
        "/repo/root",
      );

      expect(lsCalls).toBe(2);
      expect(git.calls[1].args).toContain("--");
      expect(git.calls[1].args).toContain("config/secrets");
      expect(vi.mocked(fs.promises.copyFile)).toHaveBeenCalledWith(
        path.join("/repo/root", "config", "secrets", "api.key"),
        path.join(
          "/repo/root/.wave/worktrees/my-feat",
          "config",
          "secrets",
          "api.key",
        ),
      );
      expect(vi.mocked(fs.promises.copyFile)).not.toHaveBeenCalledWith(
        path.join("/repo/root", "config", "secrets", "other.key"),
        expect.anything(),
      );
    });

    it("should copy nothing when no entries match", async () => {
      mockReadFile({
        [path.join("/repo/root", ".worktreeinclude")]: "dist/\n",
      });
      git.handler = (_cmd, args) => {
        if (args[0] === "ls-files") {
          return { stdout: "coverage/\nfoo.ts\n", stderr: "" };
        }
        throw new Error("unexpected git call: " + args.join(" "));
      };

      await performPostCreationSetup(
        "/repo/root/.wave/worktrees/my-feat",
        "/repo/root",
      );

      expect(vi.mocked(fs.promises.cp)).not.toHaveBeenCalled();
      expect(vi.mocked(fs.promises.copyFile)).not.toHaveBeenCalled();
    });
  });
});
