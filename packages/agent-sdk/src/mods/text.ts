import { MOD_LIMITS } from "../types/mods.js";

/**
 * 派给 mod 的文本按同一份限额截断（spec「影子事件」）。
 *
 * 三个调用点：`classic.PostToolUse` 的 `tool_response`、
 * `classic.PostToolBatch` 每一项的 `tool_response`、`classic.MessageDisplay` 的
 * `delta`。一个 Bash 的完整输出不该整份塞进每个插件的钩子里 —— 限额与
 * `$.ui.log` 是同一个数（`MOD_LIMITS.statusChars`）。
 *
 * 截断留一个省略号：插件据此知道「这不是全文」，不会把半句话当成结果。
 */
export function truncateForModEvent(text: string): string {
  return text.length > MOD_LIMITS.statusChars
    ? `${text.slice(0, MOD_LIMITS.statusChars)}…`
    : text;
}
