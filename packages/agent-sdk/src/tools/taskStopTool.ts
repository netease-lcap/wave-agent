import { TASK_STOP_TOOL_NAME } from "../constants/tools.js";
import { ToolContext, ToolPlugin, ToolResult } from "./types.js";
import {
  renderTaskStopResultData,
  type TaskStopResultData,
} from "./resultData/taskStop.js";

export const taskStopTool: ToolPlugin = {
  name: TASK_STOP_TOOL_NAME,
  defer: true,
  searchHint: "stop a running background task by its id",
  config: {
    type: "function",
    function: {
      name: TASK_STOP_TOOL_NAME,
      description: "Stop a running background task by ID",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "The ID of the background task to stop",
          },
        },
        required: ["task_id"],
      },
    },
  },
  prompt: () => `
- Stops a running background task by its ID
- Takes a task_id parameter identifying the task to stop
- Returns a success or failure status
- Use this tool when you need to terminate a long-running task
`,
  leanPrompt: `Stops a running background task by its \`task_id\`.`,
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const taskId = args.task_id as string;

    if (!taskId || typeof taskId !== "string") {
      return {
        success: false,
        content: "",
        error: "task_id parameter is required and must be a string",
      };
    }

    const backgroundTaskManager = context?.backgroundTaskManager;
    if (!backgroundTaskManager) {
      return {
        success: false,
        content: "",
        error: "Background task manager not available",
      };
    }

    // 先取任务再停：`stopTask` 把同一个对象就地改成 `killed`，而 `data` 要的是
    // 停下那一刻之前的命令行 / description（CC 的 `tasks/stopTask.ts` 也是先
    // kill、再把这两样回填进 output）。
    const task = backgroundTaskManager.getTask(taskId);
    if (!task) {
      return {
        success: false,
        content: "",
        error: `Task with ID ${taskId} not found`,
      };
    }

    if (!backgroundTaskManager.stopTask(taskId)) {
      return {
        success: false,
        content: "",
        error: `Failed to stop task ${taskId} (status: ${task.status})`,
      };
    }

    // shell 任务报命令行，subagent / workflow 报 description —— 与 CC
    // `tasks/stopTask.ts` 的 `isLocalShellTask(task) ? task.command : task.description`
    // 同一判据。
    const command = task.type === "shell" ? task.command : task.description;
    const data: TaskStopResultData = {
      message: `Successfully stopped task: ${taskId} (${command})`,
      task_id: taskId,
      task_type: task.type,
      command,
    };

    return {
      success: true,
      data,
      content: renderTaskStopResultData(data),
      shortResult: `Stopped ${taskId}`,
    };
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    return params.task_id as string;
  },
};
