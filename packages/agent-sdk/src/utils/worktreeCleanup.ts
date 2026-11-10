/**
 * Stale ephemeral worktree sweep — aligned with Claude Code's
 * `cleanupStaleAgentWorktrees()` (utils/worktree.ts).
 *
 * Subagent isolation (`isolation: worktree`) creates a throwaway worktree and
 * removes it when the subagent finishes — in-process bookkeeping. Ctrl+C, a
 * crash, or the host killing the process skips it, leaving a full checkout
 * (with its `node_modules`) plus a temporary branch behind, forever. This
 * sweep is the only thing that reclaims those.
 *
 * Four independent gates, and every one of them fails closed (keep the
 * worktree) rather than guessing:
 *
 * 1. **Name** — only `sa-`-prefixed names, i.e. worktrees wave made for
 *    itself. A user's worktree (CLI `-w`, `EnterWorktree`, a desktop session,
 *    a daemon session) is never a candidate, no matter how old or how clean.
 * 2. **Age** — directory mtime older than the retention cutoff. mtime, not
 *    creation time, so touching a worktree keeps it alive.
 * 3. **Clean tree** — `git status --porcelain` must be empty. Unlike Claude
 *    Code we do not pass `-uno`: a subagent's work is often a brand-new file
 *    that was never `git add`ed, and that is exactly what must survive.
 * 4. **Nothing unpushed** — no commit reachable only from this branch.
 *
 * Hook-based worktrees (`WorktreeCreate`) are out of scope: their path is
 * chosen by the hook and may not live under `.wave/worktrees/`, and their
 * removal belongs to `WorktreeRemove`. Worktrees git no longer recognizes are
 * also left alone — `git worktree prune` is what cleans up that bookkeeping.
 */

import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { getGitMainRepoRoot, resolveGitDir } from "./gitUtils.js";
import { logger } from "./globalLogger.js";
import { isPathWithin } from "./worktreePaths.js";
import {
  isEphemeralWorktreeName,
  removeWorktree,
  worktreeBranchName,
} from "./worktreeUtils.js";

const execFileAsync = promisify(execFile);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface StaleWorktreeSweepResult {
  /** Number of worktrees actually gone from disk afterwards */
  removed: number;
  /** Worktrees that could not be removed (kept, logged) */
  errors: number;
}

/**
 * Delete ephemeral worktrees under `<repoRoot>/.wave/worktrees/` that are older
 * than `periodDays`, clean, and hold no unpushed commits.
 *
 * @param workdir The session's workspace root — used both to find the main
 *   repo (a session may itself run inside a worktree) and to skip a worktree
 *   the session is sitting in.
 * @param periodDays Retention period; the caller resolves it from
 *   `cleanupPeriodDays`. `<= 0` sweeps nothing.
 * @param activeWorktreeName Name of the worktree this session was opened in,
 *   if any (`-w` / desktop worktree sessions); never swept.
 */
export async function cleanupStaleEphemeralWorktrees(
  workdir: string,
  periodDays: number,
  activeWorktreeName?: string,
): Promise<StaleWorktreeSweepResult> {
  const result: StaleWorktreeSweepResult = { removed: 0, errors: 0 };

  // `<= 0` matches the session-retention reading of `cleanupPeriodDays: 0`
  // (disabled), which also avoids a cutoff of "now" deleting everything.
  if (periodDays <= 0) return result;

  // `getGitMainRepoRoot` falls back to the cwd when it is not a repo at all,
  // so ask the walking-up probe first to keep the "not a repo" case explicit.
  if (resolveGitDir(workdir) === null) return result;

  const repoRoot = getGitMainRepoRoot(workdir);
  const worktreesDir = path.join(repoRoot, ".wave", "worktrees");

  let entries;
  try {
    entries = await fs.readdir(worktreesDir, { withFileTypes: true });
  } catch {
    // No worktrees directory, or unreadable — nothing to sweep.
    return result;
  }

  const cutoffMs = Date.now() - periodDays * MS_PER_DAY;
  const activeName = activeWorktreeName?.trim();

  for (const entry of entries) {
    // `isDirectory()` is false for symlinks, so a link named like an ephemeral
    // worktree is skipped rather than followed and deleted through.
    if (!entry.isDirectory()) continue;

    const name = entry.name;
    if (!isEphemeralWorktreeName(name)) continue;
    if (activeName !== undefined && name === activeName) continue;

    const worktreePath = path.join(worktreesDir, name);
    // Belt to `activeWorktreeName`'s braces: also skip whatever tree the
    // session is physically sitting in (a host may launch the CLI from inside
    // a worktree without declaring its name).
    if (isPathWithin(workdir, worktreePath)) continue;

    let mtimeMs: number;
    try {
      mtimeMs = (await fs.stat(worktreePath)).mtimeMs;
    } catch {
      continue;
    }
    if (mtimeMs >= cutoffMs) continue;

    if (!(await isCleanAndFullyPushed(worktreePath))) continue;

    try {
      removeWorktree({
        name,
        path: worktreePath,
        branch: worktreeBranchName(name),
        repoRoot,
        isNew: true,
      });
    } catch (error) {
      result.errors++;
      logger.warn(
        `Stale worktree cleanup: failed to remove ${worktreePath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      continue;
    }

    // `removeWorktree` is best-effort by contract (it keeps the branch when the
    // directory survives), so the filesystem — not the call — decides.
    if (existsSync(worktreePath)) {
      result.errors++;
    } else {
      result.removed++;
    }
  }

  if (result.removed > 0) {
    await runGit(repoRoot, ["worktree", "prune"]);
  }

  return result;
}

/**
 * Whether a worktree can be thrown away safely: nothing to lose in the working
 * tree, and nothing in the branch that only exists here.
 */
async function isCleanAndFullyPushed(worktreePath: string): Promise<boolean> {
  // `--no-optional-locks` keeps this sweep from fighting a user's git command
  // over `index.lock`.
  const status = await runGit(worktreePath, [
    "--no-optional-locks",
    "status",
    "--porcelain",
  ]);
  if (status === null || status.trim() !== "") return false;

  // In a repo with no remotes at all this lists HEAD, so such worktrees are
  // never swept — deliberate: "unpushed" cannot be distinguished from
  // "no upstream exists", and the commit may be the subagent's only output.
  const unpushed = await runGit(worktreePath, [
    "rev-list",
    "--max-count=1",
    "HEAD",
    "--not",
    "--remotes",
  ]);
  if (unpushed === null || unpushed.trim() !== "") return false;

  return true;
}

/**
 * Run git and return stdout, or `null` when git failed (not a worktree, git
 * missing, corrupted checkout). Unexecutable git calls are `null`; `""` is
 * only ever returned by a *successful* call with empty output.
 */
async function runGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: "0",
        GIT_ASKPASS: "",
      },
    });
    return stdout;
  } catch {
    return null;
  }
}
