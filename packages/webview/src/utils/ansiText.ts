// 终端颜色（ANSI 转义序列）→ 带颜色的 HTML。
//
// 命令输出里的颜色是命令作者刻意给出的可读性信息（`git diff` 的红绿增删、
// 测试报告的通过/失败色、彩色 `ls` / `rg`），SDK 侧因此不剥离转义序列——写入
// 转录、发给模型、交给宿主的都是同一份带色原文（见 specs/core/bash-tools.md
// 「ANSI 颜色代码」与 specs/ui/message-rendering-system.md「Bash 工具输出的终端
// 颜色」）。渲染在这一层完成：
//
// - **只认 SGR**（`ESC [ … m`）：颜色/加粗/下划线等。其余终端控制序列（光标
//   移动、清屏、擦除、OSC 窗口标题/超链接）一律丢弃，既不产生可见字符，也不
//   触发任何行为——它们对「看输出」没有意义，留着只会变成乱码方块。
// - **转义序列不占字符位**：剥掉序列后剩下的可见文本才是要渲染的内容，所以
//   「终端里看到什么，屏幕上就是什么」。
// - **链接化仍在可见文本上做**：`linkifyPlainText` 的 URL / 文件路径识别以
//   空白分隔的 token 为单位。被颜色边界从中间切断的 token 不参与链接化（宁可
//   退化成纯文本，也不产出半条链接）。

import { escapeHtml } from "./filePathLinks";
import type { FilePathLinkMode } from "./filePathLinks";
import { linkifyPlainText } from "./linkifyPlainText";

// CSI（含 SGR）、OSC（`ESC ] … BEL` 或 `ESC ] … ESC \`）、以及两字节的
// `ESC <char>` 序列。用一条正则覆盖，避免"只剥 SGR、留下半截控制序列"。
const ANSI_SEQ_SOURCE =
  "\\x1b(?:\\[[0-?]*[ -/]*[@-~]|\\][^\\x07\\x1b]*(?:\\x07|\\x1b\\\\)|[@-Z\\\\-_])";
const ANSI_SEQ_RE = new RegExp(ANSI_SEQ_SOURCE, "g");
// 残缺转义序列（被输出截断留下的半截 `ESC[3`），同样用字符串形式构造，避免
// 正则字面量里出现控制字符。
const LONE_ESC_RE = new RegExp(
  `${String.fromCharCode(27)}(?:\\[[0-9;]*)?`,
  "g",
);

const NAMED_COLORS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;

const namedColor = (index: number): string => {
  if (index < 8) return NAMED_COLORS[index];
  return `bright-${NAMED_COLORS[index - 8]}`;
};

// xterm 256 色调色板里 16 号之后的取值（0-15 走命名色，见 namedColor）。
const color256 = (index: number): string => {
  if (index < 216) {
    const n = index - 16;
    const steps = [0, 95, 135, 175, 215, 255];
    const r = steps[Math.floor(n / 36)];
    const g = steps[Math.floor((n % 36) / 6)];
    const b = steps[n % 6];
    return rgbHex(r, g, b);
  }
  const gray = 8 + (index - 232) * 10;
  return rgbHex(gray, gray, gray);
};

// 取值来自控制序列，先夹到合法范围再拼进 style——这段 HTML 会进
// dangerouslySetInnerHTML（bash 输出通道靠 escapeHtml 防注入，不走 DOMPurify）。
const clampByte = (value: number): number =>
  Number.isFinite(value) ? Math.min(255, Math.max(0, Math.trunc(value))) : 0;

const rgbHex = (r: number, g: number, b: number): string =>
  "#" +
  [r, g, b].map((v) => clampByte(v).toString(16).padStart(2, "0")).join("");

interface AnsiState {
  fg?: string; // 命名色（→ class）或 #rrggbb（→ inline style）
  bg?: string;
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strike?: boolean;
}

const resetState = (state: AnsiState): void => {
  for (const key of Object.keys(state)) {
    delete (state as Record<string, unknown>)[key];
  }
};

const applySgr = (state: AnsiState, params: string): void => {
  const codes = params.length
    ? params.split(";").map((part) => (part === "" ? 0 : Number(part)))
    : [0];

  for (let i = 0; i < codes.length; i += 1) {
    const code = Number.isFinite(codes[i]) ? codes[i] : 0;
    if (code === 0) {
      resetState(state);
    } else if (code === 1) {
      state.bold = true;
    } else if (code === 2) {
      state.dim = true;
    } else if (code === 3) {
      state.italic = true;
    } else if (code === 4) {
      state.underline = true;
    } else if (code === 7) {
      state.inverse = true;
    } else if (code === 9) {
      state.strike = true;
    } else if (code === 21 || code === 22) {
      delete state.bold;
      delete state.dim;
    } else if (code === 23) {
      delete state.italic;
    } else if (code === 24) {
      delete state.underline;
    } else if (code === 27) {
      delete state.inverse;
    } else if (code === 29) {
      delete state.strike;
    } else if (code >= 30 && code <= 37) {
      state.fg = namedColor(code - 30);
    } else if (code === 39) {
      delete state.fg;
    } else if (code >= 40 && code <= 47) {
      state.bg = namedColor(code - 40);
    } else if (code === 49) {
      delete state.bg;
    } else if (code >= 90 && code <= 97) {
      state.fg = namedColor(code - 90 + 8);
    } else if (code >= 100 && code <= 107) {
      state.bg = namedColor(code - 100 + 8);
    } else if (code === 38 || code === 48) {
      // 扩展色：`38;5;n`（256 色）或 `38;2;r;g;b`（truecolor）。
      const key = code === 38 ? "fg" : "bg";
      const mode = codes[i + 1];
      if (mode === 5) {
        const index = codes[i + 2];
        if (Number.isFinite(index)) {
          state[key] =
            index >= 0 && index < 16 ? namedColor(index) : color256(index);
        }
        i += 2;
      } else if (mode === 2) {
        const [r, g, b] = [codes[i + 2], codes[i + 3], codes[i + 4]];
        if ([r, g, b].every(Number.isFinite)) state[key] = rgbHex(r, g, b);
        i += 4;
      } else {
        i += 1;
      }
    }
  }
};

const isHex = (color: string): boolean => color.startsWith("#");

/** 一面（前景/背景）的呈现：命名色用 class，扩展色用 inline style。 */
const colorAttrs = (
  color: string | undefined,
  prefix: "fg" | "bg",
  classes: string[],
  styles: string[],
): void => {
  if (!color) return;
  if (isHex(color)) {
    styles.push(`${prefix === "fg" ? "color" : "background-color"}:${color}`);
  } else {
    classes.push(`ansi-${prefix}-${color}`);
  }
};

interface AnsiSpan {
  text: string;
  className: string;
  inlineStyle: string;
}

const serialize = (state: AnsiState): Omit<AnsiSpan, "text"> => {
  const classes: string[] = [];
  const styles: string[] = [];
  if (state.bold) classes.push("ansi-bold");
  if (state.dim) classes.push("ansi-dim");
  if (state.italic) classes.push("ansi-italic");
  if (state.underline) classes.push("ansi-underline");
  if (state.inverse) classes.push("ansi-inverse");
  if (state.strike) classes.push("ansi-strike");
  colorAttrs(state.fg, "fg", classes, styles);
  colorAttrs(state.bg, "bg", classes, styles);
  return { className: classes.join(" "), inlineStyle: styles.join(";") };
};

const wrap = (html: string, span: Omit<AnsiSpan, "text">): string => {
  if (!span.className && !span.inlineStyle) return html;
  const cls = span.className ? ` class="${span.className}"` : "";
  const style = span.inlineStyle ? ` style="${span.inlineStyle}"` : "";
  return `<span${cls}${style}>${html}</span>`;
};

/** 按可见文本切分：相邻同样式合并，转义序列本身不进入输出。 */
const parseAnsi = (text: string): AnsiSpan[] => {
  const spans: AnsiSpan[] = [];
  const state: AnsiState = {};
  let lastIndex = 0;

  const push = (rawChunk: string): void => {
    if (!rawChunk) return;
    // 残缺的转义序列：输出被按字符预算截断时（`toolResultStorage` 的 preview /
    // fallback 截断）可能只留下 `ESC` 或 `ESC[3`。有效序列已被上面的正则切走，
    // 这里剩下的一律清掉，避免控制字符落到屏幕上。
    const chunk = rawChunk.replace(LONE_ESC_RE, "");
    if (!chunk) return;
    const style = serialize(state);
    const previous = spans[spans.length - 1];
    if (
      previous &&
      previous.className === style.className &&
      previous.inlineStyle === style.inlineStyle
    ) {
      previous.text += chunk;
      return;
    }
    spans.push({ ...style, text: chunk });
  };

  for (const match of text.matchAll(ANSI_SEQ_RE)) {
    push(text.slice(lastIndex, match.index));
    lastIndex = match.index! + match[0].length;
    // 只有 SGR 影响样式；其余控制序列在上面被跳过（等价于丢弃）。
    if (match[0].startsWith("\x1b[") && match[0].endsWith("m")) {
      applySgr(state, match[0].slice(2, -1));
    }
  }
  push(text.slice(lastIndex));
  return spans;
};

/**
 * 把纯文本（可能含 ANSI 转义序列）渲染成可安全用于 dangerouslySetInnerHTML 的
 * HTML：可见文本保持原样并链接化，颜色由 `ansi-*` class / inline style 表达。
 */
export function linkifyAnsiText(
  text: string,
  mode: FilePathLinkMode = "all",
): string {
  return renderAnsi(text, (chunk) => linkifyPlainText(chunk, mode));
}

/**
 * 同一条通道，但**不做链接化**：只把转义序列变成颜色，可见文本按原样转义。
 * 给那些「本来就把文本原样显示」的地方用（后台任务面板），免得顺带引入链接化。
 */
export function ansiToHtml(text: string): string {
  return renderAnsi(text, escapeHtml);
}

const renderAnsi = (
  text: string,
  renderChunk: (chunk: string) => string,
): string => {
  if (!text) return "";
  // 完全没有 ESC 时走原路径——输出与改动前逐字节一致（无色输出不该因为这条
  // 通道多出任何标记）。带 ESC 的一律走解析：即便它只是被截断的残片。
  if (!text.includes("\x1b")) return renderChunk(text);

  const spans = parseAnsi(text);
  if (spans.length === 0) return "";

  // 被颜色边界从中间切断的 token 不参与链接化（两侧都降级为纯文本），
  // 否则会产出 href 只有半截的链接。
  const visible = spans.map((span) => span.text).join("");
  const splitMidToken = (position: number): boolean =>
    position > 0 &&
    position < visible.length &&
    !/\s/.test(visible[position - 1]) &&
    !/\s/.test(visible[position]);

  let html = "";
  let offset = 0;
  for (const span of spans) {
    const start = offset;
    const end = offset + span.text.length;
    offset = end;
    if (!span.text) continue;

    const cut = splitMidToken(start) || splitMidToken(end);
    html += wrap(cut ? escapeHtml(span.text) : renderChunk(span.text), span);
  }
  return html;
};
