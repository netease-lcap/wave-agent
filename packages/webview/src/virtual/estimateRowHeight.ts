/**
 * 行的初始高度估算——内容感知，而不是「所有行都按同一个平均值猜」。
 *
 * 虚拟列表只有 mounted 的那几十行有真实高度，其余全靠估算。猜错不会算错（每一行
 * 一挂载就按真实高度纠正），但会决定首屏的观感：估得太矮，滚到一半时总高不停往上
 * 涨、滚动条一直缩；估得高，反过来一路塌。同一段对话里一行题注和一段 60 行代码差
 * 着 20 倍，用同一个数字猜，两头都差得远。
 *
 * 数字是按本项目 Message 的字号/行高/折叠默认态定的粗估（CC 的 `sizeHint` 是同一
 * 个位置的东西：宿主按行内容给提示，测量值是权威）。改排版就顺手改这里——它只影响
 * 未挂载行的估算，不影响任何已挂载行的渲染。
 */
import type { Message as MessageType } from "wave-agent-sdk/types";

/** 一行短文本加上下留白。 */
const BASE_HEIGHT = 34;
const LINE_HEIGHT = 22;
/** 800px 列宽下正文一行的字符数（中文按两格算，见 visualLength）。 */
const CHARS_PER_LINE = 62;
/**
 * 代码围栏的行高：代码块是 12px/18px（`.markdown-code` 那一套），比正文的
 * 14px/22px 矮一档，而且一行就是一行的像素——不按正文的 62 字折行去猜。按正文
 * 猜会让一段 60 行代码矮掉四成，底部滚条跟着短一截（实测 694 vs 1158）。
 */
const CODE_LINE_HEIGHT = 18;
/** 代码块自己的上下内边距。 */
const CODE_BLOCK_PADDING = 8;
/** ``` 或 ~~~ 起头的围栏行。 */
const FENCE_LINE = /^\s*(?:```|~~~)/;
/** 块与块之间的间距。 */
const BLOCK_GAP = 6;
/** 折叠态块的固定高度：推理块、压缩摘要、工具头。 */
const REASONING_HEIGHT = 34;
const COMPACT_HEIGHT = 44;
const TOOL_HEIGHT = 64;
const ERROR_HEIGHT = 60;
const IMAGE_HEIGHT = 220;
const TASK_NOTIFICATION_HEIGHT = 40;
/** 单行估算的上限：超过它的内容一律等高到挂载后测。 */
const MAX_ESTIMATE = 1200;

/** 中文/全角按两格算，ASCII 一格。 */
function visualLength(text: string): number {
  let length = 0;
  for (const char of text) {
    length += char.codePointAt(0)! > 0x2e80 ? 2 : 1;
  }
  return length;
}

function textHeight(content: string): number {
  // 围栏内按行数、围栏外按字符折行：两类文字不是同一套排版。
  let proseLength = 0;
  let codeLines = 0;
  let codeBlocks = 0;
  let inFence = false;
  for (const line of content.split("\n")) {
    if (FENCE_LINE.test(line)) {
      if (!inFence) codeBlocks += 1;
      inFence = !inFence;
      continue;
    }
    if (inFence) codeLines += 1;
    else proseLength += visualLength(line);
  }
  const proseLines = Math.ceil(proseLength / CHARS_PER_LINE);
  return (
    proseLines * LINE_HEIGHT +
    codeBlocks * CODE_BLOCK_PADDING +
    codeLines * CODE_LINE_HEIGHT
  );
}

export function estimateRowHeight(message: MessageType): number {
  const blocks = message.blocks;
  if (!blocks || blocks.length === 0) return BASE_HEIGHT;

  let height = BASE_HEIGHT;
  let counted = 0;
  for (const block of blocks) {
    switch (block.type) {
      case "text": {
        const content = block.content || "";
        if (!content.trim()) continue;
        height += textHeight(content);
        break;
      }
      case "reasoning":
        height += REASONING_HEIGHT;
        break;
      case "compact":
        height += COMPACT_HEIGHT;
        break;
      case "tool":
        height += TOOL_HEIGHT;
        break;
      case "error":
        height += ERROR_HEIGHT;
        break;
      case "image":
        height += IMAGE_HEIGHT;
        break;
      case "task_notification":
        height += TASK_NOTIFICATION_HEIGHT;
        break;
      default:
        // 没见过的块：按一段文本的保守值算，挂载后马上被实测纠正。
        height += textHeight(JSON.stringify(block));
    }
    counted += 1;
  }
  if (counted > 1) height += (counted - 1) * BLOCK_GAP;
  return Math.min(MAX_ESTIMATE, Math.max(BASE_HEIGHT, height));
}
