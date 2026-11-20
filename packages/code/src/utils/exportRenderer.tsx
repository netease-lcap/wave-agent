import React from "react";
import type { Message } from "wave-agent-sdk";
import { MessageBlockItem } from "../components/MessageBlockItem.js";
import { renderToPlainText } from "./staticRender.js";

/**
 * `/export` 的正文渲染：把消息流按**终端里看到的样子**写成纯文本。
 *
 * 规则照 Claude Code 的 `renderMessagesToPlainText`——它不另写一套文本格式，
 * 而是把 CLI 自己的消息组件渲染成 ANSI 再剥掉转义序列。所以这里渲染的是
 * `MessageBlockItem`（与屏幕上同一份组件），导出内容不会与界面分叉：
 * 用户提示、助手的 Markdown、工具调用的点线结构、错误行都原样落进 `.txt`。
 *
 * 两条与屏幕**故意**不同的地方：
 *
 * - 每条消息都按展开态渲染（`isExpanded`）。折叠态只给最后 5 行工具结果、
 *   只显示 `compactParams` 摘要，导出要的是完整内容。
 * - 不渲染欢迎横幅，也不按 `MAX_MESSAGES_COLLAPSED` 截断——消息列表会隐藏
 *   30 条以前的内容，导出必须整条线程都在。
 *
 * `isMeta` 消息与屏幕上一致地跳过（它们是系统内部消息，界面上从不显示）。
 */
export async function renderTranscriptPlainText(
  messages: readonly Message[],
  columns?: number,
): Promise<string> {
  const visibleMessages = messages.filter((message) => !message.isMeta);

  const tree = (
    <>
      {visibleMessages.flatMap((message) =>
        message.blocks.map((block, blockIndex) => (
          <MessageBlockItem
            // 转录里的消息 id 唯一，块下标在消息内唯一，够当 key。
            key={`${message.id}-${blockIndex}`}
            block={block}
            message={message}
            isExpanded
            paddingTop={1}
          />
        )),
      )}
    </>
  );

  // 末尾统一收成恰好一个换行：`MessageBlockItem` 每块自带一个上边距，渲染出来
  // 会多出前后空行，`.txt` 里读起来像空白页。
  return `${(await renderToPlainText(tree, columns)).replace(/^\n+/, "").trimEnd()}\n`;
}
