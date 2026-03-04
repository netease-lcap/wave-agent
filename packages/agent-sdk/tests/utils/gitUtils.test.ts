import { describe, it, expect, vi, beforeEach } from "vitest";
import { execSync } from "node:child_process";
import {
  getGitRepoRoot,
  getDefaultRemoteBranch,
  hasUncommittedChanges,
  hasNewCommits,
} from "../../src/utils/gitUtils.js";

vi.mock("node:child_process", () => ({
  execSync: vi.fn(),
}));

describe("gitUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getGitRepoRoot", () => {
    it("should return the git repo root", () => {
      vi.mocked(execSync).mockReturnValue(
        "/repo/root\n" as unknown as ReturnType<typeof execSync>,
      );
      expect(getGitRepoRoot("/some/path")).toBe("/repo/root");
      expect(execSync).toHaveBeenCalledWith(
        "git rev-parse --show-toplevel",
        expect.any(Object),
      );
    });

    it("should return cwd if git command fails", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("Not a git repo");
      });
      expect(getGitRepoRoot("/some/path")).toBe("/some/path");
    });
  });

  describe("getDefaultRemoteBranch", () => {
    it("should return the default remote branch from symbolic-ref (Step 1)", () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd === "git symbolic-ref refs/remotes/origin/HEAD") {
          return "refs/remotes/origin/main\n" as unknown as ReturnType<
            typeof execSync
          >;
        }
        throw new Error("Command failed");
      });
      expect(getDefaultRemoteBranch("/repo/root")).toBe("origin/main");
    });

    it("should fallback to origin/main if it exists (Step 2)", () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd === "git symbolic-ref refs/remotes/origin/HEAD") {
          throw new Error("Command failed");
        }
        if (cmd === "git rev-parse --verify origin/main") {
          return "" as unknown as ReturnType<typeof execSync>;
        }
        throw new Error("Command failed");
      });
      expect(getDefaultRemoteBranch("/repo/root")).toBe("origin/main");
    });

    it("should fallback to origin/master if it exists (Step 3)", () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd === "git symbolic-ref refs/remotes/origin/HEAD") {
          throw new Error("Command failed");
        }
        if (cmd === "git rev-parse --verify origin/main") {
          throw new Error("Command failed");
        }
        if (cmd === "git rev-parse --verify origin/master") {
          return "" as unknown as ReturnType<typeof execSync>;
        }
        throw new Error("Command failed");
      });
      expect(getDefaultRemoteBranch("/repo/root")).toBe("origin/master");
    });

    it("should fallback to upstream branch (Step 4)", () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd === "git symbolic-ref refs/remotes/origin/HEAD") {
          throw new Error("Command failed");
        }
        if (cmd === "git rev-parse --verify origin/main") {
          throw new Error("Command failed");
        }
        if (cmd === "git rev-parse --verify origin/master") {
          throw new Error("Command failed");
        }
        if (cmd === "git rev-parse --abbrev-ref --symbolic-full-name @{u}") {
          return "origin/feature-branch\n" as unknown as ReturnType<
            typeof execSync
          >;
        }
        throw new Error("Command failed");
      });
      expect(getDefaultRemoteBranch("/repo/root")).toBe(
        "origin/feature-branch",
      );
    });

    it("should fallback to current branch name (Step 5)", () => {
      vi.mocked(execSync).mockImplementation((cmd) => {
        if (cmd === "git symbolic-ref refs/remotes/origin/HEAD") {
          throw new Error("Command failed");
        }
        if (cmd === "git rev-parse --verify origin/main") {
          throw new Error("Command failed");
        }
        if (cmd === "git rev-parse --verify origin/master") {
          throw new Error("Command failed");
        }
        if (cmd === "git rev-parse --abbrev-ref --symbolic-full-name @{u}") {
          throw new Error("Command failed");
        }
        if (cmd === "git rev-parse --abbrev-ref HEAD") {
          return "main\n" as unknown as ReturnType<typeof execSync>;
        }
        throw new Error("Command failed");
      });
      expect(getDefaultRemoteBranch("/repo/root")).toBe("main");
    });

    it("should fallback to origin/main if all else fails (Step 6)", () => {
      vi.mocked(execSync).mockImplementation(() => {
        throw new Error("Command failed");
      });
      expect(getDefaultRemoteBranch("/repo/root")).toBe("origin/main");
    });
  });

  describe("hasUncommittedChanges", () => {
    it("should return true if there are changes", () => {
      vi.mocked(execSync).mockReturnValue(
        " M file.ts\n" as unknown as ReturnType<typeof execSync>,
      );
      expect(hasUncommittedChanges("/repo/root")).toBe(true);
    });

    it("should return false if there are no changes", () => {
      vi.mocked(execSync).mockReturnValue(
        "" as unknown as ReturnType<typeof execSync>,
      );
      expect(hasUncommittedChanges("/repo/root")).toBe(false);
    });
  });

  describe("hasNewCommits", () => {
    it("should return true if there are new commits", () => {
      vi.mocked(execSync).mockReturnValue(
        "abc1234 Commit message\n" as unknown as ReturnType<typeof execSync>,
      );
      expect(hasNewCommits("/repo/root", "origin/main")).toBe(true);
    });

    it("should return false if there are no new commits", () => {
      vi.mocked(execSync).mockReturnValue(
        "" as unknown as ReturnType<typeof execSync>,
      );
      expect(hasNewCommits("/repo/root", "origin/main")).toBe(false);
    });
  });
});
