/**
 * `TaskStop` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本照 CC：`TaskStopTool.ts:22-33` 的 outputSchema、`:98-104` 的
 * `mapToolResultToToolResultBlockParam`。要点：
 *
 * - CC 这里**没有散文文本**：它把整个 output 原样 `jsonStringify`（紧凑 JSON、
 *   无缩进）交给模型，所以我们的 `content` 也是一段紧凑 JSON，键序就是 `call()`
 *   里的书写顺序（`TaskStopTool.ts:123-128`）。CC 的 `UI.tsx:23-40` 另有一套
 *   `<command> · stopped` 的渲染，那是终端 UI 的 chrome，不是模型侧文本。
 * - 字段名沿用 CC 的 snake_case（`task_id` / `task_type`），与 Glob/Write 那些
 *   camelCase 的 schema 不同——照抄各自的原样，不做统一。
 * - `command` 是 shell 任务的命令行、其它任务（subagent / workflow）的
 *   description（CC 的 `tasks/stopTask.ts` 同样按 `isLocalShellTask` 二选一）。
 *   它既是 `message` 的组成部分，也是 UI 那行 footer 的唯一来源，所以必须留在
 *   `data` 里——这是本工具唯一一个回传「模型自己传进来的东西」的字段，因为 CC
 *   的文本本身就要把它重述一遍。
 */

export interface TaskStopResultData {
  /** CC 的 `message`：`Successfully stopped task: <id> (<command>)`。 */
  message: string;
  task_id: string;
  /** 被停任务的类型：`shell` / `subagent` / `workflow`。 */
  task_type: string;
  /**
   * shell 任务的命令行，或其它任务的 description。CC 把它标成 optional（老会话
   * 重放时可能缺），缺失时 JSON 里直接不出现这个键——`JSON.stringify` 对
   * `undefined` 的行为与 CC 一致。
   */
  command?: string;
}

/** CC 的模型侧文本就是紧凑 JSON（`utils/slowOperations.ts:180-193`）。 */
export function renderTaskStopResultData(data: TaskStopResultData): string {
  return JSON.stringify(data);
}

/**
 * `TaskStop` 的 `data` 形状（JSON Schema）。
 *
 * 用途只有一个：REPL 把工具签名渲染成真实返回类型（spec core/repl-tool.md「公告
 * 分档呈现」），模型据此直接读 `r.task_id` / `r.task_type`。与
 * {@link TaskStopResultData} 逐字段对应，改一处必须改另一处。
 *
 * 字段名照抄 CC 的 snake_case。`command` 不写进 `required`：`BackgroundTask` 的
 * `command` / `description` 本身都可选（`types/processes.ts:21-22`），老会话重放
 * 时这个键可能整个不出现。`task_type` 的取值是 `BackgroundTaskType` 那个三值联合，
 * 比 interface 上写的 `string` 更窄——以运行时代码实际写入的为准。
 */
export const taskStopOutputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description:
        "Sentence reading `Successfully stopped task: <id> (<command>)`.",
    },
    task_id: {
      type: "string",
      description: "Id of the task that was stopped.",
    },
    task_type: {
      type: "string",
      enum: ["shell", "subagent", "workflow"],
      description: "Kind of background task that was stopped.",
    },
    command: {
      type: "string",
      description:
        "Command line for a shell task, description for any other kind; may be absent.",
    },
  },
  required: ["message", "task_id", "task_type"],
  additionalProperties: false,
};
