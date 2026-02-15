import { TASK_OUTPUT_TOOL_NAME } from "../constants/tools.js";
import { ToolContext, ToolPlugin, ToolResult } from "./types.js";
import { stripAnsiColors } from "../utils/stringUtils.js";

const MAX_OUTPUT_LENGTH = 30000;

export const taskOutputTool: ToolPlugin = {
  name: TASK_OUTPUT_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: TASK_OUTPUT_TOOL_NAME,
      description: "Retrieves output from a running or completed task",
      parameters: {
        type: "object",
        properties: {
          task_id: {
            type: "string",
            description: "The task ID to get output from",
          },
          block: {
            type: "boolean",
            default: true,
            description: "Whether to wait for completion",
          },
          timeout: {
            type: "number",
            minimum: 0,
            maximum: 600000,
            default: 30000,
            description: "Max wait time in ms",
          },
        },
        required: ["task_id"],
      },
    },
  },
  prompt:
    () => `- Retrieves output from a running or completed task (background shell, agent, or remote session)
- Takes a task_id parameter identifying the task
- Returns the task output along with status information
- Use block=true (default) to wait for task completion
- Use block=false for non-blocking check of current status
- Task IDs can be found using the /tasks command
- Works with all task types: background shells, async agents, and remote sessions`,
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const taskId = args.task_id as string;
    const filter = args.filter as string | undefined;
    const block = (args.block as boolean | undefined) ?? true;
    const timeout = (args.timeout as number | undefined) ?? 30000;

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

    const getResult = () => {
      const output = backgroundTaskManager.getOutput(taskId, filter);
      if (!output) return null;

      let content = "";
      if (output.stdout) {
        content += stripAnsiColors(output.stdout);
      }
      if (output.stderr) {
        content += (content ? "\n" : "") + stripAnsiColors(output.stderr);
      }

      const finalContent = content || "No output available";
      const processedContent =
        finalContent.length > MAX_OUTPUT_LENGTH
          ? finalContent.substring(0, MAX_OUTPUT_LENGTH) +
            "\n\n... (output truncated)"
          : finalContent;

      return {
        success: true,
        content: processedContent,
        shortResult: `${taskId}: ${output.status}`,
      };
    };

    if (block) {
      // Polling for completion
      return new Promise((resolve) => {
        let timeoutHandle: NodeJS.Timeout | null = null;
        let isAborted = false;
        const startTime = Date.now();

        const cleanup = () => {
          if (timeoutHandle) {
            clearTimeout(timeoutHandle);
            timeoutHandle = null;
          }
        };

        const onAbort = () => {
          isAborted = true;
          cleanup();
          resolve({
            success: false,
            content: "",
            error: "Task output retrieval was aborted",
          });
        };

        if (context.abortSignal) {
          if (context.abortSignal.aborted) {
            onAbort();
            return;
          }
          context.abortSignal.addEventListener("abort", onAbort, {
            once: true,
          });
        }

        const check = () => {
          if (isAborted) return;

          if (Date.now() - startTime > timeout) {
            if (context.abortSignal) {
              context.abortSignal.removeEventListener("abort", onAbort);
            }
            resolve({
              success: true,
              content: "Retrieval timed out",
              shortResult: `${taskId}: timeout`,
            });
            return;
          }

          const task = backgroundTaskManager.getTask(taskId);
          if (!task) {
            if (context.abortSignal) {
              context.abortSignal.removeEventListener("abort", onAbort);
            }
            resolve({
              success: false,
              content: "",
              error: `Task with ID ${taskId} not found`,
            });
            return;
          }

          if (task.status !== "running") {
            if (context.abortSignal) {
              context.abortSignal.removeEventListener("abort", onAbort);
            }
            const result = getResult();
            resolve(
              result || {
                success: false,
                content: "",
                error: "Task not found",
              },
            );
          } else {
            timeoutHandle = setTimeout(check, 500);
          }
        };
        check();
      });
    }

    const result = getResult();
    if (!result) {
      return {
        success: false,
        content: "",
        error: `Task with ID ${taskId} not found`,
      };
    }

    return result;
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    const taskId = params.task_id as string;
    const block = params.block as boolean;
    return `${taskId}${block ? " (blocking)" : ""}`;
  },
};
