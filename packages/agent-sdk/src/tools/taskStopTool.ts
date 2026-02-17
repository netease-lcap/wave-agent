import { TASK_STOP_TOOL_NAME } from "../constants/tools.js";
import { ToolContext, ToolPlugin, ToolResult } from "./types.js";

export const taskStopTool: ToolPlugin = {
  name: TASK_STOP_TOOL_NAME,
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

    const stopped = backgroundTaskManager.stopTask(taskId);
    if (stopped) {
      return {
        success: true,
        content: `Task ${taskId} has been stopped`,
        shortResult: `Stopped ${taskId}`,
      };
    } else {
      const task = backgroundTaskManager.getTask(taskId);
      if (!task) {
        return {
          success: false,
          content: "",
          error: `Task with ID ${taskId} not found`,
        };
      }
      return {
        success: false,
        content: "",
        error: `Failed to stop task ${taskId} (status: ${task.status})`,
      };
    }
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    return params.task_id as string;
  },
};
