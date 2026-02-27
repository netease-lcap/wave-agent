import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { createWorktree, removeWorktree } from "../../src/utils/worktree.js";
import { getGitRepoRoot, getDefaultRemoteBranch } from "wave-agent-sdk";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("wave-agent-sdk", () => ({
  getGitRepoRoot: vi.fn(),
  getDefaultRemoteBranch: vi.fn(),
}));

describe("worktree utils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createWorktree", () => {
    it("should create a new worktree", () => {
      vi.mocked(getGitRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const session = createWorktree("my-feat", "/repo/root");

      expect(session.name).toBe("my-feat");
      expect(session.path).toBe(
        path.join("/repo/root", ".wave/worktrees/my-feat"),
      );
      expect(session.branch).toBe("worktree-my-feat");
      expect(session.repoRoot).toBe("/repo/root");
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("git worktree add -b worktree-my-feat"),
        expect.any(Object),
      );
    });

    it("should handle branch already exists error by adding worktree without -b", () => {
      vi.mocked(getGitRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // First call fails with "already exists"
      const error = new Error("Command failed");
      (error as { stderr?: Buffer }).stderr = Buffer.from(
        "fatal: a branch named 'worktree-my-feat' already exists",
      );
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw error;
      });

      // Second call succeeds
      vi.mocked(execSync).mockImplementationOnce(() => Buffer.from(""));

      const session = createWorktree("my-feat", "/repo/root");

      expect(session.name).toBe("my-feat");
      expect(session.repoRoot).toBe("/repo/root");
      expect(execSync).toHaveBeenCalledTimes(2);
      expect(execSync).toHaveBeenCalledWith(
        expect.stringMatching(/git worktree add "[^"]+" worktree-my-feat/),
        expect.any(Object),
      );
    });

    it("should throw error if worktree creation fails with other error", () => {
      vi.mocked(getGitRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const error = new Error("Some other error");
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw error;
      });

      expect(() => createWorktree("my-feat", "/repo/root")).toThrow(
        "Failed to create worktree",
      );
    });

    it("should throw error if adding existing branch fails", () => {
      vi.mocked(getGitRepoRoot).mockReturnValue("/repo/root");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const error = new Error("Command failed");
      (error as { stderr?: Buffer }).stderr = Buffer.from(
        "fatal: a branch named 'worktree-my-feat' already exists",
      );
      vi.mocked(execSync).mockImplementationOnce(() => {
        throw error;
      });

      vi.mocked(execSync).mockImplementationOnce(() => {
        throw new Error("Inner error");
      });

      expect(() => createWorktree("my-feat", "/repo/root")).toThrow(
        "Failed to add existing worktree branch",
      );
    });
  });

  describe("removeWorktree", () => {
    it("should remove worktree and branch", () => {
      const chdirSpy = vi.spyOn(process, "chdir").mockImplementation(() => {});
      const cwdSpy = vi
        .spyOn(process, "cwd")
        .mockReturnValue("/repo/root/.wave/worktrees/my-feat");

      const session = {
        name: "my-feat",
        path: "/repo/root/.wave/worktrees/my-feat",
        branch: "worktree-my-feat",
        repoRoot: "/repo/root",
        hasUncommittedChanges: false,
        hasNewCommits: false,
      };

      removeWorktree(session);

      expect(chdirSpy).toHaveBeenCalledWith("/repo/root");
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("git worktree remove --force"),
        expect.any(Object),
      );
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("git branch -D worktree-my-feat"),
        expect.any(Object),
      );

      chdirSpy.mockRestore();
      cwdSpy.mockRestore();
    });

    it("should log error if removal fails", () => {
      const consoleSpy = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      vi.spyOn(process, "chdir").mockImplementation(() => {});
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("Removal failed");
      });

      const session = {
        name: "my-feat",
        path: "/repo/root/.wave/worktrees/my-feat",
        branch: "worktree-my-feat",
        repoRoot: "/repo/root",
        hasUncommittedChanges: false,
        hasNewCommits: false,
      };

      removeWorktree(session);

      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Failed to remove worktree or branch"),
      );
      consoleSpy.mockRestore();
      vi.restoreAllMocks();
    });
  });
});
