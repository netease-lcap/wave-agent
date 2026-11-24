import type { TaskStatus } from "../../types/tasks.js";

/**
 * `TaskList` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`TaskListTool/TaskListTool.ts:16-28` 的 outputSchema、
 * `:91-115` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - 每行是 `#id [status] subject (owner) [blocked by #1, #2]`：`owner` 与
 *   `blockedBy` 两段都是可选后缀，为空就整段不出现。
 * - `blockedBy` 在工具里就已经剔掉了已完成的前置项（CC `:72-83`），所以
 *   `data` 里存的是「还卡着它的」那几个 id，渲染器不再二次过滤。
 * - 什么都不剩时不是空串，而是固定的一句 `No tasks found`。
 */
export interface TaskListResultData {
  tasks: Array<{
    id: string;
    subject: string;
    status: TaskStatus;
    /** 有主的任务才带，渲染成 ` (owner)`。 */
    owner?: string;
    /** 已剔除已完成的前置任务。 */
    blockedBy: string[];
  }>;
}

export function renderTaskListResultData(data: TaskListResultData): string {
  if (data.tasks.length === 0) {
    return "No tasks found";
  }

  return data.tasks
    .map((task) => {
      const owner = task.owner ? ` (${task.owner})` : "";
      const blocked =
        task.blockedBy.length > 0
          ? ` [blocked by ${task.blockedBy.map((id) => `#${id}`).join(", ")}]`
          : "";
      return `#${task.id} [${task.status}] ${task.subject}${owner}${blocked}`;
    })
    .join("\n");
}
