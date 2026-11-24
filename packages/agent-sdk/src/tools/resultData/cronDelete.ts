/**
 * `CronDelete` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 形状与文本都照 CC：`ScheduleCronTool/CronDeleteTool.ts:27-33` 的 outputSchema、
 * `:86-92` 的 `mapToolResultToToolResultBlockParam`。要点：
 *
 * - `data` 只有 `id`，正文就是一句 `Cancelled job <id>.`。
 * - 「这个 id 不存在」在 CC 里是 `validateInput` 的拒绝（`:61-70`，`No scheduled job
 *   with id '<id>'`），不产出 `data`；我方对应 `success: false` + `error`，同样不带
 *   失败载荷。
 */
export interface CronDeleteResultData {
  id: string;
}

export function renderCronDeleteResultData(data: CronDeleteResultData): string {
  return `Cancelled job ${data.id}.`;
}
