/**
 * 工具结果里「这次调用产出了什么」的那一份载荷，两个消费方共用：
 *
 * - settings 的 PostToolUse 钩子 → stdin 的 `tool_response`；
 * - 插件影子事件 `classic.PostToolBatch` 每项 → `tool_response`。
 *
 * 两边必须是同一份东西，否则同一个调用在两个观察面上说法不同（CC 的
 * PostToolUse 与 PostToolBatch 也都是 `tool_response`，形状一样）。
 *
 * 取数口径照 CC：**`data` 本身**。CC 的 PostToolUse 输入里 `tool_response` 是
 * 工具的 Output 对象（`0172:9982`），官方 hook 示例直接按字段取值
 * —— `jq -r '.tool_response.filePath // .tool_input.file_path'`（`0999:3766`）。
 * 我方 `ToolResult.data` 就是那个对象，`ToolResult` 这层包装（`success` /
 * `shortResult` …）是宿主自己的账，不该漏进契约。
 *
 * 兜底：第三方 `ToolPlugin` 可以不给 `data`。CC 没有这个洞 —— 它的工具
 * `call()` 一定产出 Output，失败直接走 `PostToolUseFailure` 而不是发一条没有
 * `tool_response` 的 PostToolUse —— 所以这里不返回 `undefined`（那会让这个键
 * 静默消失，对插件作者来说和失败长得一模一样），而是给 `{ content }`：
 * `content` 正是 CC 在 MCP 结果里给同一件东西起的名字
 * （`0633:176917-176920` 的 `{ content, ...mcpMeta }`），读
 * `.tool_response.content` 的钩子两边都能跑。
 */
export function toolResponsePayload(
  data: unknown,
  fallbackText: string,
): unknown {
  return data !== undefined ? data : { content: fallbackText };
}
