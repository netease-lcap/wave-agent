/**
 * `CronList` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本都照 CC：`ScheduleCronTool/CronListTool.ts:20-33` 的 outputSchema、
 * `:80-94` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - `jobs` 是**每个任务一个对象**（不是只有 id 的数组）；`recurring` / `durable` 只在
 *   「真」时才写，与 CC 的 `...(t.recurring ? { recurring: true } : {})` 一致。
 * - 正文一行一个任务：`<id> — <人话周期> (recurring|one-shot)[ [session-only]]: <prompt
 *   缩略>`；一个任务都没有时是固定句 `No scheduled jobs.`（带句号）。
 * - 与 CC 的唯一形状偏差：CC 在 `data` 里放**完整 prompt**、渲染时才截到 80 列；模型
 *   传进来的正文不落盘，所以这里存的是已经单行化 + 截断好的 `promptPreview`（见
 *   `previewPrompt`），正文与 CC 逐字一致。
 */

/** CC 的 `truncate(j.prompt, 80, true)` 里的 80（`CronListTool.ts:89`）。 */
export const PROMPT_PREVIEW_MAX_WIDTH = 80;

/**
 * 文本宽度。SDK 这边没有 `string-width` 依赖，按**码点**计数（`Array.from` 而不是
 * `.length`，免得把 emoji 切成半个代理对）；CJK 按 1 算，宽度比 CC 的终端列差一倍，
 * 见文件头的偏离说明。
 */
function textWidth(text: string): number {
  return Array.from(text).length;
}

/** CC 的 `truncateToWidth`（`utils/truncate.ts:63-73`）：超宽就留 `maxWidth-1` 再加 `…`。 */
function truncateToWidth(text: string, maxWidth: number): string {
  if (textWidth(text) <= maxWidth) return text;
  if (maxWidth <= 1) return "…";
  return `${Array.from(text)
    .slice(0, maxWidth - 1)
    .join("")}…`;
}

/**
 * CC 的 `truncate(prompt, 80, true)`（`utils/truncate.ts:134-158`）：`singleLine` 把
 * 多行正文压成首行——首行本身就超宽时按宽度截，否则一律补一个 `…` 表示「后面还有」。
 */
export function previewPrompt(
  prompt: string,
  maxWidth: number = PROMPT_PREVIEW_MAX_WIDTH,
): string {
  const firstNewline = prompt.indexOf("\n");
  if (firstNewline !== -1) {
    const firstLine = prompt.substring(0, firstNewline);
    return textWidth(firstLine) + 1 > maxWidth
      ? truncateToWidth(firstLine, maxWidth)
      : `${firstLine}…`;
  }
  return truncateToWidth(prompt, maxWidth);
}

export interface CronListJobData {
  id: string;
  /** 原始 5 段 cron 表达式。 */
  cron: string;
  /** `cronToHuman(cron)` 的人话版本。 */
  humanSchedule: string;
  /** 单行化 + 截断后的 prompt 缩略（CC 存完整 prompt，见文件头）。 */
  promptPreview: string;
  /** 只在为真时出现。 */
  recurring?: boolean;
  /** 只在为 false 时出现（老任务没有这个键），`[session-only]` 标签靠它。 */
  durable?: boolean;
}

export interface CronListResultData {
  jobs: CronListJobData[];
}

export function renderCronListResultData(data: CronListResultData): string {
  if (data.jobs.length === 0) return "No scheduled jobs.";

  return data.jobs
    .map((job) => {
      const kind = job.recurring ? " (recurring)" : " (one-shot)";
      const scope = job.durable === false ? " [session-only]" : "";
      return `${job.id} — ${job.humanSchedule}${kind}${scope}: ${job.promptPreview}`;
    })
    .join("\n");
}
