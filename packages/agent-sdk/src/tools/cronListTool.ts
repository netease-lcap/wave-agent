import { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { CRON_LIST_TOOL_NAME } from "../constants/tools.js";

export const cronListTool: ToolPlugin = {
  name: CRON_LIST_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: CRON_LIST_TOOL_NAME,
      description:
        "List all cron jobs scheduled via CronCreate in this session.",
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  execute: async (
    _args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    if (!context.cronManager) {
      return {
        success: false,
        content: "",
        error: "CronManager not available",
      };
    }

    const jobs = context.cronManager.listJobs();

    return {
      success: true,
      content: JSON.stringify({ jobs }, null, 2),
      shortResult: `Found ${jobs.length} jobs`,
    };
  },
};
