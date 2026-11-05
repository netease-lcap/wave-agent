import type { Message, TextBlock } from "../types";

/**
 * 助手消息可以复制走的那部分正文（spec: ui/message-rendering-system.md
 * 「助手消息底部的复制按钮」场景 4）：
 *
 * - 只取文本块，按出现顺序**以空行**拼接：模型连着发几段正文时，拼起来才是
 *   用户眼里「这一条回复」；
 * - 原样返回 Markdown 源码（代码围栏、列表标记、链接语法都不动）。这是刻意的
 *   取舍：贴进 Markdown 编辑器能还原结构，代价是贴进纯文本窗口会带语法符号；
 * - 工具调用与参数、推理过程、通知行、图片块都不在里面 —— 它们不是「回答的
 *   正文」，复制出去只会污染要粘贴的地方；
 * - 全空白的文本块跳过，避免拼出一串空行。
 */
export const assistantCopyText = (message: Message): string =>
  (message.blocks ?? [])
    .filter((block): block is TextBlock => block.type === "text")
    .map((block) => block.content ?? "")
    .filter((content) => content.trim().length > 0)
    .join("\n\n");

/**
 * 助手回复是否还在「往屏幕上写」（底部动作行的出现条件，场景 3）。
 *
 * 只看文本块与推理块的 `stage`，**不看工具块**：被中断的回合会永久留下
 * `stage: "running"` 的工具块（右上角「把本轮转到后台」正是靠这份残留判定的），
 * 把它也算作「未完成」会让这类消息永远没有复制入口。
 */
export const isAssistantReplyStreaming = (message: Message): boolean =>
  (message.blocks ?? []).some(
    (block) =>
      (block.type === "text" || block.type === "reasoning") &&
      block.stage === "streaming",
  );
