import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  getDefaultRemoteBranch,
  getGitMainRepoRoot,
  performPostCreationSetup,
} from "wave-agent-sdk";
import { logger } from "./logger.js";

// Never use execFileSync here: the shared `wave --stdio` process handles all
// desktop sessions, so a synchronous git call (especially a multi-second
// recursive worktree delete or a network fetch) freezes every session.
const execFileAsync = promisify(execFile);

export interface WorktreeSession {
  name: string;
  path: string;
  branch: string;
  repoRoot: string;
  hasUncommittedChanges: boolean;
  hasNewCommits: boolean;
  isNew: boolean;
}

// --- Worktree name validation ------------------------------------------------

const VALID_WORKTREE_SLUG_SEGMENT = /^[a-zA-Z0-9._-]+$/;
const MAX_WORKTREE_SLUG_LENGTH = 64;

/**
 * Validate a worktree name before any side effects. Names are slash-separated
 * slugs: every segment must be non-empty and contain only letters, digits,
 * dots, underscores, and dashes. The total length is capped at 64 characters
 * and "." / ".." segments are rejected (path traversal protection).
 * @throws {Error} When the name is not a valid slug
 */
export function validateWorktreeSlug(name: string): void {
  if (name.length > MAX_WORKTREE_SLUG_LENGTH) {
    throw new Error(
      `Invalid worktree name: "${name}" must be ${MAX_WORKTREE_SLUG_LENGTH} characters or fewer (got ${name.length})`,
    );
  }
  for (const segment of name.split("/")) {
    if (segment === "." || segment === "..") {
      throw new Error(
        `Invalid worktree name: "${name}" must not contain "." or ".." path segments`,
      );
    }
    if (segment.length === 0 || !VALID_WORKTREE_SLUG_SEGMENT.test(segment)) {
      throw new Error(
        `Invalid worktree name: "${name}" each "/"-separated segment must be non-empty and contain only letters, digits, dots, underscores, and dashes`,
      );
    }
  }
}

/**
 * List all worktree paths of the git repository containing `cwd`.
 *
 * Uses `git worktree list --porcelain` (same discovery Claude Code uses for
 * its resume picker). The current worktree is returned first (when `cwd` is
 * inside one), followed by the remaining worktrees alphabetically.
 *
 * @param cwd Directory to run the git command from
 * @returns Array of absolute worktree paths; empty when git is unavailable,
 *   `cwd` is not inside a git repository, or the repo has a single worktree.
 */
export async function listWorktrees(cwd: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["worktree", "list", "--porcelain"],
      { cwd },
    );

    const worktreePaths = stdout
      .split("\n")
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length).normalize("NFC"));

    if (worktreePaths.length <= 1) return worktreePaths;

    // Current worktree first, then alphabetical
    const currentWorktree = worktreePaths.find(
      (wt) => cwd === wt || cwd.startsWith(wt + path.sep),
    );
    const otherWorktrees = worktreePaths
      .filter((wt) => wt !== currentWorktree)
      .sort((a, b) => a.localeCompare(b));

    return currentWorktree
      ? [currentWorktree, ...otherWorktrees]
      : otherWorktrees;
  } catch {
    // Not a git repository, git unavailable, or command failed
    return [];
  }
}

/**
 * Create a new git worktree
 * @param name Worktree name
 * @param cwd Current working directory
 * @param options Optional creation options
 * @param options.baseRef "fresh" (default, origin/<default-branch>) | "head" (local HEAD)
 * @param options.baseBranch Explicit base branch (overrides baseRef)
 * @returns Worktree session details
 */
export async function createWorktree(
  name: string,
  cwd: string,
  options?: { baseRef?: "fresh" | "head"; baseBranch?: string },
): Promise<WorktreeSession> {
  validateWorktreeSlug(name);
  const session = await createWorktreeInternal(name, cwd, options);
  if (session.isNew) {
    await performPostCreationSetup(session.path, session.repoRoot);
  }
  return session;
}

async function createWorktreeInternal(
  name: string,
  cwd: string,
  options?: { baseRef?: "fresh" | "head"; baseBranch?: string },
): Promise<WorktreeSession> {
  const repoRoot = getGitMainRepoRoot(cwd);
  const worktreePath = path.join(repoRoot, ".wave", "worktrees", name);
  const branchName = `worktree-${name}`;
  const useHead = options?.baseRef === "head";
  const resolvedBaseBranch =
    options?.baseBranch ?? (useHead ? "HEAD" : getDefaultRemoteBranch(cwd));

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
    await execFileAsync(
      "git",
      ["worktree", "add", "-b", branchName, worktreePath, resolvedBaseBranch],
      {
        cwd: repoRoot,
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
    const stderr =
      (error as { stderr?: Buffer | string }).stderr?.toString() || "";
    if (stderr.includes("already exists")) {
      // If branch already exists, try to add worktree without -b
      try {
        await execFileAsync(
          "git",
          ["worktree", "add", worktreePath, branchName],
          {
            cwd: repoRoot,
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
      } catch (innerError: unknown) {
        throw new Error(
          `Failed to add existing worktree branch: ${(innerError as Error).message}`,
        );
      }
    }
    if (
      !useHead &&
      (stderr.includes("not a valid object name") ||
        stderr.includes("unknown revision"))
    ) {
      // Base branch not fetched yet — try fetching then retrying
      const branchNameOnly = resolvedBaseBranch.split("/").pop()!;
      try {
        await execFileAsync("git", ["fetch", "origin", branchNameOnly], {
          cwd: repoRoot,
        });
        await execFileAsync(
          "git",
          [
            "worktree",
            "add",
            "-b",
            branchName,
            worktreePath,
            resolvedBaseBranch,
          ],
          {
            cwd: repoRoot,
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
      } catch {
        // Fetch or retry failed — fall back to HEAD
        try {
          await execFileAsync(
            "git",
            ["worktree", "add", "-b", branchName, worktreePath, "HEAD"],
            {
              cwd: repoRoot,
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
        } catch {
          throw new Error(
            `Failed to create worktree: ${(error as Error).message}\n${stderr}`,
          );
        }
      }
    }
    throw new Error(
      `Failed to create worktree: ${(error as Error).message}\n${stderr}`,
    );
  }
}

/**
 * On Windows, prefix an absolute path with the extended-length marker (`\\?\`)
 * so recursive removal bypasses the 260-char MAX_PATH limit. POSIX paths are
 * returned unchanged.
 */
function toExtendedLengthPath(worktreePath: string): string {
  if (process.platform !== "win32") {
    return worktreePath;
  }
  const absolute = path.win32.resolve(worktreePath);
  if (absolute.startsWith("\\\\?\\")) {
    return absolute;
  }
  if (absolute.startsWith("\\\\")) {
    // UNC path: \\server\share -> \\?\UNC\server\share
    return `\\\\?\\UNC\\${absolute.slice(2)}`;
  }
  return `\\\\?\\${absolute}`;
}

/**
 * Remove a git worktree and its associated branch
 * @param session Worktree session details
 *
 * Removal is best-effort: `git worktree remove --force` deletes the worktree
 * metadata before the working directory, and on Windows its recursive deletion
 * is MAX_PATH-limited — deep paths (e.g. node_modules) can fail with "Filename
 * too long", leaving an orphan directory. When git fails we fall back to
 * fs.rmSync with an extended-length path (bypasses MAX_PATH) and prune stale
 * metadata. Failures are logged but never block branch deletion.
 */
export async function removeWorktree(session: WorktreeSession): Promise<void> {
  const repoRoot = session.repoRoot;

  // Get current branch in worktree before removing it
  let currentBranch: string | undefined;
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["rev-parse", "--abbrev-ref", "HEAD"],
      {
        cwd: session.path,
        encoding: "utf8",
      },
    );
    currentBranch = stdout.trim();
  } catch {
    // Ignore errors getting current branch
  }

  // Remove worktree
  try {
    await execFileAsync(
      "git",
      ["worktree", "remove", "--force", session.path],
      {
        cwd: repoRoot,
      },
    );
  } catch (error: unknown) {
    logger.warn(
      "git worktree remove failed, falling back to fs.rmSync:",
      error,
    );
    try {
      fs.rmSync(toExtendedLengthPath(session.path), {
        recursive: true,
        force: true,
      });
    } catch (rmError: unknown) {
      logger.error("Failed to remove worktree or branch:", rmError);
    }
    // git removes worktree metadata before the working directory; prune any
    // leftovers in case git failed before deleting them.
    try {
      await execFileAsync("git", ["worktree", "prune"], {
        cwd: repoRoot,
      });
    } catch {
      // Ignore errors pruning stale metadata
    }
  }

  // Delete original branch
  try {
    await execFileAsync("git", ["branch", "-D", session.branch], {
      cwd: repoRoot,
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
        await execFileAsync("git", ["branch", "-D", currentBranch], {
          cwd: repoRoot,
        });
      } catch {
        // Ignore errors deleting current branch
      }
    }
  }
}
