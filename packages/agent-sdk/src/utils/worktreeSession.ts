/**
 * Module-level worktree session state tracking.
 * Analogous to Claude Code's currentWorktreeSession in worktree.ts.
 *
 * Tracks whether the current session entered a worktree via EnterWorktree tool,
 * so ExitWorktree can validate scope and restore the original CWD.
 */

export interface WorktreeSession {
  /** The working directory the session was in before EnterWorktree */
  originalCwd: string;
  /** Path to the worktree directory */
  worktreePath: string;
  /** Git branch name for the worktree */
  worktreeBranch: string;
  /** User-provided or auto-generated worktree name */
  worktreeName: string;
  /** Whether this worktree was newly created (vs resumed existing) */
  isNew: boolean;
  /** The canonical git repo root */
  repoRoot: string;
  /** The HEAD commit of the original branch at worktree creation time */
  originalHeadCommit?: string;
}

let currentWorktreeSession: WorktreeSession | null = null;

export function getCurrentWorktreeSession(): WorktreeSession | null {
  return currentWorktreeSession;
}

export function setCurrentWorktreeSession(
  session: WorktreeSession | null,
): void {
  currentWorktreeSession = session;
}
