import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { getGitRepoRoot, getDefaultRemoteBranch } from "wave-agent-sdk";

export interface WorktreeSession {
  name: string;
  path: string;
  branch: string;
  repoRoot: string;
  hasUncommittedChanges: boolean;
  hasNewCommits: boolean;
}

export const WORKTREE_DIR = ".wave/worktrees";

/**
 * Create a new git worktree
 * @param name Worktree name
 * @param cwd Current working directory
 * @returns Worktree session details
 */
export function createWorktree(name: string, cwd: string): WorktreeSession {
  const repoRoot = getGitRepoRoot(cwd);
  const worktreePath = path.join(repoRoot, WORKTREE_DIR, name);
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
    // Change directory to repo root before removing worktree to avoid "directory in use" errors
    if (process.cwd().startsWith(session.path)) {
      process.chdir(repoRoot);
    }

    // Remove worktree
    execSync(`git worktree remove --force "${session.path}"`, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Delete branch
    execSync(`git branch -D ${session.branch}`, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error: unknown) {
    console.error(
      `Failed to remove worktree or branch: ${(error as Error).message}`,
    );
  }
}
