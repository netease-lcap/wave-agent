import { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { CRON_DELETE_TOOL_NAME } from "../constants/tools.js";

const CRON_DELETE_DESCRIPTION = "Cancel a scheduled cron job by ID";

const CRON_DELETE_PROMPT = `Cancel a cron job previously scheduled with CronCreate. Removes it from the in-memory session store.`;

export const cronDeleteTool: ToolPlugin = {
  name: CRON_DELETE_TOOL_NAME,
  shouldDefer: true,
  config: {
    type: "function",
    function: {
      name: CRON_DELETE_TOOL_NAME,
      description: CRON_DELETE_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Job ID returned by CronCreate",
          },
        },
        required: ["id"],
      },
    },
  },
  prompt: () => CRON_DELETE_PROMPT,
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const { id } = args as { id: string };

    if (!context.cronManager) {
      return {
        success: false,
        content: "",
        error: "CronManager not available",
      };
    }

    const success = context.cronManager.deleteJob(id);

    return {
      success,
      content: JSON.stringify({ success }, null, 2),
      shortResult: success ? `Deleted job ${id}` : `Job ${id} not found`,
      error: success ? undefined : `Job ${id} not found`,
    };
  },
};
