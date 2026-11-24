/**
 * `TaskCreate` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`TaskCreateTool/TaskCreateTool.ts:36-43` 的 outputSchema、
 * `:130-138` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - CC 只回 `id` + `subject` 两样，我方照抄。`description` / `metadata` 是模型
 *   自己刚传进来的参数，回传等于落盘翻倍，渲染一个都不用。
 * - 文本是一句话，没有换行、没有状态行：创建成功的任务恒为 `pending`。
 */
export interface TaskCreateResultData {
  task: {
    /** 任务管理分配的 id，脚本回填 `TaskUpdate` 时直接用。 */
    id: string;
    /** 模型传进来的标题。 */
    subject: string;
  };
}

export function renderTaskCreateResultData(data: TaskCreateResultData): string {
  return `Task #${data.task.id} created successfully: ${data.task.subject}`;
}
