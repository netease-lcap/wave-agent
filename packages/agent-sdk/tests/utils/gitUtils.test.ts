import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fsSync from "node:fs";
import * as path from "node:path";
import {
  getGitRepoRoot,
  getGitMainRepoRoot,
  getDefaultRemoteBranch,
  resolveGitDir,
  hasUncommittedChanges,
  hasNewCommits,
  ensureWaveRuntimeFilesExcluded,
} from "../../src/utils/gitUtils.js";

vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  statSync: vi.fn(),
  readdirSync: vi.fn(),
  mkdirSync: vi.fn(),
  appendFileSync: vi.fn(),
}));

describe("gitUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getGitRepoRoot", () => {
    it("should return the git repo root", () => {
      vi.mocked(execFileSync).mockReturnValue(
        "/repo/root\n" as unknown as ReturnType<typeof execFileSync>,
      );
      expect(getGitRepoRoot("/some/path")).toBe("/repo/root");
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["rev-parse", "--show-toplevel"],
        expect.any(Object),
      );
    });

    it("should return cwd if git command fails", () => {
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error("Not a git repo");
      });
      expect(getGitRepoRoot("/some/path")).toBe("/some/path");
    });
  });

  describe("getGitMainRepoRoot", () => {
    it("should return the main repo root from git worktree list", () => {
      vi.mocked(execFileSync).mockReturnValue(
        "worktree /repo/main\nHEAD 123\nbranch refs/heads/main\n\nworktree /repo/worktree1\nHEAD 456\nbranch refs/heads/wt1\n" as unknown as ReturnType<
          typeof execFileSync
        >,
      );
      expect(getGitMainRepoRoot("/repo/worktree1")).toBe("/repo/main");
      expect(execFileSync).toHaveBeenCalledWith(
        "git",
        ["worktree", "list", "--porcelain"],
        expect.any(Object),
      );
    });

    it("should fallback to getGitRepoRoot if git worktree list fails", () => {
      vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
        const a = args as string[];
        if (a[0] === "worktree" && a[1] === "list") {
          throw new Error("Command failed");
        }
        if (a[0] === "rev-parse" && a[1] === "--show-toplevel") {
          return "/repo/root\n" as unknown as ReturnType<typeof execFileSync>;
        }
        throw new Error("Command failed");
      });
      expect(getGitMainRepoRoot("/some/path")).toBe("/repo/root");
    });

    it("should fallback to getGitRepoRoot if output is unexpected", () => {
      vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
        const a = args as string[];
        if (a[0] === "worktree" && a[1] === "list") {
          return "unexpected output" as unknown as ReturnType<
            typeof execFileSync
          >;
        }
        if (a[0] === "rev-parse" && a[1] === "--show-toplevel") {
          return "/repo/root\n" as unknown as ReturnType<typeof execFileSync>;
        }
        throw new Error("Command failed");
      });
      expect(getGitMainRepoRoot("/some/path")).toBe("/repo/root");
    });
  });

  describe("resolveGitDir", () => {
    it("should find .git directory for a normal repo", () => {
      vi.mocked(fsSync.existsSync).mockImplementation(
        (p) => p === "/repo/root/.git",
      );
      vi.mocked(fsSync.statSync).mockReturnValue({
        isDirectory: () => true,
      } as unknown as fsSync.Stats);
      expect(resolveGitDir("/repo/root")).toBe("/repo/root/.git");
    });

    it("should resolve worktree git dir via commondir", () => {
      const worktreeGitDir = "/repo/main/.git/worktrees/wt1";
      vi.mocked(fsSync.existsSync).mockImplementation(
        (p) =>
          p === "/repo/worktree/.git" ||
          p === path.join(worktreeGitDir, "commondir"),
      );
      vi.mocked(fsSync.statSync).mockReturnValue({
        isDirectory: () => false,
      } as unknown as fsSync.Stats);
      vi.mocked(fsSync.readFileSync).mockImplementation((p) => {
        if (p === "/repo/worktree/.git") return `gitdir: ${worktreeGitDir}`;
        if (p === path.join(worktreeGitDir, "commondir")) return "../..\n";
        throw new Error("Not found");
      });
      expect(resolveGitDir("/repo/worktree")).toBe("/repo/main/.git");
    });

    it("should return null if no .git found", () => {
      vi.mocked(fsSync.existsSync).mockReturnValue(false);
      expect(resolveGitDir("/some/path")).toBeNull();
    });
  });

  describe("getDefaultRemoteBranch", () => {
    const gitDir = "/repo/root/.git";

    function mockGitDirFound() {
      vi.mocked(fsSync.existsSync).mockImplementation(
        (p) =>
          p === "/repo/root/.git" ||
          p === path.join(gitDir, "refs/remotes/origin/main") ||
          p === path.join(gitDir, "refs/remotes/origin/master") ||
          p === path.join(gitDir, "refs/remotes/origin/HEAD"),
      );
      vi.mocked(fsSync.statSync).mockReturnValue({
        isDirectory: () => true,
      } as unknown as fsSync.Stats);
    }

    it("should return branch from origin/HEAD symref (Step 1)", () => {
      mockGitDirFound();
      vi.mocked(fsSync.readFileSync).mockImplementation((p) => {
        if (p === path.join(gitDir, "refs/remotes/origin/HEAD"))
          return "ref: refs/remotes/origin/main\n";
        throw new Error("Not found");
      });
      // refs/remotes/origin/main exists (already in existsSync mock)
      expect(getDefaultRemoteBranch("/repo/root")).toBe("origin/main");
    });

    it("should skip stale origin/HEAD and fallback (Step 1 stale)", () => {
      vi.mocked(fsSync.existsSync).mockImplementation(
        (p) =>
          p === "/repo/root/.git" ||
          p === path.join(gitDir, "refs/remotes/origin/HEAD") ||
          p === path.join(gitDir, "refs/remotes/origin/main"),
      );
      vi.mocked(fsSync.statSync).mockReturnValue({
        isDirectory: () => true,
      } as unknown as fsSync.Stats);
      vi.mocked(fsSync.readFileSync).mockImplementation((p) => {
        if (p === path.join(gitDir, "refs/remotes/origin/HEAD"))
          return "ref: refs/remotes/origin/master\n";
        throw new Error("Not found");
      });
      // origin/master ref doesn't exist, but origin/main does
      expect(getDefaultRemoteBranch("/repo/root")).toBe("origin/main");
    });

    it("should fallback to origin/main if ref exists (Step 2)", () => {
      vi.mocked(fsSync.existsSync).mockImplementation(
        (p) =>
          p === "/repo/root/.git" ||
          p === path.join(gitDir, "refs/remotes/origin/main"),
      );
      vi.mocked(fsSync.statSync).mockReturnValue({
        isDirectory: () => true,
      } as unknown as fsSync.Stats);
      // No origin/HEAD file, but origin/main exists
      expect(getDefaultRemoteBranch("/repo/root")).toBe("origin/main");
    });

    it("should fallback to origin/master if ref exists (Step 3)", () => {
      vi.mocked(fsSync.existsSync).mockImplementation(
        (p) =>
          p === "/repo/root/.git" ||
          p === path.join(gitDir, "refs/remotes/origin/master"),
      );
      vi.mocked(fsSync.statSync).mockReturnValue({
        isDirectory: () => true,
      } as unknown as fsSync.Stats);
      expect(getDefaultRemoteBranch("/repo/root")).toBe("origin/master");
    });

    it("should return 'main' as hardcoded fallback (Step 4)", () => {
      vi.mocked(fsSync.existsSync).mockImplementation(
        (p) => p === "/repo/root/.git",
      );
      vi.mocked(fsSync.statSync).mockReturnValue({
        isDirectory: () => true,
      } as unknown as fsSync.Stats);
      expect(getDefaultRemoteBranch("/repo/root")).toBe("main");
    });

    it("should return 'main' if no git dir found", () => {
      vi.mocked(fsSync.existsSync).mockReturnValue(false);
      expect(getDefaultRemoteBranch("/some/path")).toBe("main");
    });

    it("should find ref in packed-refs", () => {
      vi.mocked(fsSync.existsSync).mockImplementation(
        (p) =>
          p === "/repo/root/.git" || p === path.join(gitDir, "packed-refs"),
      );
      vi.mocked(fsSync.statSync).mockReturnValue({
        isDirectory: () => true,
      } as unknown as fsSync.Stats);
      vi.mocked(fsSync.readFileSync).mockImplementation((p) => {
        if (p === path.join(gitDir, "packed-refs"))
          return "abc123 refs/remotes/origin/main\n";
        throw new Error("Not found");
      });
      expect(getDefaultRemoteBranch("/repo/root")).toBe("origin/main");
    });

    it("should skip comments and peeled lines in packed-refs", () => {
      vi.mocked(fsSync.existsSync).mockImplementation(
        (p) =>
          p === "/repo/root/.git" || p === path.join(gitDir, "packed-refs"),
      );
      vi.mocked(fsSync.statSync).mockReturnValue({
        isDirectory: () => true,
      } as unknown as fsSync.Stats);
      vi.mocked(fsSync.readFileSync).mockImplementation((p) => {
        if (p === path.join(gitDir, "packed-refs"))
          return "# pack-refs\n^def456\nabc123 refs/remotes/origin/main\n";
        throw new Error("Not found");
      });
      expect(getDefaultRemoteBranch("/repo/root")).toBe("origin/main");
    });
  });

  describe("hasUncommittedChanges", () => {
    it("should return true if there are changes", () => {
      vi.mocked(execFileSync).mockReturnValue(
        " M file.ts\n" as unknown as ReturnType<typeof execFileSync>,
      );
      expect(hasUncommittedChanges("/repo/root")).toBe(true);
    });

    it("should return false if there are no changes", () => {
      vi.mocked(execFileSync).mockReturnValue(
        "" as unknown as ReturnType<typeof execFileSync>,
      );
      expect(hasUncommittedChanges("/repo/root")).toBe(false);
    });
  });

  describe("hasNewCommits", () => {
    it("should return true if there are new commits", () => {
      vi.mocked(execFileSync).mockReturnValue(
        "abc1234 Commit message\n" as unknown as ReturnType<
          typeof execFileSync
        >,
      );
      expect(hasNewCommits("/repo/root", "origin/main")).toBe(true);
    });

    it("should return false if there are no new commits", () => {
      vi.mocked(execFileSync).mockReturnValue(
        "" as unknown as ReturnType<typeof execFileSync>,
      );
      expect(hasNewCommits("/repo/root", "origin/main")).toBe(false);
    });
  });

  describe("ensureWaveRuntimeFilesExcluded", () => {
    beforeEach(() => {
      vi.clearAllMocks();
    });

    it("should write marker + patterns to info/exclude when marker absent", () => {
      const gitDir = "/repo/write-test/.git";
      const excludePath = path.join(gitDir, "info", "exclude");
      vi.mocked(fsSync.existsSync).mockImplementation(
        (p) => p === path.join("/repo/write-test", ".git"),
      );
      vi.mocked(fsSync.statSync).mockReturnValue({
        isDirectory: () => true,
      } as unknown as fsSync.Stats);
      // exclude file doesn't exist yet (readFileSync throws)
      vi.mocked(fsSync.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      ensureWaveRuntimeFilesExcluded("/repo/write-test");

      expect(fsSync.mkdirSync).toHaveBeenCalledWith(path.join(gitDir, "info"), {
        recursive: true,
      });
      expect(fsSync.appendFileSync).toHaveBeenCalledWith(
        excludePath,
        expect.stringContaining("# wave-runtime"),
      );
      expect(fsSync.appendFileSync).toHaveBeenCalledWith(
        excludePath,
        expect.stringContaining("**/.wave/scheduled_tasks.lock"),
      );
      expect(fsSync.appendFileSync).toHaveBeenCalledWith(
        excludePath,
        expect.stringContaining("**/.wave/settings.local.json"),
      );
    });

    it("should skip when marker already present (idempotent)", () => {
      vi.mocked(fsSync.existsSync).mockImplementation(
        (p) => p === path.join("/repo/idempotent-test", ".git"),
      );
      vi.mocked(fsSync.statSync).mockReturnValue({
        isDirectory: () => true,
      } as unknown as fsSync.Stats);
      vi.mocked(fsSync.readFileSync).mockReturnValue(
        "# wave-runtime\n**/.wave/settings.local.json\n",
      );

      ensureWaveRuntimeFilesExcluded("/repo/idempotent-test");

      expect(fsSync.appendFileSync).not.toHaveBeenCalled();
    });

    it("should be a no-op when not a git repo (resolveGitDir returns null)", () => {
      vi.mocked(fsSync.existsSync).mockReturnValue(false);

      ensureWaveRuntimeFilesExcluded("/some/non-repo/path");

      expect(fsSync.readFileSync).not.toHaveBeenCalled();
      expect(fsSync.appendFileSync).not.toHaveBeenCalled();
    });
  });
});
