import { describe, it, expect, vi, beforeEach } from "vitest";
import * as worktreeUtils from "@/utils/worktreeUtils.js";
import * as gitUtils from "@/utils/gitUtils.js";
import * as fs from "node:fs";
import { execSync } from "node:child_process";

vi.mock("node:child_process");
vi.mock("node:fs");
vi.mock("@/utils/gitUtils.js");

describe("worktreeUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateWorktreeName", () => {
    it("accepts valid names", () => {
      expect(() =>
        worktreeUtils.validateWorktreeName("my-feature"),
      ).not.toThrow();
      expect(() => worktreeUtils.validateWorktreeName("a")).not.toThrow();
      expect(() => worktreeUtils.validateWorktreeName("foo/bar")).not.toThrow();
      expect(() =>
        worktreeUtils.validateWorktreeName("feat_1.0"),
      ).not.toThrow();
    });

    it("rejects names longer than 64 chars", () => {
      const longName = "a".repeat(65);
      expect(() => worktreeUtils.validateWorktreeName(longName)).toThrow(
        "Invalid worktree name: must be 64 characters or fewer",
      );
    });

    it("rejects names with . or .. segments", () => {
      expect(() => worktreeUtils.validateWorktreeName("../escape")).toThrow(
        'must not contain "." or ".."',
      );
      expect(() => worktreeUtils.validateWorktreeName("foo/./bar")).toThrow(
        'must not contain "." or ".."',
      );
    });

    it("rejects names with invalid characters", () => {
      expect(() => worktreeUtils.validateWorktreeName("foo bar")).toThrow(
        "must be non-empty and contain only letters",
      );
      expect(() => worktreeUtils.validateWorktreeName("foo@bar")).toThrow();
    });

    it("rejects names with empty segments (leading/trailing/double slash)", () => {
      expect(() => worktreeUtils.validateWorktreeName("/foo")).toThrow();
      expect(() => worktreeUtils.validateWorktreeName("foo/")).toThrow();
      expect(() => worktreeUtils.validateWorktreeName("foo//bar")).toThrow();
    });
  });

  describe("generateWorktreeName", () => {
    it("returns a string in adjective-noun-number format", () => {
      const name = worktreeUtils.generateWorktreeName();
      expect(typeof name).toBe("string");
      expect(name).toMatch(/^[a-z]+-[a-z]+-\d{3}$/);
    });
  });

  describe("getHeadCommit", () => {
    it("returns HEAD commit SHA", () => {
      vi.mocked(execSync).mockReturnValue("abc123def\n");

      const result = worktreeUtils.getHeadCommit("/test");

      expect(result).toBe("abc123def");
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("git -C"),
        expect.objectContaining({ encoding: "utf8" }),
      );
    });
  });

  describe("createWorktree", () => {
    beforeEach(() => {
      vi.mocked(gitUtils.getGitMainRepoRoot).mockReturnValue("/test/repo");
      vi.mocked(gitUtils.getDefaultRemoteBranch).mockReturnValue("origin/main");
      vi.mocked(execSync).mockReturnValue("abc123\n");
      vi.mocked(fs.existsSync).mockReturnValue(false);
    });

    it("creates a new worktree", () => {
      const result = worktreeUtils.createWorktree("my-feat", "/test");

      expect(result.name).toBe("my-feat");
      expect(result.branch).toBe("worktree-my-feat");
      expect(result.path).toBe("/test/repo/.wave/worktrees/my-feat");
      expect(result.repoRoot).toBe("/test/repo");
      expect(result.isNew).toBe(true);
      expect(result.originalHeadCommit).toBe("abc123");
    });

    it("reuses existing worktree", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = worktreeUtils.createWorktree("existing", "/test");

      expect(result.isNew).toBe(false);
      expect(execSync).not.toHaveBeenCalledWith(
        expect.stringContaining("git worktree add -b"),
        expect.anything(),
      );
    });

    it("throws when not in a git repository", () => {
      vi.mocked(gitUtils.getGitMainRepoRoot).mockReturnValue(null as never);

      expect(() => worktreeUtils.createWorktree("feat", "/test")).toThrow(
        "Cannot create a worktree: not in a git repository",
      );
    });

    it("handles branch already exists fallback", () => {
      let callCount = 0;
      vi.mocked(execSync).mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // getHeadCommit
          return "abc123\n";
        }
        if (callCount === 2) {
          // First git worktree add -b fails
          const err = new Error("git error") as Error & {
            stderr?: Buffer;
          };
          err.stderr = Buffer.from("already exists");
          throw err;
        }
        // Second git worktree add (without -b) succeeds
        return "";
      });

      const result = worktreeUtils.createWorktree("feat", "/test");

      expect(result.isNew).toBe(true);
    });
  });

  describe("removeWorktree", () => {
    beforeEach(() => {
      vi.mocked(execSync).mockReturnValue("");
      vi.mocked(gitUtils.getDefaultRemoteBranch).mockReturnValue("origin/main");
    });

    it("removes worktree and branch", () => {
      worktreeUtils.removeWorktree({
        name: "feat",
        path: "/test/repo/.wave/worktrees/feat",
        branch: "worktree-feat",
        repoRoot: "/test/repo",
        isNew: true,
      });

      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("git worktree remove --force"),
        expect.anything(),
      );
      expect(execSync).toHaveBeenCalledWith(
        expect.stringContaining("git branch -D worktree-feat"),
        expect.anything(),
      );
    });

    it("logs and rethrows on failure", () => {
      const error = new Error("git failed");
      vi.mocked(execSync).mockImplementation(() => {
        throw error;
      });

      expect(() =>
        worktreeUtils.removeWorktree({
          name: "feat",
          path: "/test/repo/.wave/worktrees/feat",
          branch: "worktree-feat",
          repoRoot: "/test/repo",
          isNew: true,
        }),
      ).toThrow("git failed");
    });
  });

  describe("countWorktreeChanges", () => {
    it("returns changed files and commits", () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("M file1.txt\n?? file2.txt\n") // status
        .mockReturnValueOnce("3\n"); // rev-list

      const result = worktreeUtils.countWorktreeChanges(
        "/test/worktree",
        "abc123",
      );

      expect(result).toEqual({ changedFiles: 2, commits: 3 });
    });

    it("returns null when originalHeadCommit is undefined", () => {
      vi.mocked(execSync).mockReturnValueOnce("\n"); // empty status

      const result = worktreeUtils.countWorktreeChanges(
        "/test/worktree",
        undefined,
      );

      expect(result).toBeNull();
    });

    it("returns null when git commands fail", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("git error");
      });

      const result = worktreeUtils.countWorktreeChanges(
        "/test/worktree",
        "abc123",
      );

      expect(result).toBeNull();
    });

    it("returns 0 commits for clean worktree", () => {
      vi.mocked(execSync)
        .mockReturnValueOnce("") // no changes
        .mockReturnValueOnce("0\n"); // no commits

      const result = worktreeUtils.countWorktreeChanges(
        "/test/worktree",
        "abc123",
      );

      expect(result).toEqual({ changedFiles: 0, commits: 0 });
    });
  });
});
