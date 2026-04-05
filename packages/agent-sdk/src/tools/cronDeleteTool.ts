import { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { CRON_DELETE_TOOL_NAME } from "../constants/tools.js";
import { requireString } from "./validation.js";

export const cronDeleteTool: ToolPlugin = {
  name: CRON_DELETE_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: CRON_DELETE_TOOL_NAME,
      description:
        "Cancel a cron job previously scheduled with CronCreate. Removes it from the in-memory session store.",
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
  validate: (args: Record<string, unknown>): ToolResult | null => {
    // Validate id is required and a string
    return requireString(args, "id");
  },
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
