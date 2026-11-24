import { MOD_LIMITS } from "../types/mods.js";
import { toolResponsePayload } from "../utils/toolResponse.js";

/**
 * 派给 mod 的文本按同一份限额截断（spec「影子事件」）。
 *
 * 两个调用点：`classic.PostToolUse` 的 `tool_response`、
 * `classic.MessageDisplay` 的 `delta`。一个 Bash 的完整输出不该整份塞进每个插件
 * 的钩子里 —— 限额与 `$.ui.log` 是同一个数（`MOD_LIMITS.statusChars`）。
 *
 * 截断留一个省略号：插件据此知道「这不是全文」，不会把半句话当成结果。
 */
export function truncateForModEvent(text: string): string {
  return text.length > MOD_LIMITS.statusChars
    ? `${text.slice(0, MOD_LIMITS.statusChars)}…`
    : text;
}

/**
 * `classic.PostToolBatch` 每一项的 `tool_response`（CC 的 `data`，见
 * `utils/toolResponse.ts`），外加**对象也得受同一份体积预算管**。
 *
 * 原来这里收的是截断后的文本，所以限额是免费的；改成对象之后，一个 `Read` 的
 * `data` 可以带着整份正文、一个 MCP 结果还带 base64 图片，而影子事件是要跨沙箱
 * 边界递到每个插件里的。取舍按「先量、超了就退回文本」：
 *
 * 1. 先 `JSON.stringify` 量长度（`MOD_LIMITS.statusChars`，与 `$.ui.log` 同一个
 *    数）。这一步是对象的一份完整拷贝，成本与结果大小成正比 —— 只在真有插件时
 *    才走（调用点先查 `ModManager` 在不在），可以接受。
 * 2. 量得下就原样给，插件读的是结构化字段，不是一段字符串。
 * 3. 量不下（或根本序列化不了，比如有循环引用）就退回截断文本：与改动前完全
 *    一样的那份兜底，插件至少拿得到内容，也知道这不是全文。
 */
export function toolResponseForModEvent(
  data: unknown,
  fallbackText: string,
): unknown {
  const payload = toolResponsePayload(data, fallbackText);
  if (typeof payload === "string") return truncateForModEvent(payload);
  // 标量（数字 / 布尔 / null）：JSON 形态一定在限额内，不用量。
  if (typeof payload !== "object" || payload === null) return payload;
  try {
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) return truncateForModEvent(fallbackText);
    return serialized.length > MOD_LIMITS.statusChars
      ? truncateForModEvent(fallbackText)
      : payload;
  } catch {
    return truncateForModEvent(fallbackText);
  }
}
