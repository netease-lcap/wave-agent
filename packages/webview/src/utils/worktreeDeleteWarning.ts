/**
 * Describe what deleting a worktree session destroys, for the delete
 * confirmation dialog. Deleting a worktree session removes the worktree
 * directory and its temporary branch and cannot be undone, so the dialog names
 * the uncommitted files and the unmerged commits before the user confirms
 * (spec desktop-sessions.md「删除 worktree 会话前提示将丢失的改动」).
 *
 * Two hosts say this, with **this one file** as the only source of the wording:
 * the desktop sidebar's row menu and — since 2026-10-17 — the remote-control
 * Web page's session list (spec ui/remote-control.md「手机端的会话列表与删除」
 * 场景 7/13, whose carriers differ: 侧栏行菜单 + 居中确认框 vs 整页列表的行「⋯」
 * + 底部动作面板 + 全屏确认卡片). `desktop-sessions.md` is therefore unchanged:
 * the phone reuses its wording rather than restating it.
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
