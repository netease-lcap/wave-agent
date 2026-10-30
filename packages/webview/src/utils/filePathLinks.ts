// 助手 markdown 文本中文件路径的识别与链接化（见 specs/ui/file-path-links.md），
// 四条通道（行内代码 / 正文纯文本 / 围栏代码块 / bash 输出）共用一套识别规则，
// 对齐 Claude AI 的 barePath：
//   - 只识别绝对路径形式（POSIX /…、Windows 盘符、file:///…）；相对路径
//     （`src/a.ts`、`./x.ts`、`../x.ts`）一律不识别，保持普通文本。
//   - 必须带点扩展名（`/etc/hosts`、`/usr/local/bin` 不识别）。POSIX 绝对路径
//     另要求至少两级目录（单独的 `/foo.ts` 不识别，规避散文中的斜杠误判）。
//   - 行号后缀 `:N` / `:N-M` 在行内代码、围栏代码块、bash 输出三通道识别；
//     正文纯文本通道不识别（避免把散文里的冒号当行号）。
//   - ~/… 是识别候选但不生成链接（wave 各宿主 openFile 按 OS 绝对路径处理，
//     webview 无宿主用户主目录可展开），交由渲染层回退为普通文本。
//
// 本模块只做纯识别与字符串链接化，不接触 DOM/React：行内代码通道与正文
// 通道的拼装在 Message.tsx 的 marked renderer 中完成，点击解析复用这里。

import type { TokenizerExtension } from "marked";
import { isImageFileExtension } from "wave-agent-sdk/constants";
import { normalizeFilePath } from "./messageUtils";

/**
 * 四条路径通道各自的开关档位。
 *
 * - `"all"`：本机宿主（CLI / 桌面 / IDE）——路径都能交给宿主打开。
 * - `"images"`：只把**图片**路径变成可点入口。远控页用这一档：页面上没有
 *   编辑器，文本路径无处可去；但图片可以就地显示（宿主按需取图并压到单帧
 *   预算内，见 spec `remote/remote-web.md`「点消息里的图片路径看原图」）。
 * - `"off"`：全部退化为纯文本。
 *
 * 它替掉的是原来那个 boolean：boolean 表达不了「只开图片这一半」，而把远控页
 * 直接翻成 `true` 会把文本路径一起放开，撞上场景 23 的禁令。
 */
export type FilePathLinkMode = "off" | "images" | "all";

// marked（escape encode=true）只对 & < > " ' 做实体转义，这里做精确逆操作。
const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
};

/**
 * 这份内容该按 **Markdown 文档**排版还是按**代码/日志原样**显示。
 *
 * 判据是扩展名，而且只决定「怎么显示」——与「能不能读」无关（那是宿主按内容
 * 判的）。判错的代价仅仅是排版难看，不会让一份文件读不出来；反过来，把代码按
 * markdown 排会把缩进吃成缩进代码块、把 `/** *\/` 注释吃成项目符号。
 */
export const isMarkdownPath = (path: string): boolean =>
  /\.(md|markdown|mdown|mkd)$/i.test(path);

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 解码 marked 转义后的文本（renderer.text / codespan 输入）。 */
export function decodeHtmlEntities(s: string): string {
  return s.replace(
    /&(amp|lt|gt|quot|#39|#x27);/gi,
    (m) => ENTITY_MAP[m.toLowerCase()] ?? m,
  );
}

export interface FilePathMatch {
  /** posix 绝对 / win 盘符绝对 / file:/// 绝对 */
  kind: "posix" | "win" | "file";
  /** 去掉行号后缀与首尾标点后的路径原文（按消息里写的那样） */
  path: string;
  /** 展示文本 = path 原文（无首尾标点，含行号后缀写法） */
  display: string;
  startLine?: number;
  endLine?: number;
}

// 路径段允许字符：ASCII 字母数字与安全符号 ∪ Unicode 字母/数字/组合标记
// （中文、日文假名、韩文、带变音记号字母等），仍排除空白、ASCII/中文标点
// 与括号（unicode 属性转义只含 L/N/M，标点与空白天然不在其中），规避把散文
// 误当路径。'.' 允许（点文件、多段扩展名如 .d.ts），'~' 允许（仅 ~/ 前缀被
// 单独拦截）。含 \p{…} 的字符类必须配合 u flag（下方各 new RegExp 均已加）。
const SEG = "[A-Za-z0-9._~+@%\\-\\p{L}\\p{N}\\p{M}]";

// POSIX 绝对：以 / 开头，至少两级目录（/etc/hosts 可点击，/foo 不可）。
const POSIX_ABS_RE = new RegExp(`^\\/${SEG}+(?:\\/${SEG}+)+$`, "u");

// Windows 盘符绝对：C:\… 或 C:/…，至少一级（含盘符即无歧义）。
const WIN_ABS_RE = new RegExp(
  `^[A-Za-z]:[\\\\/]${SEG}+(?:[\\\\/]${SEG}+)*$`,
  "u",
);

// file:/// URL：盘符形式（file:///C:/x）或 POSIX 形式（file:///etc/x）。
// 只消耗 file:// 前缀；路径本身（/C:/x、/etc/x）保留前导 /，随各分支匹配。
const FILE_URL_RE = new RegExp(
  `^file:\\/\\/(?:\\/[A-Za-z]:[\\\\/]${SEG}+(?:[\\\\/]${SEG}+)*|(?:\\/${SEG}+)+)$`,
  "iu",
);

// 行号后缀：:N 或 :N-M，仅允许紧贴路径末尾。
const LINE_SUFFIX_RE = /^(.*):(\d+)(?:-(\d+))?$/;

// 末段是否带扩展名（点前至少一个路径字符——含中文等非 ASCII 字母数字，点后
// 至少一个 ASCII 字母数字；点前显式排除 '.' 自身，防 .. 型序列被当扩展名）。
const HAS_EXT_RE =
  /[\p{L}\p{N}\p{M}A-Za-z0-9_~+@%-]\.[A-Za-z0-9][A-Za-z0-9_-]*$/u;

// 分类 path（已经去掉行号后缀、~ 前缀已拦截）→ kind；非法返回 null。
const classifyPath = (body: string): FilePathMatch["kind"] | null => {
  if (FILE_URL_RE.test(body)) return "file";
  if (WIN_ABS_RE.test(body)) return "win";
  if (POSIX_ABS_RE.test(body)) return "posix";
  return null;
};

/** 剥离 token 首尾的标点/括号，返回核心串（供整串匹配使用）。 */
const stripOuterPunct = (s: string): string => {
  let start = 0;
  let end = s.length;
  while (start < end && LEFT_PUNCT.includes(s[start]!)) start++;
  while (end > start && RIGHT_PUNCT.includes(s[end - 1]!)) end--;
  return s.slice(start, end);
};

const LEFT_PUNCT = "([{«‹〈《「『【‘“`";
const RIGHT_PUNCT = ")]}»›〉》」』】’”.,;:!?…，。、；：！？`";

/**
 * 识别一个候选 token（无空白）是否为文件路径。token 允许首尾带标点
 * （正文中的逗号/句号/括号等会被剥离，不影响路径本身）。
 *
 * 只识别绝对路径，且必须带点扩展名（四条通道同规则，见文件头）。
 *
 * @param opts.lineSuffix 是否解析尾部 :N / :N-M 行号后缀（正文纯文本通道传
 *   false —— 不吞入行号，规避把散文中的冒号当行号）
 * @param opts.imagesOnly 只认图片扩展名（远端「看原图」那一档，见
 *   {@link FilePathLinkMode} 的 `"images"`）
 */
export function detectFilePathToken(
  token: string,
  opts: { lineSuffix?: boolean; imagesOnly?: boolean } = {},
): FilePathMatch | null {
  if (!token) return null;
  const display = stripOuterPunct(token);
  if (!display) return null;
  // ~/… 无宿主 home 展开依据：识别但不生成链接（由调用方回退纯文本）
  if (display.startsWith("~/")) return null;

  let body = display;
  let startLine: number | undefined;
  let endLine: number | undefined;
  if (opts.lineSuffix !== false) {
    const suffixMatch = display.match(LINE_SUFFIX_RE);
    if (suffixMatch) {
      body = suffixMatch[1]!;
      startLine = Number(suffixMatch[2]);
      endLine =
        suffixMatch[3] !== undefined ? Number(suffixMatch[3]) : undefined;
    }
  }
  if (!body) return null;

  const kind = classifyPath(body);
  if (!kind) return null;
  // 点扩展名是四条通道的共同前提：无扩展名的路径（/etc/hosts、/usr/local/bin）
  // 在命令输出与散文里大多是日志串或接口路径，放进来就是误链。
  if (!HAS_EXT_RE.test(body)) return null;
  // 远端那一档只把**图片**变成可点入口（spec remote/remote-web.md「点消息里的
  // 图片路径看原图」）：文本路径在页面上仍然无处可去，链上去只会是「点了没
  // 反应」。扩展名在这里是路由提示，宿主还会按解码后的真实容器再判一次。
  if (opts.imagesOnly) {
    const ext = body.slice(body.lastIndexOf(".") + 1).toLowerCase();
    if (!isImageFileExtension(ext)) return null;
  }

  return {
    kind,
    path: body,
    display,
    startLine,
    endLine: endLine ?? (startLine !== undefined ? startLine : undefined),
  };
}

/** 剥离 file:// 前缀（file:///home/u/a.ts → /home/u/a.ts；file:///C:/x → C:/x）。 */
const stripFileScheme = (path: string): string =>
  path.replace(/^file:\/\//i, "");

/**
 * 把匹配结果解析为可发给宿主 openFile 的 OS 绝对路径。
 * 绝对路径本身可能带 `.` / `..` 段，统一做词法规范化（折叠 `.` / `..`，见
 * specs/ui/file-path-links.md 场景 5）：宿主 fs 虽能靠内核解析 `..` 读到文件，
 * 但文件面板标题与自动刷新比对本就依赖这串字符串（见
 * specs/desktop/desktop-file-panel.md 场景 21/7），残留 `..` 会让标题显示怪
 * 路径、并让「工具写的路径」与「面板打开的路径」比对失配。
 */
export function resolveFilePathMatch(match: FilePathMatch): string {
  if (match.kind === "file") {
    return normalizeFilePath(stripFileScheme(match.path));
  }
  return normalizeFilePath(match.path);
}

/** 文件路径链接的元素结构（renderer 生成 HTML 用；class 供容器点击路由识别）。 */
export const fileLinkHtml = (displayText: string): string =>
  `<a href="#" class="file-path-link">${escapeHtml(displayText)}</a>`;

// 正文右剥兜底（整串匹配失败后从右往左剥离非路径字符）用的字符判定。
// 刻意保持 ASCII-only 而不同步放宽后的 SEG：含中文的合法路径在整串匹配
// （SEG 已含 \p{L} 等）阶段即被识别，不会落到此处；落到此处的是路径后
// 紧贴无空白的散文尾巴（如「/etc/hosts文件」→ 只链 /etc/hosts）。若把
// 中文也当路径字符，散文尾巴就剥不掉了。'/' 与 '\' 为分隔符，':'(行号)不吞。
const isPathChar = (c: string): boolean =>
  c === "/" || c === "\\" || /[A-Za-z0-9._~+@%-]/.test(c);

// 正文纯文本通道的识别选项：不识别 :N 行号后缀（绝对路径与扩展名要求恒开）。
const PROSE_OPTS = {
  lineSuffix: false,
} as const;

// 盘符路径的形态（盘符 + 分隔符 + 至少一段路径字符）。'\\' 在 SEG 里被排除，
// 分隔符单独列，故 Windows 路径天然由多个「段」拼接。
const WIN_PATH_CANDIDATE_RE = new RegExp(
  `^[A-Za-z]:[\\\\/](?:${SEG}+[\\\\/])*${SEG}+`,
  "u",
);
// 同上，但用于在行内文本里查找路径起点（start 钩子不锚定串首）。
const WIN_PATH_START_RE = new RegExp(`[A-Za-z]:[\\\\/]${SEG}`, "u");

/**
 * marked 行内扩展：让盘符路径在 markdown 转义规则之前被整串吃掉。
 *
 * 背景（见 specs/ui/file-path-links.md 边界情况「markdown 反斜杠转义」）：Windows
 * 路径里的 '\' 天然是 markdown 转义前缀，`…\.wave`、`…\_spec`、`…\#a` 会被当成
 * 转义序列——文本在转义点被切成多个 token（可点击范围截止在标点处），反斜杠还会
 * 从显示文本里消失。扩展比 marked 内建规则（含 escape）先执行，这里把整串盘符
 * 路径作为一个普通 text token 交给 renderer.text 链接化：反斜杠原样保留、链接覆盖
 * 整串。非盘符开头的文本仍走 markdown 原语义（`\*`、`\_`、`\|` 等仍是转义）。
 *
 * 只做「形态保护」，不判定真伪：是否符合各通道的识别规则仍由 renderer 决定。
 */
export const windowsPathInlineExtension: TokenizerExtension = {
  name: "windowsFilePath",
  level: "inline",
  start(src) {
    const m = WIN_PATH_START_RE.exec(src);
    return m ? m.index : undefined;
  },
  tokenizer(src) {
    const m = WIN_PATH_CANDIDATE_RE.exec(src);
    if (!m) return undefined;
    return { type: "text", raw: m[0], text: m[0] };
  },
};

/**
 * 正文纯文本通道：把原始（未转义）文本中的绝对路径转成 <a class="file-path-link">。
 * 返回完整 HTML（所有非链接文本均经 HTML 转义），可安全用于 dangerouslySetInnerHTML。
 * 首尾标点不进链接目标、保留为链接外普通文本；路径后紧贴的中文文本
 * （如「/etc/hosts，然后看…」）只链接路径部分，其余保持普通文本。
 */
export function linkifyFilePathText(
  rawText: string,
  mode: FilePathLinkMode = "all",
): string {
  if (!rawText) return "";
  if (mode === "off") return escapeHtml(rawText);
  const opts = { ...PROSE_OPTS, imagesOnly: mode === "images" };
  let html = "";
  let lastIndex = 0;
  for (const run of rawText.matchAll(/\S+/g)) {
    const start = run.index!;
    const rawRun = run[0];
    html += escapeHtml(rawText.slice(lastIndex, start));
    // 剥首尾标点：before/after 保留为普通文本
    let bodyStart = 0;
    let bodyEnd = rawRun.length;
    while (bodyStart < bodyEnd && LEFT_PUNCT.includes(rawRun[bodyStart]!)) {
      bodyStart++;
    }
    while (bodyEnd > bodyStart && RIGHT_PUNCT.includes(rawRun[bodyEnd - 1]!)) {
      bodyEnd--;
    }
    const before = rawRun.slice(0, bodyStart);
    const core = rawRun.slice(bodyStart, bodyEnd);
    const after = rawRun.slice(bodyEnd);

    const matched = detectFilePathToken(core, opts);
    if (matched) {
      html += escapeHtml(before);
      html += fileLinkHtml(matched.display);
      html += escapeHtml(after);
    } else {
      // 整串不是路径：可能只是中文/标点紧贴在绝对路径后（无空白分词）。
      // 从右往左剥掉非路径字符后，若剩下的是合法路径则只链接该部分。
      let cut = core.length;
      while (cut > 0 && !isPathChar(core[cut - 1]!)) cut--;
      if (cut > 0 && cut < core.length) {
        const head = detectFilePathToken(core.slice(0, cut), opts);
        if (head) {
          html += escapeHtml(before);
          html += fileLinkHtml(head.display);
          html += escapeHtml(core.slice(cut) + after);
        } else {
          html += escapeHtml(rawRun);
        }
      } else {
        html += escapeHtml(rawRun);
      }
    }
    lastIndex = start + rawRun.length;
  }
  html += escapeHtml(rawText.slice(lastIndex));
  return html;
}

// 围栏代码块通道：识别规则与行内代码通道一致（绝对路径 + 点扩展名 + :N 行号），
// 但按空白逐 token 处理，并额外剥离引号（代码里路径常写作 "/abs/a.ts"）。代码
// 原文的换行与缩进不参与分词，原样保留。
const CODE_BLOCK_LEFT_STRIP = `${LEFT_PUNCT}"'`;
const CODE_BLOCK_RIGHT_STRIP = `${RIGHT_PUNCT}"'`;

/** 代码块里的单个 token → HTML（首尾引号/标点留在链接外，保持代码原文）。 */
const codeBlockTokenHtml = (token: string, mode: FilePathLinkMode): string => {
  let start = 0;
  let end = token.length;
  while (start < end && CODE_BLOCK_LEFT_STRIP.includes(token[start]!)) start++;
  while (end > start && CODE_BLOCK_RIGHT_STRIP.includes(token[end - 1]!)) end--;
  const core = token.slice(start, end);
  if (core) {
    const matched = detectFilePathToken(core, {
      imagesOnly: mode === "images",
    });
    if (matched) {
      return (
        escapeHtml(token.slice(0, start)) +
        fileLinkHtml(matched.display) +
        escapeHtml(token.slice(end))
      );
    }
  }
  return escapeHtml(token);
};

/**
 * 围栏代码块通道：把代码块正文里的文件路径转成 <a class="file-path-link">，
 * 其余代码文本（含换行、缩进、引号）原样保留并转义。返回的 HTML 可安全用于
 * dangerouslySetInnerHTML（调用方把它放进 <pre><code>）。
 */
export function linkifyCodeBlockPaths(
  code: string,
  mode: FilePathLinkMode = "all",
): string {
  if (!code) return "";
  if (mode === "off") return escapeHtml(code);
  let html = "";
  let lastIndex = 0;
  for (const run of code.matchAll(/\S+/g)) {
    const start = run.index!;
    html += escapeHtml(code.slice(lastIndex, start));
    html += codeBlockTokenHtml(run[0], mode);
    lastIndex = start + run[0].length;
  }
  html += escapeHtml(code.slice(lastIndex));
  return html;
}

/** 剥离文本内已生成的路径链接标签（用于 markdown 链接 label 内防嵌套 <a>）。 */
export function stripFilePathLinks(html: string): string {
  return html.replace(
    /<a href="#" class="file-path-link">([\s\S]*?)<\/a>/g,
    "$1",
  );
}
