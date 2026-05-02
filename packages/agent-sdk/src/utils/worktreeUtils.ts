/**
 * Git worktree creation and removal utilities for the SDK.
 * Used by EnterWorktree and ExitWorktree tools.
 */

import { execSync } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import { getGitMainRepoRoot, getDefaultRemoteBranch } from "./gitUtils.js";
import { logger } from "./globalLogger.js";

export interface WorktreeInfo {
  name: string;
  path: string;
  branch: string;
  repoRoot: string;
  isNew: boolean;
  /** HEAD commit of the original branch at creation time, for dirty-check on exit */
  originalHeadCommit?: string;
}

/**
 * Validate a worktree name to prevent path traversal and invalid characters.
 */
export function validateWorktreeName(name: string): void {
  const MAX_LENGTH = 64;
  if (name.length > MAX_LENGTH) {
    throw new Error(
      `Invalid worktree name: must be ${MAX_LENGTH} characters or fewer (got ${name.length})`,
    );
  }
  for (const segment of name.split("/")) {
    if (segment === "." || segment === "..") {
      throw new Error(
        `Invalid worktree name "${name}": must not contain "." or ".." path segments`,
      );
    }
    if (!/^[a-zA-Z0-9._-]+$/.test(segment)) {
      throw new Error(
        `Invalid worktree name "${name}": each "/"-separated segment must be non-empty and contain only letters, digits, dots, underscores, and dashes`,
      );
    }
  }
}

/**
 * Generate a random worktree name.
 */
export function generateWorktreeName(): string {
  const adjectives = [
    "swift",
    "calm",
    "bold",
    "keen",
    "bright",
    "cool",
    "deep",
    "fair",
    "gentle",
    "grand",
  ];
  const nouns = [
    "fox",
    "owl",
    "hawk",
    "wolf",
    "bear",
    "lynx",
    "pike",
    "kite",
    "dove",
    "stag",
  ];
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const num = Math.floor(Math.random() * 900) + 100;
  return `${adj}-${noun}-${num}`;
}

/**
 * Get the current HEAD commit SHA.
 */
export function getHeadCommit(cwd: string): string {
  return execSync(`git -C "${cwd}" rev-parse HEAD`, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

/**
 * Create a git worktree for use during a session.
 */
export function createWorktree(name: string, cwd: string): WorktreeInfo {
  const repoRoot = getGitMainRepoRoot(cwd);
  if (!repoRoot) {
    throw new Error(
      "Cannot create a worktree: not in a git repository. Configure WorktreeCreate and WorktreeRemove hooks in settings.json to use worktree isolation with other VCS systems.",
    );
  }

  // Capture HEAD commit before creating worktree (for dirty-check on exit)
  const originalHeadCommit = getHeadCommit(cwd);

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
    return {
      name,
      path: worktreePath,
      branch: branchName,
      repoRoot,
      isNew: false,
      originalHeadCommit,
    };
  }

  try {
    // Create worktree and branch
    execSync(
      `git worktree add -b ${branchName} "${worktreePath}" ${baseBranch}`,
      {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: "0",
          GIT_ASKPASS: "",
        },
      },
    );

    return {
      name,
      path: worktreePath,
      branch: branchName,
      repoRoot,
      isNew: true,
      originalHeadCommit,
    };
  } catch (error: unknown) {
    const stderr = (error as { stderr?: Buffer }).stderr?.toString() || "";
    if (stderr.includes("already exists")) {
      // Branch exists but worktree doesn't — attach to existing branch
      try {
        execSync(`git worktree add "${worktreePath}" ${branchName}`, {
          cwd: repoRoot,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            ...process.env,
            GIT_TERMINAL_PROMPT: "0",
            GIT_ASKPASS: "",
          },
        });
        return {
          name,
          path: worktreePath,
          branch: branchName,
          repoRoot,
          isNew: true,
          originalHeadCommit,
        };
      } catch (innerError: unknown) {
        throw new Error(
          `Failed to add worktree: ${(innerError as Error).message}`,
        );
      }
    }
    throw new Error(
      `Failed to create worktree: ${(error as Error).message}\n${stderr}`,
    );
  }
}

/**
 * Remove a git worktree and its branch.
 */
export function removeWorktree(info: WorktreeInfo): void {
  const repoRoot = info.repoRoot;

  try {
    // Get current branch in worktree before removing
    let currentBranch: string | undefined;
    try {
      currentBranch = execSync(`git rev-parse --abbrev-ref HEAD`, {
        cwd: info.path,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      // Ignore errors
    }

    // Remove worktree
    execSync(`git worktree remove --force "${info.path}"`, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // Delete worktree branch
    try {
      execSync(`git branch -D ${info.branch}`, {
        cwd: repoRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      // Ignore errors
    }

    // Delete current branch if different and not protected
    if (
      currentBranch &&
      currentBranch !== info.branch &&
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
          // Ignore errors
        }
      }
    }
  } catch (error: unknown) {
    logger.error("Failed to remove worktree or branch:", {
      error: error instanceof Error ? error.message : String(error),
      worktreePath: info.path,
    });
    throw error;
  }
}

/**
 * Count uncommitted files and new commits in a worktree.
 * Returns null if git commands fail (fail-closed).
 */
export function countWorktreeChanges(
  worktreePath: string,
  originalHeadCommit: string | undefined,
): { changedFiles: number; commits: number } | null {
  try {
    const statusOutput = execSync(
      `git -C "${worktreePath}" status --porcelain`,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const changedFiles = statusOutput
      .split("\n")
      .filter((l) => l.trim() !== "").length;

    if (!originalHeadCommit) {
      return null;
    }

    const revListOutput = execSync(
      `git -C "${worktreePath}" rev-list --count ${originalHeadCommit}..HEAD`,
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );
    const commits = parseInt(revListOutput.trim(), 10) || 0;

    return { changedFiles, commits };
  } catch {
    return null;
  }
}
