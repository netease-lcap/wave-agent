import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { createWorktree, removeWorktree } from "../../src/utils/worktree.js";
import {
  getDefaultRemoteBranch,
  getGitMainRepoRoot,
  executeWorktreeCreateHookDirect,
  executeWorktreeRemoveHookDirect,
} from "wave-agent-sdk";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("wave-agent-sdk", () => ({
  getGitMainRepoRoot: vi.fn(),
  getDefaultRemoteBranch: vi.fn(),
  executeWorktreeCreateHookDirect: vi.fn().mockResolvedValue(null),
  executeWorktreeRemoveHookDirect: vi.fn().mockResolvedValue(false),
}));

describe("worktree utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeWorktreeCreateHookDirect).mockResolvedValue(null);
    vi.mocked(executeWorktreeRemoveHookDirect).mockResolvedValue(false);
  });

  describe("createWorktree", () => {
    it("should create a new worktree", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.name).toBe("my-feat");
      expect(session.path).toBe("/repo/root/.wave/worktrees/my-feat");
      expect(session.branch).toBe("worktree-my-feat");
      expect(session.repoRoot).toBe("/repo/root");
      expect(session.isNew).toBe(true);
      expect(session.hookBased).toBe(false);
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "add", "-b", "worktree-my-feat"]),
        expect.any(Object),
      );
    });

    it("should reuse an existing worktree", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.name).toBe("my-feat");
      expect(session.isNew).toBe(false);
      expect(session.hookBased).toBe(false);
      expect(execFileSync).not.toHaveBeenCalled();
    });

    it("should handle branch already exists error by adding worktree without -b", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const error = new Error("Command failed");
      (error as { stderr?: Buffer }).stderr = Buffer.from(
        "fatal: a branch named 'worktree-my-feat' already exists",
      );
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw error;
      });

      vi.mocked(execFileSync).mockImplementationOnce(() => Buffer.from(""));

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.name).toBe("my-feat");
      expect(session.repoRoot).toBe("/repo/root");
      expect(session.isNew).toBe(true);
      expect(session.hookBased).toBe(false);
      expect(execFileSync).toHaveBeenCalledTimes(2);
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "add", "worktree-my-feat"]),
        expect.any(Object),
      );
    });

    it("should throw error if worktree creation fails with other error", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const error = new Error("Some other error");
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw error;
      });

      await expect(createWorktree("my-feat", "/repo/root")).rejects.toThrow(
        "Failed to create worktree",
      );
    });

    it("should throw error if adding existing branch fails", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const error = new Error("Command failed");
      (error as { stderr?: Buffer }).stderr = Buffer.from(
        "fatal: a branch named 'worktree-my-feat' already exists",
      );
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw error;
      });

      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw new Error("Inner error");
      });

      await expect(createWorktree("my-feat", "/repo/root")).rejects.toThrow(
        "Failed to add existing worktree branch",
      );
    });

    it("should fetch default branch when not found locally, then create worktree", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const error = new Error("Command failed");
      (error as { stderr?: Buffer }).stderr = Buffer.from(
        "not a valid object name",
      );
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw error;
      });

      vi.mocked(execFileSync).mockImplementationOnce(() => Buffer.from(""));
      vi.mocked(execFileSync).mockImplementationOnce(() => Buffer.from(""));

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.isNew).toBe(true);
      expect(session.hookBased).toBe(false);
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["fetch", "origin", "main"]),
        expect.any(Object),
      );
    });

    it("should fall back to HEAD when fetch also fails", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const error = new Error("Command failed");
      (error as { stderr?: Buffer }).stderr = Buffer.from(
        "not a valid object name",
      );
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw error;
      });

      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw new Error("fetch failed");
      });

      vi.mocked(execFileSync).mockImplementationOnce(() => Buffer.from(""));

      const session = await createWorktree("my-feat", "/repo/root");

      expect(session.isNew).toBe(true);
      expect(session.hookBased).toBe(false);
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining([
          "worktree",
          "add",
          "-b",
          "worktree-my-feat",
          "HEAD",
        ]),
        expect.any(Object),
      );
    });

    it("should throw when both fetch and HEAD fallback fail", async () => {
      vi.mocked(getGitMainRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const error = new Error("Command failed");
      (error as { stderr?: Buffer }).stderr = Buffer.from(
        "not a valid object name",
      );
      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw error;
      });

      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw new Error("fetch failed");
      });

      vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw new Error("HEAD fallback failed");
      });

      await expect(createWorktree("my-feat", "/repo/root")).rejects.toThrow(
        "Failed to create worktree",
      );
    });
  });

  describe("removeWorktree", () => {
    it("should remove worktree and branch", async () => {
      const session = {
        name: "my-feat",
        path: "/repo/root/.wave/worktrees/my-feat",
        branch: "worktree-my-feat",
        repoRoot: "/repo/root",
        hasUncommittedChanges: false,
        hasNewCommits: false,
        isNew: false,
        hookBased: false,
      };

      vi.mocked(execFileSync).mockReturnValue(
        Buffer.from("worktree-my-feat\n"),
      );

      await removeWorktree(session);

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "remove", "--force"]),
        expect.any(Object),
      );
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["branch", "-D", "worktree-my-feat"]),
        expect.any(Object),
      );
    });

    it("should remove worktree, original branch, and current branch if different", async () => {
      const session = {
        name: "my-feat",
        path: "/repo/root/.wave/worktrees/my-feat",
        branch: "worktree-my-feat",
        repoRoot: "/repo/root",
        hasUncommittedChanges: false,
        hasNewCommits: false,
        isNew: false,
        hookBased: false,
      };

      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
        const a = args as string[];
        if (
          a[0] === "rev-parse" &&
          a[1] === "--abbrev-ref" &&
          a[2] === "HEAD"
        ) {
          return "another-branch\n";
        }
        return "";
      });

      await removeWorktree(session);

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "remove", "--force"]),
        expect.any(Object),
      );
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["branch", "-D", "worktree-my-feat"]),
        expect.any(Object),
      );
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["branch", "-D", "another-branch"]),
        expect.any(Object),
      );
    });

    it("should NOT remove current branch if it is a protected branch", async () => {
      const session = {
        name: "my-feat",
        path: "/repo/root/.wave/worktrees/my-feat",
        branch: "worktree-my-feat",
        repoRoot: "/repo/root",
        hasUncommittedChanges: false,
        hasNewCommits: false,
        isNew: false,
        hookBased: false,
      };

      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
        const a = args as string[];
        if (
          a[0] === "rev-parse" &&
          a[1] === "--abbrev-ref" &&
          a[2] === "HEAD"
        ) {
          return "main\n";
        }
        return "";
      });

      await removeWorktree(session);

      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["worktree", "remove", "--force"]),
        expect.any(Object),
      );
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["branch", "-D", "worktree-my-feat"]),
        expect.any(Object),
      );
      expect(execFileSync).not.toHaveBeenCalledWith(
        "git",
        expect.arrayContaining(["branch", "-D", "main"]),
        expect.any(Object),
      );
    });

    it("should log error if removal fails", async () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("Removal failed");
      });

      const session = {
        name: "my-feat",
        path: "/repo/root/.wave/worktrees/my-feat",
        branch: "worktree-my-feat",
        repoRoot: "/repo/root",
        hasUncommittedChanges: false,
        hasNewCommits: false,
        isNew: false,
        hookBased: false,
      };

      await removeWorktree(session);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to remove worktree or branch"),
      );
      consoleSpy.mockRestore();
    });
  });
});
