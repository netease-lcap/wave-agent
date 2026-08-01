import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";
import * as fs from "node:fs";
import {
  getDefaultRemoteBranch,
  getGitMainRepoRoot,
  performPostCreationSetup,
} from "wave-agent-sdk";

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
 * Remove a git worktree and its associated branch
 * @param session Worktree session details
 */
export async function removeWorktree(session: WorktreeSession): Promise<void> {
  const repoRoot = session.repoRoot;

  try {
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
    await execFileAsync(
      "git",
      ["worktree", "remove", "--force", session.path],
      {
        cwd: repoRoot,
      },
    );

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
  } catch (error: unknown) {
    console.error(
      `Failed to remove worktree or branch: ${(error as Error).message}`,
    );
  }
}
