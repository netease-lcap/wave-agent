// 会话内查找的匹配内核与命中高亮（spec ui/transcript-find.md）。
//
// 两件事分在两层，各自的判据不同：
//
// - **计数与跳转取自消息数据**（`countMessageHits`）：虚拟列表只挂载可见行，
//   只搜 DOM 会让「共几个命中」「下一条命中在哪条消息」漏掉未挂载的历史，用户按
//   「下一个」时会跳过整段会话。这条是能力本身，不是实现细节。
// - **高亮画在渲染后的文本节点上**（`wrapTextRange`）：正文是 marked 产出的
//   HTML，字符串层面插 `<mark>` 会切碎正好跨过命中边界的标签；拆文本节点则让
//   周围的 `<span>` / `<strong>` 原样保留。同一套偏移语义原本属于文件面板的查找
//   （`components/FilePane.tsx`），这里抽出来给两处共用。

import type { Message, MessageBlock } from "wave-agent-sdk/types";

export interface TranscriptFindOptions {
  caseSensitive: boolean;
  wholeWord: boolean;
  regex: boolean;
}

export interface FindRange {
  /** 相对所在文本段起点的字符偏移。 */
  start: number;
  length: number;
}

/** 命中标记的 class；一条会话里只存在这一种，清理时按它整批撤。 */
export const FIND_HIT_CLASS = "transcript-find-hit";
export const FIND_HIT_CURRENT_CLASS = "transcript-find-hit--current";

/**
 * 「整词」按 Unicode 字母/数字/下划线判界。`\b` 只认 ASCII 词字符，中文语境下
 * 「的」与「a」之间会出现一个并不存在的词边界，用它做整词判定会把中文全部拆散。
 */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

// 一段文本里最多算这么多个命中：正则写宽了（比如 `.` 或 `.*`）时，一条长消息
// 可以产出上万条命中，计数与跳转都不需要这个粒度，但每条都要分配对象。
const MAX_HITS_PER_TEXT = 500;

const escapeRegExp = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * 编译查找表达式。非法正则返回 `error` 且不匹配任何内容（spec 场景 7）。
 */
export function buildFindRegex(
  query: string,
  options: TranscriptFindOptions,
): { regex: RegExp | null; error?: string } {
  if (!query) return { regex: null };
  const source = options.regex ? query : escapeRegExp(query);
  try {
    return {
      regex: new RegExp(source, options.caseSensitive ? "g" : "gi"),
    };
  } catch {
    return { regex: null, error: "正则表达式无效" };
  }
}

/**
 * 一段文本里的全部命中区间。「整词」在这一层做而不是拼进正则（`\b(?:x)\b`）：
 * 拼装会改变正则模式自身的语义（用户写的 `a|b` 会被整词约束到只看 `a`），而
 * 逐个命中判左右字符对两种模式是同一件事。
 */
export function findRanges(
  regex: RegExp,
  text: string,
  wholeWord = false,
): FindRange[] {
  if (!text) return [];
  const out: FindRange[] = [];
  regex.lastIndex = 0;
  let hit = regex.exec(text);
  while (hit && out.length < MAX_HITS_PER_TEXT) {
    if (hit[0].length === 0) {
      // 零宽匹配（`^`、`a*`）在 lastIndex 上原地打转，推进一格再看。
      regex.lastIndex++;
    } else {
      const start = hit.index;
      const end = start + hit[0].length;
      const bounded =
        !wholeWord ||
        ((start === 0 || !WORD_CHAR.test(text[start - 1])) &&
          (end >= text.length || !WORD_CHAR.test(text[end])));
      if (bounded) out.push({ start, length: hit[0].length });
    }
    hit = regex.exec(text);
  }
  regex.lastIndex = 0;
  return out;
}

/** 工具块在界面上真正露出来的那几段文本。`parameters` 只在没有摘要时顶替。 */
const toolTexts = (
  block: Extract<MessageBlock, { type: "tool" }>,
): string[] => {
  const texts: string[] = [];
  if (block.name) texts.push(block.name);
  const summary = block.compactParams || block.parameters;
  if (summary) texts.push(summary);
  const result = block.result || block.shortResult;
  // 命令输出保留 ANSI 转义（spec core/bash-tools.md）：屏幕上的文本是剥掉序列
  // 之后的样子，拿带 `\x1b[…m` 的原文去匹配会让用户搜不到眼前看得见的字符。
  if (result) texts.push(result);
  if (block.error) {
    texts.push(
      typeof block.error === "string" ? block.error : block.error.message,
    );
  }
  return texts;
};

/**
 * 一条消息参与匹配的文本段，顺序与渲染顺序一致。跨段匹配不在设计内（段间用换行
 * 连接后匹配）：一次命中落在两段文本里，屏幕上本来就没有那串连续字符。
 */
export function messageSearchTexts(message: Message): string[] {
  const texts: string[] = [];
  for (const block of message.blocks ?? []) {
    switch (block.type) {
      case "text":
      case "reasoning":
      case "notice":
      case "compact":
        if (block.content) texts.push(block.content);
        break;
      case "tool":
        texts.push(...toolTexts(block));
        break;
      case "task_notification":
        if (block.summary) texts.push(block.summary);
        break;
      default:
        break;
    }
  }
  return texts;
}

/**
 * 一条消息里的命中总数。段间用 `\n` 连接一次性匹配而非逐段累加：正则里的 `^`/`$`
 * （多行标志未开）落在整段起点/终点，逐段匹配会让每个段首都被当成行首。
 */
export function countMessageHits(message: Message, regex: RegExp): number {
  const texts = messageSearchTexts(message);
  if (texts.length === 0) return 0;
  return findRanges(regex, texts.join("\n")).length;
}

/**
 * 把一段已渲染文本里的一个字符区间包进 `<mark>`。
 *
 * 区间可能跨多个文本节点（语法高亮、行内代码、加粗都会切断文本），偏移就是这些
 * 节点长度累加的结果；拆节点而不是重新切 HTML 字符串，才不会吞掉正好跨过边界的
 * 标签。`wrapTextRange` 与 `clearFindMarks` 成对使用，后者让重复执行幂等。
 */
export function wrapTextRange(
  container: Node,
  start: number,
  length: number,
  className: string,
): void {
  if (length <= 0) return;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text);
  }
  const end = start + length;
  let offset = 0;
  for (const textNode of nodes) {
    const nodeStart = offset;
    const nodeEnd = offset + textNode.data.length;
    offset = nodeEnd;
    if (nodeEnd <= start || nodeStart >= end) continue;
    const from = Math.max(start, nodeStart) - nodeStart;
    const to = Math.min(end, nodeEnd) - nodeStart;
    if (to < textNode.data.length) textNode.splitText(to);
    const target = from > 0 ? textNode.splitText(from) : textNode;
    const mark = document.createElement("mark");
    mark.className = className;
    target.parentNode?.replaceChild(mark, target);
    mark.appendChild(target);
  }
}

/** 撤掉上一次画的全部命中标记，把文本节点还原。 */
export function clearFindMarks(root: ParentNode): void {
  root
    .querySelectorAll<HTMLElement>(`mark.${FIND_HIT_CLASS}`)
    .forEach((mark) => {
      const parent = mark.parentNode;
      if (!parent) return;
      parent.replaceChild(
        document.createTextNode(mark.textContent ?? ""),
        mark,
      );
      parent.normalize();
    });
}
