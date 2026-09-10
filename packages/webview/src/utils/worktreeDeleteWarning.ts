/**
 * Describe what deleting a worktree session destroys, for the delete
 * confirmation dialog. Deleting a worktree session removes the worktree
 * directory and its temporary branch and cannot be undone, so the dialog names
 * the uncommitted files and the unmerged commits before the user confirms
 * (spec desktop-sessions.md「删除 worktree 会话前提示将丢失的改动」).
 */

export interface WorktreeChanges {
  /** Uncommitted files in the worktree. */
  files: number;
  /** Commits the base branch does not have. */
  commits: number;
}

/**
 * @param changes Counts from the worktree, or `null` when the worktree could
 *   not be inspected (host unreachable, not a repo, already deleted).
 * @returns The dialog description, or `undefined` for a clean worktree — a
 *   clean deletion needs no loss warning.
 */
export function worktreeDeleteWarning(
  changes: WorktreeChanges | null,
): string | undefined {
  if (changes === null) {
    // Unknown is not clean: warn generically rather than silently deleting.
    return "该会话的 worktree 目录与临时分支将一并删除，未提交的改动将丢失。";
  }
  const { files, commits } = changes;
  if (files <= 0 && commits <= 0) return undefined;

  const losses: string[] = [];
  if (files > 0) losses.push(`${files} 个未提交文件`);
  if (commits > 0) losses.push(`临时分支上 ${commits} 个未合并提交`);

  return `该会话的 worktree 目录与临时分支将一并删除：${losses.join("、")}，删除后不可恢复。`;
}

/** Shown while the host is still counting (spec scenario 7). */
export const WORKTREE_DELETE_CHECKING = "正在检查该 worktree 的改动…";
