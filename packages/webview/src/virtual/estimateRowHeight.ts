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
/**
 * 正文列的默认宽度：`.messages-column` 的 800px 上限减去左右各 16px 内边距。
 * 估算必须按**实际列宽**折行——同一个 62 字/行的常量在手机列（358px）上会把
 * 正文估矮一半，在桌面列（768px）上又估高一倍，两头都会在行第一次被量到时产生
 * 几百 px 的账本跳变（实测手机上 `est 830 → real 1135`）。代价见本文件末尾。
 */
const DEFAULT_TEXT_WIDTH = 768;
/**
 * 一个「视觉字符」占多少 px：正文 13px 字号，中文一个字 13px 记 2 格（见
 * `visualLength`），所以一格 6.5px。CC 那侧是同一个东西（`charsPerLine =
 * 断点宽度 / 7.5`，`c1c1ec7b9-fHtdZ7Yb.js` 的 `X5`），只是字体不同所以除数不同。
 *
 * 实测（真 Chromium，`p` 元素 13px/20px）：358px 列 ⇒ 55 视觉字符/行、768px 列
 * ⇒ 118，与本式一致。
 */
const VISUAL_CHAR_PX = 6.5;
/** 再窄也至少按这么多字折，免得极窄列把估算抬到不可用的高度。 */
const MIN_CHARS_PER_LINE = 8;
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

/** 正文列宽对应的「每行几个视觉字符」。 */
function charsPerLine(textWidth: number): number {
  return Math.max(MIN_CHARS_PER_LINE, Math.floor(textWidth / VISUAL_CHAR_PX));
}

function textHeight(content: string, perLine: number): number {
  // 围栏内按行数、围栏外按字符折行：两类文字不是同一套排版。
  //
  // 正文必须**逐段**折行再相加，不能把整块的字符数攒起来一次性除以每行字数：
  // 段末那一行的余数会被下一段「借走」，段数越多估得越矮。六段各占三行的回答，
  // 攒起来算只有十四行（少四行 ≈ 88px），而它下一行的定位正是按这个账本走的。
  let proseLines = 0;
  let paragraph = 0;
  let codeLines = 0;
  let codeBlocks = 0;
  let inFence = false;
  const flush = () => {
    if (paragraph > 0) proseLines += Math.ceil(paragraph / perLine);
    paragraph = 0;
  };
  for (const line of content.split("\n")) {
    if (FENCE_LINE.test(line)) {
      flush();
      if (!inFence) codeBlocks += 1;
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      codeLines += 1;
      continue;
    }
    const visual = visualLength(line);
    if (visual === 0) flush();
    else paragraph += visual;
  }
  flush();
  return (
    proseLines * LINE_HEIGHT +
    codeBlocks * CODE_BLOCK_PADDING +
    codeLines * CODE_LINE_HEIGHT
  );
}

export interface EstimateRowHeightOptions {
  /** 正文列的实际宽度（px）。缺省按桌面 800px 列算。 */
  textWidth?: number;
}

export function estimateRowHeight(
  message: MessageType,
  options: EstimateRowHeightOptions = {},
): number {
  const perLine = charsPerLine(options.textWidth ?? DEFAULT_TEXT_WIDTH);
  const blocks = message.blocks;
  if (!blocks || blocks.length === 0) return BASE_HEIGHT;

  let height = BASE_HEIGHT;
  let counted = 0;
  for (const block of blocks) {
    switch (block.type) {
      case "text": {
        const content = block.content || "";
        if (!content.trim()) continue;
        height += textHeight(content, perLine);
        break;
      }
      case "reasoning": {
        // 与 Message.renderBlock / isTimelineBlock 同口径：网关偶发下发一个
        // 只含 "\n" 的 reasoning_content，这种块不渲染，估算高度也不该替它
        // 留空间（否则首屏会凭空多出一段空白，等挂载后再被实测收掉）。
        const reasoningContent = block.content || "";
        if (!reasoningContent.trim()) continue;
        height += REASONING_HEIGHT;
        break;
      }
      case "compact":
        height += COMPACT_HEIGHT;
        break;
      case "tool":
        height += TOOL_HEIGHT;
        break;
      case "notice":
        // A failed turn wraps like the old error block; a hook's status line is
        // one short line, same order of magnitude as its text height.
        height +=
          block.level === "error"
            ? ERROR_HEIGHT
            : textHeight(block.content || "", perLine);
        break;
      case "image":
        height += IMAGE_HEIGHT;
        break;
      case "task_notification":
        height += TASK_NOTIFICATION_HEIGHT;
        break;
      default:
        // 没见过的块：按一段文本的保守值算，挂载后马上被实测纠正。
        height += textHeight(JSON.stringify(block), perLine);
    }
    counted += 1;
  }
  if (counted > 1) height += (counted - 1) * BLOCK_GAP;
  return Math.min(MAX_ESTIMATE, Math.max(BASE_HEIGHT, height));
}
