/**
 * Worktree session state tracking.
 *
 * The session state is stored per-agent in each session's DI container (see the
 * "WorktreeSession" container slot registered in containerSetup.ts and accessed via
 * AIManager.getWorktreeSession()/setWorktreeSession()). This keeps worktree state
 * isolated per session in stdio multi-agent mode — a process-level singleton would
 * leak state across concurrent sessions (see specs/047-worktree.md FR-042).
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
