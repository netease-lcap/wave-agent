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
 * Get the common directory of the git repository (handles worktrees)
 * @param cwd Working directory
 * @returns Repository common directory path
 */
export function getGitCommonDir(cwd: string): string {
  try {
    const commonDir = execSync("git rev-parse --git-common-dir", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return path.resolve(cwd, commonDir);
  } catch {
    return getGitRepoRoot(cwd);
  }
}

/**
 * Get the main repository root directory (the first worktree in the list)
 * @param cwd Working directory
 * @returns Main repository root path
 */
export function getGitMainRepoRoot(cwd: string): string {
  try {
    const output = execSync("git worktree list --porcelain", {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const lines = output.split("\n");
    if (lines.length > 0 && lines[0].startsWith("worktree ")) {
      return lines[0].substring("worktree ".length).trim();
    }
    return getGitRepoRoot(cwd);
  } catch {
    return getGitRepoRoot(cwd);
  }
}

/**
 * Resolve the git directory for a repository by walking up from `cwd`.
 * Handles both normal repos (.git is a directory) and worktrees
 * (.git is a file pointing to the main repo's worktree git dir).
 * For worktrees, reads the `commondir` file to find the common git dir.
 * @param cwd Working directory to start searching from
 * @returns Absolute path to the git directory, or null if not found
 */
export function resolveGitDir(cwd: string): string | null {
  let currentPath = path.resolve(cwd);
  while (currentPath !== path.dirname(currentPath)) {
    const gitPath = path.join(currentPath, ".git");
    if (fsSync.existsSync(gitPath)) {
      const stat = fsSync.statSync(gitPath);
      if (stat.isDirectory()) {
        // Normal repo: .git is a directory
        return gitPath;
      }
      // Worktree: .git is a file containing "gitdir: <path>"
      try {
        const content = fsSync.readFileSync(gitPath, "utf8").trim();
        const prefix = "gitdir: ";
        if (content.startsWith(prefix)) {
          const worktreeGitDir = content.substring(prefix.length);
          // Read commondir to find the common git dir
          const commondirPath = path.join(worktreeGitDir, "commondir");
          if (fsSync.existsSync(commondirPath)) {
            const commondirRel = fsSync
              .readFileSync(commondirPath, "utf8")
              .trim();
            return path.resolve(worktreeGitDir, commondirRel);
          }
          // Fallback: resolve ../.. from the worktree git dir
          return path.resolve(worktreeGitDir, "..", "..");
        }
      } catch {
        return null;
      }
    }
    currentPath = path.dirname(currentPath);
  }
  return null;
}

/**
 * Read a symbolic ref file in the git directory.
 * If the file content starts with "ref: ", returns the target ref path.
 * Symbolic refs are never packed in packed-refs, so only loose refs are checked.
 * @param gitDir Absolute path to the git directory
 * @param refPath Relative path to the ref file (e.g., "refs/remotes/origin/HEAD")
 * @returns The symbolic ref target, or null if not a symbolic ref or on error
 */
function readSymref(gitDir: string, refPath: string): string | null {
  try {
    const fullPath = path.join(gitDir, refPath);
    const content = fsSync.readFileSync(fullPath, "utf8").trim();
    if (content.startsWith("ref: ")) {
      return content.substring("ref: ".length);
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if a git ref exists, checking both loose refs and packed-refs.
 * @param gitDir Absolute path to the git directory
 * @param refPath Relative path to the ref (e.g., "refs/remotes/origin/main")
 * @returns True if the ref exists, false otherwise
 */
function refExists(gitDir: string, refPath: string): boolean {
  // 1. Check loose ref
  const loosePath = path.join(gitDir, refPath);
  if (fsSync.existsSync(loosePath)) {
    return true;
  }
  // 2. Check packed-refs
  try {
    const packedRefsPath = path.join(gitDir, "packed-refs");
    const content = fsSync.readFileSync(packedRefsPath, "utf8");
    for (const line of content.split("\n")) {
      // Skip comments and peeled lines
      if (line.startsWith("#") || line.startsWith("^")) {
        continue;
      }
      // Format: <sha> <refPath>
      const parts = line.split(" ");
      if (parts.length >= 2 && parts[1] === refPath) {
        return true;
      }
    }
  } catch {
    // packed-refs doesn't exist or can't be read
  }
  return false;
}

/**
 * Get the default remote branch (e.g., origin/main) using filesystem reads.
 * No subprocess calls — matches Claude Code's approach.
 *
 * Priority:
 * 1. Read refs/remotes/origin/HEAD symref → extract branch name (verify it exists)
 * 2. Check if refs/remotes/origin/main ref exists
 * 3. Check if refs/remotes/origin/master ref exists
 * 4. Hardcoded "main" fallback
 *
 * @param cwd Working directory
 * @returns Default remote branch name
 */
export function getDefaultRemoteBranch(cwd: string): string {
  const gitDir = resolveGitDir(cwd);
  if (!gitDir) {
    return "main";
  }

  // 1. Try reading origin/HEAD symref
  const symref = readSymref(gitDir, "refs/remotes/origin/HEAD");
  if (symref) {
    const branch = symref.replace("refs/remotes/", "");
    // Verify the resolved branch actually exists (origin/HEAD can be stale)
    if (refExists(gitDir, symref)) {
      return branch;
    }
  }

  // 2. Check if origin/main exists
  if (refExists(gitDir, "refs/remotes/origin/main")) {
    return "origin/main";
  }

  // 3. Check if origin/master exists
  if (refExists(gitDir, "refs/remotes/origin/master")) {
    return "origin/master";
  }

  // 4. Hardcoded fallback
  return "main";
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
