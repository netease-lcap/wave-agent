import { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { CRON_CREATE_TOOL_NAME } from "../constants/tools.js";
import { cronToHuman } from "../utils/cronToHuman.js";
import { parseCronExpression } from "../utils/parseCronExpression.js";

const DEFAULT_MAX_AGE_DAYS = 7;
const MAX_JOBS = 50;

const CRON_CREATE_DESCRIPTION = `Schedule a prompt to run at a future time within this Wave session — either recurring on a cron schedule, or once at a specific time.`;

const CRON_CREATE_PROMPT = `Schedule a prompt to be enqueued at a future time. Use for both recurring schedules and one-shot reminders.

Uses standard 5-field cron in the user's local timezone: minute hour day-of-month month day-of-week. "0 9 * * *" means 9am local — no timezone conversion needed.

## One-shot tasks (recurring: false)

For "remind me at X" or "at <time>, do Y" requests — fire once then auto-delete.
Pin minute/hour/day-of-month/month to specific values:
  "remind me at 2:30pm today to check the deploy" → cron: "30 14 <today_dom> <today_month> *", recurring: false
  "tomorrow morning, run the smoke test" → cron: "57 8 <tomorrow_dom> <tomorrow_month> *", recurring: false

## Recurring jobs (recurring: true, the default)

For "every N minutes" / "every hour" / "weekdays at 9am" requests:
  "*/5 * * * *" (every 5 min), "0 * * * *" (hourly), "0 9 * * 1-5" (weekdays at 9am local)

## Avoid the :00 and :30 minute marks when the task allows it

Every user who asks for "9am" gets \`0 9\`, and every user who asks for "hourly" gets \`0 *\` — which means requests from across the planet land on the API at the same instant. When the user's request is approximate, pick a minute that is NOT 0 or 30:
  "every morning around 9" → "57 8 * * *" or "3 9 * * *" (not "0 9 * * *")
  "hourly" → "7 * * * *" (not "0 * * * *")
  "in an hour or so, remind me to..." → pick whatever minute you land on, don't round

Only use minute 0 or 30 when the user names that exact time and clearly means it ("at 9:00 sharp", "at half past", coordinating with a meeting). When in doubt, nudge a few minutes early or late — the user will not notice, and the fleet will.

## Session-only

Jobs live only in this Wave session — nothing is written to disk, and the job is gone when Wave exits.

## Runtime behavior

Jobs only fire while the REPL is idle (not mid-query). The scheduler adds a small deterministic jitter on top of whatever you pick: recurring tasks fire up to 10% of their period late (max 15 min); one-shot tasks landing on :00 or :30 fire up to 90s early. Picking an off-minute is still the bigger lever.

Recurring tasks auto-expire after ${DEFAULT_MAX_AGE_DAYS} days — they fire one final time, then are deleted. This bounds session lifetime. Tell the user about the ${DEFAULT_MAX_AGE_DAYS}-day limit when scheduling recurring jobs.

Returns a job ID you can pass to CronDelete.`;

export const cronCreateTool: ToolPlugin = {
  name: CRON_CREATE_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: CRON_CREATE_TOOL_NAME,
      description: CRON_CREATE_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          cron: {
            type: "string",
            description:
              'Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g. "*/5 * * * *" = every 5 minutes, "30 14 28 2 *" = Feb 28 at 2:30pm local once).',
          },
          prompt: {
            type: "string",
            description: "The prompt to enqueue at each fire time.",
          },
          recurring: {
            type: "boolean",
            description: `true (default) = fire on every cron match until deleted or auto-expired after ${DEFAULT_MAX_AGE_DAYS} days. false = fire once at the next match, then auto-delete. Use false for "remind me at X" one-shot requests with pinned minute/hour/dom/month.`,
            default: true,
          },
        },
        required: ["cron", "prompt"],
      },
    },
  },
  prompt: () => CRON_CREATE_PROMPT,
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

    // Validate cron expression
    if (!parseCronExpression(cron)) {
      return {
        success: false,
        content: "",
        error: `Invalid cron expression '${cron}'. Expected 5 fields: M H DoM Mon DoW.`,
      };
    }

    // Check max jobs limit
    const existingJobs = context.cronManager.listJobs();
    if (existingJobs.length >= MAX_JOBS) {
      return {
        success: false,
        content: "",
        error: `Too many scheduled jobs (max ${MAX_JOBS}). Cancel one first.`,
      };
    }

    try {
      const job = context.cronManager.createJob({
        cron,
        prompt,
        recurring,
      });

      const humanSchedule = cronToHuman(cron);
      const where = "Session-only (not written to disk, dies when Wave exits)";
      const resultMessage = recurring
        ? `Scheduled recurring job ${job.id} (${humanSchedule}). ${where}. Auto-expires after ${DEFAULT_MAX_AGE_DAYS} days. Use CronDelete to cancel sooner.`
        : `Scheduled one-shot task ${job.id} (${humanSchedule}). ${where}. It will fire once then auto-delete.`;

      return {
        success: true,
        content: JSON.stringify(
          { id: job.id, humanSchedule, recurring },
          null,
          2,
        ),
        shortResult: resultMessage,
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
