import { marked } from "marked";
import DOMPurify from "dompurify";
import type { Message, TextBlock } from "../types";

/**
 * 助手消息可以复制走的那部分正文（spec: ui/message-rendering-system.md
 * 「助手消息的复制按钮」场景 4）：
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
 * 助手回复是否还在「往屏幕上写」（复制入口的出现条件，场景 3）。
 *
 * 两层判据，缺一不可：
 *
 * 1. **正文 / 推理块仍在 `streaming`** —— 字还在往屏幕上落；
 * 2. **`turnRunning`：这一轮还没结束**（宿主 `startStreaming` 已到、`endStreaming`
 *    未到）。缺这一层就会出现「模型写完一段话转头去调工具，工具还在流式传输，
 *    复制按钮已经露出来」——前一段文本块早已落定，逐块判定看不见还在跑的回合，
 *    用户这时点复制拿到的是半条回答（claude.ai 桌面端 `CopyAction` 也是按
 *    消息 / 回合是否定型判定，不逐块判）。
 *
 * **不拿工具块自己的 `stage` 当「未完成」**：被中断或转到后台的回合会永久留下
 * `stage: "running"` 的工具块（右上角「把本轮转到后台」正是靠这份残留判定的），
 * 把它也算作「未完成」会让这类消息永远没有复制入口。回合运行态是宿主给的、
 * 会正常收尾的信号，块的 `stage` 不是。
 */
export const isAssistantReplyStreaming = (
  message: Message,
  turnRunning = false,
): boolean =>
  turnRunning ||
  (message.blocks ?? []).some(
    (block) =>
      (block.type === "text" || block.type === "reasoning") &&
      block.stage === "streaming",
  );

/**
 * 复制进剪贴板时同时带上的 `text/html`（场景 10）：同一份 Markdown 的结构化渲染。
 *
 * 结构与纯文本那份**同源**——都从 `assistantCopyText` 出来，所以两份永远描述同一段
 * 内容，不会出现「粘到文档里是另一条消息」。样式一律不进来（不加 `class`、不做语法
 * 高亮）：格式由接收方的编辑器决定，带上我们的样式只会往别人的文档里塞一团外来颜色。
 *
 * 标记里可能出现 `<script>` 之类（模型输出也是不可信输入），所以过一道 DOMPurify；
 * 白名单与消息渲染一致，另加 `<table>` 系与 `<input type="checkbox">`（GFM 任务列表）。
 */
export const markdownToClipboardHtml = (markdown: string): string => {
  if (!markdown.trim()) return "";
  const parsed = marked.parse(markdown, { gfm: true, breaks: true });
  if (typeof parsed !== "string") return "";
  const clean = DOMPurify.sanitize(parsed, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "code",
      "pre",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "a",
      "blockquote",
      "hr",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "del",
      "input",
    ],
    ALLOWED_ATTR: ["href", "title", "align", "type", "checked", "disabled"],
    ALLOW_DATA_ATTR: false,
  });
  return typeof clean === "string" ? clean : "";
};
