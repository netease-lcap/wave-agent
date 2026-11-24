import type { TaskStatus } from "../../types/tasks.js";

/**
 * `TaskGet` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`TaskGetTool/TaskGetTool.ts:20-33` 的 outputSchema、
 * `:99-127` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - 「没这个 ID」用 `task: null` 表达，而不是抛错（CC `:78-84`），渲染出来就是
 *   固定的一句 `Task not found`。
 * - `description` 留在 `data` 里：它是正文的一行（CC `:112`），写的是模型给的
 *   任务描述，不是文件全文那类大字段；不放回它就重建不出文本。
 * - `blockedBy` / `blocks` 只在非空时各占一行，前缀分别是 `Blocked by:` /
 *   `Blocks:`，id 写成 `#1, #2`。
 */
export interface TaskGetResultData {
  /** `null` = 这个 ID 下没有任务。 */
  task: {
    id: string;
    subject: string;
    description: string;
    status: TaskStatus;
    blocks: string[];
    blockedBy: string[];
  } | null;
}

export function renderTaskGetResultData(data: TaskGetResultData): string {
  const { task } = data;
  if (!task) {
    return "Task not found";
  }

  const lines = [
    `Task #${task.id}: ${task.subject}`,
    `Status: ${task.status}`,
    `Description: ${task.description}`,
  ];

  if (task.blockedBy.length > 0) {
    lines.push(
      `Blocked by: ${task.blockedBy.map((id) => `#${id}`).join(", ")}`,
    );
  }
  if (task.blocks.length > 0) {
    lines.push(`Blocks: ${task.blocks.map((id) => `#${id}`).join(", ")}`);
  }

  return lines.join("\n");
}
