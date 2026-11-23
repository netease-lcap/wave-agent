import type { Message, MessageBlock } from "../types";

/**
 * 哪些消息块会被 Message.renderBlock 包进 `.timeline-row`（带一个时间线圆点）。
 *
 * 判据与 renderBlock 必须同源：`Message` 用它决定给哪一行打「首/末行」标记，
 * `MessageList` 用它数一条消息里有几个圆点（run 只有一个圆点时不画竖线）。
 * 两处各写一份的话，漏改一处就会出现「线画到了不存在的圆点上」这类偏差。
 */
export function isTimelineBlock(block: MessageBlock): boolean {
  switch (block.type) {
    case "text":
      return !!block.content && !!block.content.trim();
    case "reasoning":
      // 与 Message.renderBlock 的 reasoning 分支同源：网关偶发下发一个只含
      // "\n" 的 reasoning_content（模型报了 reasoning_tokens 但没给真实文
      // 本），这种块不渲染，自然也不该占一个时间线圆点。
      return !!block.content && !!block.content.trim();
    case "compact":
    case "tool":
      return true;
    default:
      return false;
  }
}

/** 一条消息里带圆点的块数（与开头注释同义：`.timeline-row` 的个数）。 */
export function countTimelineBlocks(blocks: MessageBlock[]): number {
  let count = 0;
  for (const block of blocks) {
    if (isTimelineBlock(block)) count++;
  }
  return count;
}

/**
 * 第一条 / 最后一条带圆点的块在 blocks 里的下标（没有则两个都是 -1）。
 *
 * `.timeline-row` 不能靠 CSS 的 `:first-child` / `:last-child` 找自己：消息里
 * 还会插入别的兄弟元素（末尾的 `.message-actions` 按钮、非圆点的 error /
 * notice 块、预览弹层），最后一个圆点行一旦不再是 `:last-child`，竖线就丢了
 * 收尾规则（`height: 21px`）而画满整行 —— 「把本轮转到后台」按钮出现时正是
 * 如此：工具在跑时有按钮、跑完了按钮消失，同一条工具行的竖线长度因此变脸。
 */
export function timelineBlockBounds(blocks: MessageBlock[]): {
  first: number;
  last: number;
} {
  let first = -1;
  let last = -1;
  blocks.forEach((block, index) => {
    if (!isTimelineBlock(block)) return;
    if (first === -1) first = index;
    last = index;
  });
  return { first, last };
}

/**
 * 这条消息渲染出来一个节点都没有吗？
 *
 * 判据与 `Message.renderBlock` 必须同源（同理见上面的 `isTimelineBlock`）。
 * 会渲染出东西的只有三类：带圆点的块（`text` / `reasoning` 要 trim 后非空，
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
    if (isTimelineBlock(block)) return false;
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
