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

/**
 * `TaskCreate` 的 `data` 形状（JSON Schema）。
 *
 * 用途只有一个：REPL 把工具签名渲染成真实返回类型（spec core/repl-tool.md「公告
 * 分档呈现」），模型据此直接写 `const r = await TaskCreate(...); r.task.id`。与
 * {@link TaskCreateResultData} 逐字段对应，改一处必须改另一处。
 */
export const taskCreateOutputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    task: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "Task id assigned by the task manager.",
        },
        subject: {
          type: "string",
          description: "Title as passed in by the caller.",
        },
      },
      required: ["id", "subject"],
    },
  },
  required: ["task"],
  additionalProperties: false,
};
