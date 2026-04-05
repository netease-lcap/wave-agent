import { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { CRON_CREATE_TOOL_NAME } from "../constants/tools.js";
import { requireString } from "./validation.js";

export const cronCreateTool: ToolPlugin = {
  name: CRON_CREATE_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: CRON_CREATE_TOOL_NAME,
      description:
        "Schedule a prompt to be enqueued at a future time. Use for both recurring schedules and one-shot reminders.",
      parameters: {
        type: "object",
        properties: {
          cron: {
            type: "string",
            description:
              'Standard 5-field cron expression in local time: "M H DoM Mon DoW"',
          },
          prompt: {
            type: "string",
            description: "The prompt to enqueue at each fire time",
          },
          recurring: {
            type: "boolean",
            description:
              "Default: true. true = fire on every cron match until deleted or auto-expired after 7 days. false = fire once at the next match, then auto-delete",
            default: true,
          },
        },
        required: ["cron", "prompt"],
      },
    },
  },
  validate: (args: Record<string, unknown>): ToolResult | null => {
    // Validate cron is required and a string
    const cronError = requireString(args, "cron");
    if (cronError) return cronError;

    // Validate prompt is required and a string
    const promptError = requireString(args, "prompt");
    if (promptError) return promptError;

    return null;
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const {
      cron,
      prompt,
      recurring = true,
    } = args as { cron: string; prompt: string; recurring?: boolean };

    if (!context.cronManager) {
      return {
        success: false,
        content: "",
        error: "CronManager not available",
      };
    }

    try {
      const job = context.cronManager.createJob({
        cron,
        prompt,
        recurring,
      });

      return {
        success: true,
        content: JSON.stringify({ id: job.id }, null, 2),
        shortResult: `Scheduled job ${job.id}`,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
