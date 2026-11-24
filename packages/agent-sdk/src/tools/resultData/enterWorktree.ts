/**
 * `EnterWorktree` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`EnterWorktreeTool.ts:42-50` 的 outputSchema、`:112-118` 组
 * `data`、`:120-126` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - 正文就是 CC 那一句：`Created worktree at <path>[ on branch <branch>]. The
 *   session is now working in the worktree. Use ExitWorktree to leave
 *   mid-session, or exit the session to be prompted.`
 * - CC 的 outputSchema 里还有个 `message`，值是**整段正文**（它的渲染器直接回吐这
 *   个字段，`:120-126`）。我方按 issue #3055 的口径不落它：`data` 只放标量，正文
 *   由这里现场拼，否则等于把 `content` 换个字段名又存了一遍。
 * - `createdViaHook` 是我方扩展：CC 没有 `WorktreeCreate` hook 语义，而 hook 建的
 *   工作树要多说一句「hooks 已执行」。这句必须能从 `data` 重建，所以只能留在
 *   `data` 里。
 *
 * 路径语义（这份数据里只有一个路径，别和 `ExitWorktree` 的 `originalCwd` 混）：
 * `worktreePath` 就是会话接下来「会动」的那个 currentWorkdir —— 工具同时把它写成
 * 会话工作根，于是 diff 面板 / 文件树 / `@` 搜索一起跟过去。会话起点
 * （SessionWorkdir）由 `session.originalCwd` 记着，等 `ExitWorktree` 才用得上。
 *
 * 失败分支（CC 直接 throw 的那几个：已有工作树会话 / 名字非法 / hook 失败 / 不是
 * git 仓库）**不产 `data`**：按 issue #3055 的口径 6，`data` 不放失败载荷，那几段
 * 正文保持原文，折叠块那一行仍由 `error` 给。
 */
export interface EnterWorktreeResultData {
  /** 新建工作树的绝对路径 = 进入后的 currentWorkdir（会动的那个）。 */
  worktreePath: string;
  /** 新建的分支名；hook 创建的工作树没有分支名，此处省略。 */
  worktreeBranch?: string;
  /**
   * 我方扩展：工作树由 `WorktreeCreate` hook 创建（git 命令没跑），正文因此多一句
   * 「WorktreeCreate hooks were executed.」
   */
  createdViaHook: boolean;
}

export function renderEnterWorktreeResultData(
  data: EnterWorktreeResultData,
): string {
  const branchInfo = data.worktreeBranch
    ? ` on branch ${data.worktreeBranch}`
    : "";
  const hookNote = data.createdViaHook
    ? " WorktreeCreate hooks were executed."
    : "";
  return `Created worktree at ${data.worktreePath}${branchInfo}. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.${hookNote}`;
}

/**
 * `EnterWorktree` 的 `data` 形状（JSON Schema）。
 *
 * 用途只有一个：供 REPL 把工具签名渲染成真实返回类型（spec
 * core/repl-tool.md「公告分档呈现」），模型据此直接写 `const r = await
 * EnterWorktree(...); r.worktreePath`，不用先探一次。与
 * {@link EnterWorktreeResultData} 逐字段对应，改一处必须改另一处。
 */
export const enterWorktreeOutputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    worktreePath: {
      type: "string",
      description:
        "Absolute path of the new worktree, now the session's working directory.",
    },
    worktreeBranch: {
      type: "string",
      description:
        "Branch created for the worktree; omitted for hook-created worktrees.",
    },
    createdViaHook: {
      type: "boolean",
      description:
        "True when a WorktreeCreate hook created the worktree instead of git.",
    },
  },
  required: ["worktreePath", "createdViaHook"],
  additionalProperties: false,
};
