/**
 * Real-git integration tests for worktreeUtils.
 *
 * Unlike tests/utils/worktreeUtils.test.ts (which mocks child_process and
 * fs), these tests run against a real git repository in a temp directory:
 * worktree creation, branch handling, file independence, change counting and
 * removal are all verified through actual `git worktree` operations.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";

import {
  createWorktree,
  removeWorktree,
  countWorktreeChanges,
} from "../../src/utils/worktreeUtils.js";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString()
    .trim();
}

describe("worktreeUtils with real git", () => {
  let repoRoot: string;

  beforeAll(() => {
    repoRoot = fs.mkdtempSync(path.join(os.tmpdir(), "wave-git-real-"));
    git(repoRoot, ["init", "-b", "main", "-q"]);
    git(repoRoot, ["config", "user.name", "Wave Test"]);
    git(repoRoot, ["config", "user.email", "wave-test@example.com"]);
    fs.writeFileSync(path.join(repoRoot, "file.txt"), "v1\n");
    git(repoRoot, ["add", "."]);
    git(repoRoot, ["commit", "-m", "init", "-q"]);
  });

  afterAll(() => {
    // Remove any leftover worktrees first: git refuses to delete a repo
    // that still has registered worktrees.
    try {
      git(repoRoot, ["worktree", "prune"]);
    } catch {
      // ignore — repo may already be gone
    }
    fs.rmSync(repoRoot, { recursive: true, force: true });
  });

  it("creates a worktree from HEAD with its own branch", () => {
    const info = createWorktree("real-git-test", repoRoot, {
      baseRef: "head",
    });
    try {
      expect(info.isNew).toBe(true);
      expect(info.repoRoot).toBe(repoRoot);
      expect(fs.existsSync(info.path)).toBe(true);

      // The dedicated worktree branch exists in the real repo.
      const branches = git(repoRoot, ["branch", "--list", info.branch]);
      expect(branches).toContain(info.branch);
    } finally {
      removeWorktree(info);
    }
  });

  it("keeps files created in the worktree out of the main repo", () => {
    const info = createWorktree("real-git-isolated", repoRoot, {
      baseRef: "head",
    });
    try {
      fs.writeFileSync(path.join(info.path, "worktree-only.txt"), "hello\n");
      // Untracked file inside the worktree must not leak into the main repo.
      const status = git(repoRoot, ["status", "--porcelain"]);
      expect(status).not.toContain("worktree-only.txt");
    } finally {
      removeWorktree(info);
    }
  });

  it("removes the worktree directory and its branch", () => {
    const info = createWorktree("real-git-remove", repoRoot, {
      baseRef: "head",
    });
    const worktreePath = info.path;
    const branchName = info.branch;
    removeWorktree(info);

    expect(fs.existsSync(worktreePath)).toBe(false);
    const branches = git(repoRoot, ["branch", "--list", branchName]);
    expect(branches).not.toContain(branchName);
  });

  it("creates a worktree from the default remote branch (baseRef fresh)", () => {
    // origin/main is needed for the default "fresh" path — point origin at
    // this same repo and fetch so refs/remotes/origin/main exists.
    git(repoRoot, ["remote", "add", "origin", repoRoot]);
    git(repoRoot, ["fetch", "origin", "-q"]);

    const info = createWorktree("real-git-fresh", repoRoot);
    try {
      expect(info.isNew).toBe(true);
      // Content of the default branch is present in the new worktree.
      expect(fs.existsSync(path.join(info.path, "file.txt"))).toBe(true);
    } finally {
      removeWorktree(info);
      git(repoRoot, ["remote", "remove", "origin"]);
    }
  });

  it("counts commits made inside the worktree since creation", () => {
    const info = createWorktree("real-git-count", repoRoot, {
      baseRef: "head",
    });
    try {
      fs.writeFileSync(path.join(info.path, "changed.txt"), "x\n");
      git(info.path, ["add", "changed.txt"]);
      git(info.path, ["commit", "-m", "worktree change", "-q"]);

      const changes = countWorktreeChanges(info.path, info.originalHeadCommit);
      expect(changes).toEqual({ changedFiles: 0, commits: 1 });
    } finally {
      removeWorktree(info);
    }
  });
});
