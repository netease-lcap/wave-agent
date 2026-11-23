import type { Message, MessageBlock } from "../types";

/**
 * 时间线圆点按「助手回合」出（spec ui/message-rendering-system.md「时间线圆点按
 * 助手回合出现（行级）」）：一条助手消息 = 一个 API 回合 = 一个圆点，块只是这一
 * 回合内部的组成部分，不再各自出点。
 *
 * 判据与 Message.renderBlock 必须同源：`Message` 用它决定给不给消息根节点打
 * `.timeline-message`（圆点与竖线挂在那里），`MessageList` 用它数一条消息有几
 * 个圆点（run 只有一个圆点时收起竖线）。两处各写一份的话，漏改一处就会出现「线
 * 画到了不存在的圆点上」这类偏差。
 */
export function blockRendersContent(block: MessageBlock): boolean {
  switch (block.type) {
    case "text":
    case "reasoning":
      // 网关偶发下发一个只含 "\n" 的 reasoning_content（模型报了 reasoning_tokens
      // 但没给真实文本），这种块不渲染，自然也不该让整条消息多出一个圆点。text
      // 分支同口径。
      return !!block.content && !!block.content.trim();
    case "compact":
    case "tool":
      return true;
    default:
      return false;
  }
}

/**
 * 这条消息在时间线上出一个圆点吗？
 *
 * 只有助手消息出点（用户消息本身就是断点）。以及「一个可渲染内容块都没有」的助手
 * 消息不出点——它与下面 `rendersNothing` 的「空消息」不是一回事：只有 notice 通知
 * 行的消息照常渲染那一行，但不占圆点，也不参与 run 的起止。
 */
export function hasTimelineDot(message: Message): boolean {
  if (message.role !== "assistant") return false;
  return (message.blocks ?? []).some(blockRendersContent);
}

/**
 * 这条消息渲染出来一个节点都没有吗？
 *
 * 判据与 `Message.renderBlock` 必须同源（同理见上面的 `blockRendersContent`）。
 * 会渲染出东西的只有三类：出圆点的块（`text` / `reasoning` 要 trim 后非空，
 * `compact` / `tool` 恒有）、`notice` 通知行，以及助手消息上真带图片地址的
 * `image` 块（没有地址、或挂在用户消息上的图片块 renderImageBlock 直接回
 * null——用户消息的图片走正文里的 `[imageN]` 标签）。`file_history` /
 * `task_notification` 与没见过的块一律渲染不出东西。
 *
 * 只在 `MessageList` 的可见列表过滤里用（`visibleMessages`）。过滤掉即从渲染
 * 入口消失：既不会出 `.message` 外壳（留一个空壳会让时间线收尾规则落空、连线
 * 垂到列表底部，还占底部间距），也不会占虚拟列表的一行。
 */
export function rendersNothing(message: Message): boolean {
  for (const block of message.blocks ?? []) {
    if (blockRendersContent(block)) return false;
    if (block.type === "notice") return false;
    if (
      block.type === "image" &&
      message.role === "assistant" &&
      !!block.imageUrls?.length
    ) {
      return false;
    }
  }
  return true;
}
