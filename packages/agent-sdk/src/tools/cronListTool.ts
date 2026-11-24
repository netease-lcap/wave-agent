import { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { CRON_LIST_TOOL_NAME } from "../constants/tools.js";
import { cronToHuman } from "../utils/cronToHuman.js";
import {
  cronListOutputSchema,
  previewPrompt,
  renderCronListResultData,
  type CronListResultData,
} from "./resultData/cronList.js";

const CRON_LIST_DESCRIPTION = "List scheduled cron jobs";

const CRON_LIST_PROMPT = `List all cron jobs scheduled via CronCreate in this session.`;

export const cronListTool: ToolPlugin = {
  name: CRON_LIST_TOOL_NAME,
  defer: true,
  searchHint: "list the scheduled cron jobs and when they next run",
  outputSchema: cronListOutputSchema,
  config: {
    type: "function",
    function: {
      name: CRON_LIST_TOOL_NAME,
      description: CRON_LIST_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {},
      },
    },
  },
  leanPrompt: `List all cron jobs scheduled via CronCreate in this session.`,
  prompt: () => CRON_LIST_PROMPT,
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

    // CC 的正文由 `mapToolResultToToolResultBlockParam` 从 data 现场渲染
    // （`ScheduleCronTool/CronListTool.ts:80-94`）：`recurring` / `durable` 只在真时才
    // 写进 data，`[session-only]` 标签靠 `durable === false`。prompt 不落盘，只留裁好的
    // 缩略（见 resultData/cronList.ts）。
    const data: CronListResultData = {
      jobs: jobs.map((job) => ({
        id: job.id,
        cron: job.cron,
        humanSchedule: cronToHuman(job.cron),
        promptPreview: previewPrompt(job.prompt),
        ...(job.recurring ? { recurring: true } : {}),
        ...(job.durable === false ? { durable: false } : {}),
      })),
    };

    return {
      success: true,
      data,
      content: renderCronListResultData(data),
      shortResult: `Found ${jobs.length} jobs`,
    };
  },
};
