/**
 * `TaskUpdate` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`TaskUpdateTool/TaskUpdateTool.ts:69-83` 的 outputSchema、
 * `:364-405` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - 成功时的正文只有两段：`Updated task #<id> <改了哪些字段，逗号分隔>`，以及
 *   状态真的变成 `completed` 时追加的那句「去 TaskList 看下一个」提醒
 *   （CC `:387-394`）。删除走同一条路径（`updatedFields` 就是 `['deleted']`）：
 *   CC `:217-225` 把「删掉了」表达成一次状态变更，文本因此长得像
 *   `Updated task #1 deleted`，而不是另一句「删除了」。
 * - 失败（任务不存在）时正文是 `error`，缺省回落到
 *   `Task #<id> not found`（CC `:373-381`）。我方把这个 `error` 放在 `data` 里
 *   正是 CC 的做法——它的 outputSchema 就有这个字段，失败原因不是异常载荷。
 * - CC 的 `verificationNudgeNeeded`（`:396-398` 的验证子代理提示）我方没有对应
 *   能力，故不放该字段。
 */
export interface TaskUpdateResultData {
  success: boolean;
  taskId: string;
  /** 这次真正改动的字段名，按 CC 的推入顺序。 */
  updatedFields: string[];
  /** 失败原因；成功时缺省。 */
  error?: string;
  /** 状态真的变了才有，`to` 可能是 `deleted`（CC 里也是 string）。 */
  statusChange?: {
    from: string;
    to: string;
  };
}

export function renderTaskUpdateResultData(data: TaskUpdateResultData): string {
  if (!data.success) {
    return data.error || `Task #${data.taskId} not found`;
  }

  let content = `Updated task #${data.taskId} ${data.updatedFields.join(", ")}`;

  // CC 只在 teammate（`getAgentId()` + agent swarms）收尾时追加这句（`:387-391`）；
  // 我方没有 teammate 概念，主 agent 完成一个任务同样需要这个「去看下一个」的
  // 抓手，所以条件收窄到只剩状态变更这一条——信息靠 `statusChange` 就能重建。
  if (data.statusChange?.to === "completed") {
    content +=
      "\n\nTask completed. Call TaskList now to find your next available task or see if your work unblocked others.";
  }

  return content;
}
