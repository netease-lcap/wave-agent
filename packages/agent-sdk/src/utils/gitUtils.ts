import * as path from "node:path";
import * as fsSync from "node:fs";
import { execSync } from "node:child_process";

/**
 * Check if a directory is a git repository
 * @param dirPath Directory path
 * @returns "Yes" if it's a git repository, "No" otherwise
 */
export function isGitRepository(dirPath: string): string {
  try {
    // Check if .git directory exists in current directory or any parent directory
    let currentPath = path.resolve(dirPath);
    while (currentPath !== path.dirname(currentPath)) {
      const gitPath = path.join(currentPath, ".git");
      if (fsSync.existsSync(gitPath)) {
        return "Yes";
      }
      currentPath = path.dirname(currentPath);
    }
    return "No";
  } catch {
    return "No";
  }
}

/**
 * Get the root directory of the git repository
 * @param cwd Working directory
 * @returns Repository root path
 */
export function getGitRepoRoot(cwd: string): string {
  try {
    return execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return cwd;
  }
}

/**
 * Get the default remote branch (e.g., origin/main)
 * @param cwd Working directory
 * @returns Default remote branch name
 */
export function getDefaultRemoteBranch(cwd: string): string {
  // 1. Try git symbolic-ref refs/remotes/origin/HEAD
  try {
    const head = execSync("git symbolic-ref refs/remotes/origin/HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return head.replace("refs/remotes/", "");
  } catch {
    // Ignore error and proceed to next step
  }

  // 2. Check if origin/main exists
  try {
    execSync("git rev-parse --verify origin/main", {
      cwd,
      stdio: "ignore",
    });
    return "origin/main";
  } catch {
    // Ignore error and proceed to next step
  }

  // 3. Check if origin/master exists
  try {
    execSync("git rev-parse --verify origin/master", {
      cwd,
      stdio: "ignore",
    });
    return "origin/master";
  } catch {
    // Ignore error and proceed to next step
  }

  // 4. Try to get the current branch's upstream
  try {
    return execSync("git rev-parse --abbrev-ref --symbolic-full-name @{u}", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Ignore error and proceed to next step
  }

  // 5. Try to get the current branch name
  try {
    return execSync("git rev-parse --abbrev-ref HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    // Ignore error and proceed to next step
  }

  // 6. Fallback to origin/main
  return "origin/main";
}

/**
 * Get the main repository root if the current directory is part of a git worktree.
 * @param cwd Working directory
 * @returns Main repository root path if in a worktree, null otherwise
 */
export function getGitProjectRoot(cwd: string): string | null {
  try {
    const toplevel = execSync("git rev-parse --show-toplevel", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const commonDir = execSync("git rev-parse --git-common-dir", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const absoluteToplevel = path.resolve(cwd, toplevel);
    const absoluteCommonDir = path.resolve(cwd, commonDir);
    const mainRepoRoot = path.dirname(absoluteCommonDir);

    if (absoluteToplevel !== mainRepoRoot) {
      // It's a worktree. Map the current path to the main repo.
      const absoluteCwd = path.resolve(cwd);
      const relativePath = path.relative(absoluteToplevel, absoluteCwd);
      return path.resolve(mainRepoRoot, relativePath);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if there are uncommitted changes in the working directory
 * @param cwd Working directory
 * @returns True if there are uncommitted changes
 */
export function hasUncommittedChanges(cwd: string): boolean {
  try {
    const status = execSync("git status --porcelain", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return status.length > 0;
  } catch {
    return false;
  }
}

/**
 * Check if there are new commits in the current branch that are not in the base branch
 * @param cwd Working directory
 * @param baseBranch Base branch name (e.g., origin/main)
 * @returns True if there are new commits
 */
export function hasNewCommits(cwd: string, baseBranch?: string): boolean {
  try {
    const range = baseBranch ? `${baseBranch}..HEAD` : "@{u}..HEAD";
    const log = execSync(`git log ${range} --oneline`, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return log.length > 0;
  } catch {
    return false;
  }
}
