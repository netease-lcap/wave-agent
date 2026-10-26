import type {
  IdeContextProblem,
  IdeContextProvider,
  IdeContextResult,
} from "wave-webview-fixtures";
import type { FileItem } from "../types";
import { isDesktopHost, isRemotePageHost } from "./platform";

/**
 * IDE 上下文提及（`@Terminal` / `@Problems`，spec `ui/ide-context-mentions.md`）。
 *
 * 数据只有 IDE 宿主能读，格式只有这一份：
 * - 宿主侧：实现 `requestIdeContext`，返回 {@link IdeContextResult}（原始文本 /
 *   原始诊断数组），不做格式化。
 * - webview 侧：本模块负责标记语法、上限、转义清理、排序与正文拼装，发送那一刻
 *   拼进用户消息正文。历史重放只读消息本身，不再访问 IDE。
 */

export interface IdeContextProviderInfo {
  id: IdeContextProvider;
  /** 下拉条目与用户消息里标签的名称 */
  label: string;
  /** 下拉条目的副标题：这一项会带进什么 */
  description: string;
  /** 消息里块首行的标题 */
  blockTitle: string;
  /** codicon 类名（下拉条目沿用文件建议那套图标） */
  icon: string;
}

/**
 * 下拉里的固定条目。新增一类上下文只改这里 + 两个宿主的读取实现。
 *
 * `label` 是 `@` 后面那个词，保持英文——与 Cursor 的 `@Terminals`、TRAE 的
 * `#Problems` 同一形制（中文只出现在描述与正文里，不出现在提及标记上）。
 */
export const IDE_CONTEXT_PROVIDERS: readonly IdeContextProviderInfo[] = [
  {
    id: "terminal",
    label: "Terminal",
    description: "当前终端最后一条命令的输出",
    blockTitle: "终端输出",
    icon: "codicon-terminal",
  },
  {
    id: "problems",
    label: "Problems",
    description: "当前文件的问题（错误与警告）",
    blockTitle: "当前文件的问题",
    icon: "codicon-warning",
  },
] as const;

export const ideContextProviderInfo = (
  id: IdeContextProvider,
): IdeContextProviderInfo | undefined =>
  IDE_CONTEXT_PROVIDERS.find((provider) => provider.id === id);

/**
 * 两个固定条目只在 IDE 插件宿主出现：桌面端有 PTY 终端面板但不在本期范围内
 * （spec「非目标」），远控页没有 IDE 可读。判据复用 webview 现有的宿主标识，
 * 不新增「宿主能力声明」请求。
 */
export const isIdeContextAvailable = (): boolean =>
  typeof window !== "undefined" && !isDesktopHost() && !isRemotePageHost();

/** 输入框标签序列化进正文的标记；发送时展开成「标记 + 内容 + 结束标记」。 */
export const ideContextMarker = (id: IdeContextProvider): string =>
  `[@ide:${id}]`;

/** 块结束标记。与起始标记成对出现，`parseMentions` 据此切出内容。 */
export const IDE_CONTEXT_BLOCK_END = "[/@ide]";

const IDE_MARKER_SOURCE = "\\[@ide:(terminal|problems)\\]";

/**
 * 单个起始标记（不带内容块）。输入框草稿里存的就是它——标签的正文在发送时
 * 才取，`renderDraftContent` 用它把草稿里的标记还原成标签。
 *
 * 带 `g`，只用于 `matchAll` / `match`（两者内部会克隆正则）；`split` 不要用它
 * ——带捕获组会吃掉分隔符本身，`exec` 复用又会带 `lastIndex` 状态。
 */
export const IDE_MARKER_PATTERN = new RegExp(IDE_MARKER_SOURCE, "g");

/**
 * 从正文里按出现顺序取出（去重）用户附加的类别。同一类附加两次只取一份内容
 * （spec 终端场景 6）——重复的两处标记在展开时都会替换成同一段。
 */
export const findIdeContextMentions = (
  markdown: string,
): IdeContextProvider[] => {
  const found: IdeContextProvider[] = [];
  for (const match of markdown.matchAll(IDE_MARKER_PATTERN)) {
    const provider = match[1] as IdeContextProvider;
    if (!found.includes(provider)) found.push(provider);
  }
  return found;
};

/**
 * 下拉里的固定条目，按已输入的过滤文本本地筛选——不请求宿主，输入 `@` 立即出现
 * （宿主读取发生在发送时）。路径写成 `ide:<id>`，供选中分支识别，不会与真实
 * 文件路径混淆。
 *
 * 匹配范围是「英文名 / 中文描述 / id」三者：`@` 后面展示英文名（见
 * {@link IDE_CONTEXT_PROVIDERS}），但中文界面里的用户仍会打「终端」「问题」，
 * 描述文案正好承担这层匹配，不需要单独维护一份别名表。
 */
export const buildIdeContextSuggestions = (filterText: string): FileItem[] => {
  if (!isIdeContextAvailable()) return [];
  const filter = filterText.toLowerCase();
  return IDE_CONTEXT_PROVIDERS.filter(
    (provider) =>
      !filter ||
      provider.label.toLowerCase().includes(filter) ||
      provider.description.toLowerCase().includes(filter) ||
      provider.id.includes(filter),
  ).map((provider) => ({
    path: `ide:${provider.id}`,
    relativePath: provider.description,
    name: provider.label,
    extension: "",
    icon: provider.icon,
    isDirectory: false,
    ideContext: provider.id,
  }));
};

// 上限取设计默认值（spec 边界情况）：终端按尾部行数与字节、诊断按条数。
const MAX_TERMINAL_LINES = 200;
const MAX_TERMINAL_CHARS = 20_000;
const MAX_PROBLEMS = 50;

// ESC/BEL 按字符码拼进正则源，避免正则字面量里出现控制字符转义（no-control-regex
// 会拦；写法照 `packages/desktop/src/main/remoteCli.ts` 的 stripAnsiEscapes）。
const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const OSC_SEQUENCE_RE = new RegExp(
  `${ESC}\\][^${BEL}]*(?:${BEL}|${ESC}\\\\)`,
  "g",
);
const CSI_SEQUENCE_RE = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, "g");
const CONTROL_CHARS_RE = new RegExp(
  `[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`,
  "g",
);

/** ANSI 颜色/光标控制与进度条重绘会污染上下文，进消息前一律清掉。 */
export const stripTerminalControlChars = (text: string): string =>
  text
    // CSI / OSC 等 ANSI 转义序列
    .replace(OSC_SEQUENCE_RE, "")
    .replace(CSI_SEQUENCE_RE, "")
    // 进度条常见的 \r 重绘：同一行只保留最后一版。CRLF 行尾那个 \r 会被切出
    // 一个空段，不能当成「最后一版」——否则整行内容被抹掉。
    .split("\n")
    .map((line) => {
      const segments = line.split("\r");
      while (segments.length > 1 && segments[segments.length - 1] === "") {
        segments.pop();
      }
      return segments[segments.length - 1];
    })
    .join("\n")
    .replace(CONTROL_CHARS_RE, "");

const clipTerminalText = (text: string): { text: string; note?: string } => {
  const lines = text.split("\n");
  let clipped = lines;
  let note: string | undefined;

  if (clipped.length > MAX_TERMINAL_LINES) {
    const dropped = clipped.length - MAX_TERMINAL_LINES;
    clipped = clipped.slice(-MAX_TERMINAL_LINES);
    note = `已截断，仅保留最后 ${MAX_TERMINAL_LINES} 行（丢掉了更早的 ${dropped} 行）`;
  }

  let joined = clipped.join("\n");
  if (joined.length > MAX_TERMINAL_CHARS) {
    joined = joined.slice(-MAX_TERMINAL_CHARS);
    note = `已截断，仅保留最后 ${MAX_TERMINAL_CHARS} 个字符`;
  }

  return { text: joined, note };
};

const severityLabel = (severity: IdeContextProblem["severity"]): string =>
  severity === "error"
    ? "error"
    : severity === "warning"
      ? "warning"
      : severity === "info"
        ? "info "
        : "hint ";

const formatProblemsBody = (
  result: IdeContextResult,
): { text: string; header: string } => {
  // 排序在 webview 做：宿主返回顺序取决于各自的诊断来源，行号序才是 agent 想看的。
  const sorted = [...(result.problems ?? [])].sort(
    (a, b) => a.line - b.line || a.column - b.column,
  );
  const shown = sorted.slice(0, MAX_PROBLEMS);
  const errors = sorted.filter((p) => p.severity === "error").length;
  const warnings = sorted.filter((p) => p.severity === "warning").length;

  const where = result.filePath ? `（${result.filePath}）` : "";
  const truncated =
    sorted.length > shown.length ? `，仅列前 ${shown.length} 条` : "";
  const header = `${where}共 ${sorted.length} 条：${errors} 个错误 / ${warnings} 个警告${truncated}`;

  const lines = shown.map(
    (problem) =>
      `  ${problem.line}:${problem.column}  ${severityLabel(problem.severity)}  ${problem.message}${
        problem.source ? ` (${problem.source})` : ""
      }`,
  );

  return {
    text: lines.length > 0 ? lines.join("\n") : "（无条目）",
    header,
  };
};

/** 一个类别展开成的正文块（起始标记 + 首行标题 + 内容 + 结束标记）。 */
const renderBlock = (
  provider: IdeContextProvider,
  result: IdeContextResult | undefined,
): string => {
  const info = ideContextProviderInfo(provider);
  const title = info?.blockTitle ?? provider;
  const marker = ideContextMarker(provider);

  if (!result || !result.ok) {
    const reason = result?.reason || "读取失败";
    return [marker, `${title}不可用：${reason}`, IDE_CONTEXT_BLOCK_END].join(
      "\n",
    );
  }

  if (provider === "terminal") {
    const cleaned = stripTerminalControlChars(result.terminalText ?? "").trim();
    if (!cleaned) {
      return [
        marker,
        `${title}不可用：终端没有可读输出`,
        IDE_CONTEXT_BLOCK_END,
      ].join("\n");
    }
    const { text, note } = clipTerminalText(cleaned);
    const head = note ? `${title}（${note}）` : title;
    return [marker, head, text, IDE_CONTEXT_BLOCK_END].join("\n");
  }

  const { text, header } = formatProblemsBody(result);
  return [marker, `${title}${header}`, text, IDE_CONTEXT_BLOCK_END].join("\n");
};

/**
 * 把输入框里的标记展开成「标记 + 内容 + 结束标记」，拼进待发送的正文。
 *
 * 同一类出现多次时，每一处都替换成同一段（内容只取一份）。宿主没返回结果的
 * 类别按「不可用」写一行说明——消息照常发送，不因为读不到 IDE 而卡住（spec 各
 * 场景 4/5）。
 */
export const assembleIdeContextBlocks = (
  markdown: string,
  results: IdeContextResult[],
): string => {
  let assembled = markdown;
  for (const provider of findIdeContextMentions(markdown)) {
    const result = results.find((item) => item.provider === provider);
    assembled = assembled
      .split(ideContextMarker(provider))
      .join(renderBlock(provider, result));
  }
  return assembled;
};
