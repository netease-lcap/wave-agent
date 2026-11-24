import { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { CRON_DELETE_TOOL_NAME } from "../constants/tools.js";
import {
  cronDeleteOutputSchema,
  renderCronDeleteResultData,
  type CronDeleteResultData,
} from "./resultData/cronDelete.js";

const CRON_DELETE_DESCRIPTION = "Cancel a scheduled cron job by ID";

const CRON_DELETE_PROMPT = `Cancel a cron job previously scheduled with CronCreate. Removes it from both the in-memory session store and durable file storage (if applicable).`;

export const cronDeleteTool: ToolPlugin = {
  name: CRON_DELETE_TOOL_NAME,
  defer: true,
  searchHint: "cancel a scheduled cron job by its id",
  outputSchema: cronDeleteOutputSchema,
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
  leanPrompt: `Cancel a cron job previously scheduled with CronCreate, removing it from both the session store and durable storage.`,
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

    const deleted = context.cronManager.deleteJob(id);

    // CC 把「没有这个 id」判在 `validateInput`（`ScheduleCronTool/CronDeleteTool.ts:61-70`），
    // 不产出 data；这里同样只回 error，不带失败载荷。
    if (!deleted) {
      return {
        success: false,
        content: "",
        shortResult: `Job ${id} not found`,
        error: `Job ${id} not found`,
      };
    }

    const data: CronDeleteResultData = { id };

    return {
      success: true,
      data,
      content: renderCronDeleteResultData(data),
      shortResult: `Deleted job ${id}`,
    };
  },
};
