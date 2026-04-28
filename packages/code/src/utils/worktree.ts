import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { getDefaultRemoteBranch, getGitMainRepoRoot } from "wave-agent-sdk";

export interface WorktreeSession {
  name: string;
  path: string;
  branch: string;
  repoRoot: string;
  hasUncommittedChanges: boolean;
  hasNewCommits: boolean;
  isNew: boolean;
}

/**
 * Create a new git worktree
 * @param name Worktree name
 * @param cwd Current working directory
 * @returns Worktree session details
 */
export function createWorktree(name: string, cwd: string): WorktreeSession {
  const repoRoot = getGitMainRepoRoot(cwd);
  const worktreePath = path.join(repoRoot, ".wave", "worktrees", name);
  const branchName = `worktree-${name}`;
  const baseBranch = getDefaultRemoteBranch(cwd);

  // Ensure parent directory exists
  const parentDir = path.dirname(worktreePath);
  if (!fs.existsSync(parentDir)) {
    fs.mkdirSync(parentDir, { recursive: true });
  }

  // Check if worktree already exists
  if (fs.existsSync(worktreePath)) {
    // If it exists, we assume it's already set up correctly
    return {
      name,
      path: worktreePath,
      branch: branchName,
      repoRoot,
      hasUncommittedChanges: false,
      hasNewCommits: false,
      isNew: false,
    };
  }

  try {
    // Create worktree and branch
    execSync(
      `git worktree add -b ${branchName} "${worktreePath}" ${baseBranch}`,
      {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    return {
      name,
      path: worktreePath,
      branch: branchName,
      repoRoot,
      hasUncommittedChanges: false,
      hasNewCommits: false,
      isNew: true,
    };
  } catch (error: unknown) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() || "";
    if (stderr.includes("already exists")) {
      // If branch already exists, try to add worktree without -b
      try {
        execSync(`git worktree add "${worktreePath}" ${branchName}`, {
          cwd: repoRoot,
          stdio: ["ignore", "pipe", "pipe"],
        });
        return {
          name,
          path: worktreePath,
          branch: branchName,
          repoRoot,
          hasUncommittedChanges: false,
          hasNewCommits: false,
          isNew: true,
        };
      } catch (innerError: unknown) {
        throw new Error(
          `Failed to add existing worktree branch: ${(innerError as Error).message}`,
        );
      }
    }
    throw new Error(
      `Failed to create worktree: ${(error as Error).message}\n${stderr}`,
    );
  }
}

/**
 * Remove a git worktree and its associated branch
 * @param session Worktree session details
 */
export function removeWorktree(session: WorktreeSession): void {
  const repoRoot = session.repoRoot;

  try {
    // Get current branch in worktree before removing it
    let currentBranch: string | undefined;
    try {
      currentBranch = execSync(`git rev-parse --abbrev-ref HEAD`, {
        cwd: session.path,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // Ignore errors getting current branch
    }

    // Remove worktree
    execSync(`git worktree remove --force "${session.path}"`, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Delete original branch
    try {
      execSync(`git branch -D ${session.branch}`, {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // Ignore errors deleting original branch
    }

    // Delete current branch if it's different and not a protected branch
    if (
      currentBranch &&
      currentBranch !== session.branch &&
      currentBranch !== "HEAD"
    ) {
      const defaultRemoteBranch = getDefaultRemoteBranch(repoRoot);
      const defaultBranchName = defaultRemoteBranch.split("/").pop();

      if (
        currentBranch !== defaultBranchName &&
        currentBranch !== "main" &&
        currentBranch !== "master"
      ) {
        try {
          execSync(`git branch -D ${currentBranch}`, {
            cwd: repoRoot,
            stdio: ["ignore", "pipe", "pipe"],
          });
        } catch {
          // Ignore errors deleting current branch
        }
      }
    }
  } catch (error: unknown) {
    console.error(
      `Failed to remove worktree or branch: ${(error as Error).message}`,
    );
  }
}
