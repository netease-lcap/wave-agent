/**
 * `CronCreate` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本都照 CC：`ScheduleCronTool/CronCreateTool.ts:45-52` 的 outputSchema、
 * `:143-154` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - 只有四个字段；模型传进来的 `prompt` 不在其中（CC 的 schema 也没有），正文不落盘。
 * - `durable` 在 CC 的 schema 里是 optional，缺省按 session-only 讲——老转录里可能
 *   没有这个键。
 * - 两句正文只差尾句：recurring 说 7 天后自动过期，one-shot 说「打一次就自删」。
 * - CC 的 `where` 写 `.claude/scheduled_tasks.json` / "dies when Claude exits"，我方
 *   换成本仓的 `.wave/` 与 Wave，其余措辞逐字一致。
 */

/**
 * Recurring 任务多少天后自动过期。CC 的 `DEFAULT_MAX_AGE_DAYS`
 * （`ScheduleCronTool/prompt.ts:8-9`）同为 7 天；工具的 prompt 文案与本文件的正文共用
 * 这一份常量，别各自写一个。
 */
export const DEFAULT_MAX_AGE_DAYS = 7;

export interface CronCreateResultData {
  /** 新任务的 id，可直接传给 CronDelete。 */
  id: string;
  /** cron 表达式的人话版本（`cronToHuman(cron)` 的输出）。 */
  humanSchedule: string;
  /** 是否按 cron 反复触发；false = 打一次就自删。 */
  recurring: boolean;
  /** 是否落了 `.wave/scheduled_tasks.json`。CC 里 optional，缺省 = session-only。 */
  durable?: boolean;
}

export function renderCronCreateResultData(data: CronCreateResultData): string {
  const where = data.durable
    ? "Persisted to .wave/scheduled_tasks.json"
    : "Session-only (not written to disk, dies when Wave exits)";

  return data.recurring
    ? `Scheduled recurring job ${data.id} (${data.humanSchedule}). ${where}. Auto-expires after ${DEFAULT_MAX_AGE_DAYS} days. Use CronDelete to cancel sooner.`
    : `Scheduled one-shot task ${data.id} (${data.humanSchedule}). ${where}. It will fire once then auto-delete.`;
}
