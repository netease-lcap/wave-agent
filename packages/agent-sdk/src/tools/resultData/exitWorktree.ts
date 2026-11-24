/**
 * `ExitWorktree` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`ExitWorktreeTool.ts:47-58` 的 outputSchema、`:271-283`
 * （keep）与 `:299-320`（remove）组 `data`、`:322-328` 的
 * `mapToolResultToToolResultBlockParam`。要点：
 *
 * - 两个分支的正文都是 CC 原句：keep 是 `Exited worktree. Your work is preserved
 *   at <path>[ on branch <branch>]. Session is now back in <originalCwd>.`；
 *   remove 是 `Exited and removed worktree at <path>.[ Discarded N commits and M
 *   uncommitted files.] Session is now back in <originalCwd>.`
 * - `Discarded …` 那句在 CC 里也是从 `discardedCommits` / `discardedFiles` 两个
 *   计数现拼的（`:299-309`），单复数写法逐字照抄。
 * - CC 的 outputSchema 里还有个 `message`（整段正文，渲染器直接回吐）与
 *   `tmuxSessionName`（CC 自己的 tmux 会话）：前者按 issue #3055 的口径不落
 *   `data`（正文由这里现场拼），后者我方没有 tmux 语义。
 * - `removeHook` 是我方扩展：CC 没有 `WorktreeRemove` hook 语义，而删除走没走 hook
 *   决定了正文多一句「hooks 已执行」还是「没配 hook、工作树留在原地」。这句必须能
 *   从 `data` 重建，所以只能留在 `data` 里。
 *
 * 路径语义（这两个路径基准不同，别对调）：
 * - `originalCwd` 是**进工作树那会儿**的 currentWorkdir（会动的那个），也是退出后
 *   会话回到的目录；它不是「会话起点」，会话里 `cd` 过就与起点不同。
 * - `worktreePath` 是被退出的那棵工作树 = 退出前的 currentWorkdir。
 *
 * 失败分支（CC 直接 throw 的那几个：没有活跃会话 / 缺 `action` / 有未提交改动而
 * 未 `discard_changes` / 状态不可验证 / 目录没删掉）**不产 `data`**：按 issue #3055
 * 的口径 6，`data` 不放失败载荷，那几段正文保持原文，折叠块那一行仍由 `error` 给。
 */
export interface ExitWorktreeResultData {
  action: "keep" | "remove";
  /**
   * 退出后会话回到的目录 = 进工作树时的 currentWorkdir（会动的那个）。CC 同名
   * 字段（`:50`）。
   */
  originalCwd: string;
  /** 被退出的工作树绝对路径 = 退出前的 currentWorkdir。CC 同名（`:51`）。 */
  worktreePath: string;
  /** 工作树的分支名。CC 同名（`:52`）。 */
  worktreeBranch?: string;
  /** remove 时被丢弃的未提交文件数。CC 同名（`:54`）。 */
  discardedFiles?: number;
  /** remove 时被丢弃的提交数。CC 同名（`:55`）。 */
  discardedCommits?: number;
  /**
   * 我方扩展：`action: "remove"` 时删除走的哪条路。`"executed"` = 交给
   * `WorktreeRemove` hook；`"missing"` = hook 工作树但没配 hook，目录留在原地；
   * 省略 = git 删除（`removeWorktree`）。`action: "keep"` 时恒省略。
   */
  removeHook?: "executed" | "missing";
}

export function renderExitWorktreeResultData(
  data: ExitWorktreeResultData,
): string {
  if (data.action === "keep") {
    const branchInfo = data.worktreeBranch
      ? ` on branch ${data.worktreeBranch}`
      : "";
    return `Exited worktree. Your work is preserved at ${data.worktreePath}${branchInfo}. Session is now back in ${data.originalCwd}.`;
  }

  // CC 的 discard 句子顺序：先 commits，再 uncommitted files（`:299-309`）。
  const discardParts: string[] = [];
  if ((data.discardedCommits ?? 0) > 0) {
    discardParts.push(
      `${data.discardedCommits} ${data.discardedCommits === 1 ? "commit" : "commits"}`,
    );
  }
  if ((data.discardedFiles ?? 0) > 0) {
    discardParts.push(
      `${data.discardedFiles} uncommitted ${data.discardedFiles === 1 ? "file" : "files"}`,
    );
  }
  const discardNote =
    discardParts.length > 0 ? ` Discarded ${discardParts.join(" and ")}.` : "";

  const hookNote =
    data.removeHook === "executed"
      ? " WorktreeRemove hooks were executed."
      : data.removeHook === "missing"
        ? " No WorktreeRemove hook configured, hook-based worktree left at the path above."
        : "";

  return `Exited and removed worktree at ${data.worktreePath}.${discardNote} Session is now back in ${data.originalCwd}.${hookNote}`;
}

/**
 * `ExitWorktree` 的 `data` 形状（JSON Schema）。
 *
 * 用途只有一个：供 REPL 把工具签名渲染成真实返回类型（spec
 * core/repl-tool.md「公告分档呈现」），模型据此直接写 `const r = await
 * ExitWorktree(...); r.originalCwd`，不用先探一次。与
 * {@link ExitWorktreeResultData} 逐字段对应，改一处必须改另一处。
 */
export const exitWorktreeOutputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["keep", "remove"],
      description:
        'Which exit ran: the worktree was left on disk ("keep") or deleted ("remove").',
    },
    originalCwd: {
      type: "string",
      description: "Directory the session returned to.",
    },
    worktreePath: {
      type: "string",
      description: "Absolute path of the worktree that was exited.",
    },
    worktreeBranch: {
      type: "string",
      description: "Branch of the exited worktree; omitted when it had none.",
    },
    discardedFiles: {
      type: "number",
      description:
        'Uncommitted files discarded; only present for action "remove".',
    },
    discardedCommits: {
      type: "number",
      description: 'Commits discarded; only present for action "remove".',
    },
    removeHook: {
      type: "string",
      enum: ["executed", "missing"],
      description:
        '"executed" when a WorktreeRemove hook deleted the worktree, "missing" when a hook-based worktree had no hook and was left on disk; omitted for plain git removal and for action "keep".',
    },
  },
  required: ["action", "originalCwd", "worktreePath"],
  additionalProperties: false,
};
