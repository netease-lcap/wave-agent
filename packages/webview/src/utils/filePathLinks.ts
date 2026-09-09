// 助手 markdown 文本中文件路径的识别与链接化（见 specs/ui/file-path-links.md），
// 对齐 Claude AI 的双通道规则：
//   - 行内代码（反引号整串）：任意路径形式，要求 ≥1 斜杠 + 点扩展名，
//     支持 :N / :N-M 行号后缀；相对路径仅在此通道识别。
//   - 正文纯文本：仅识别无歧义的绝对路径形式（POSIX /…、Windows 盘符、
//     file:///…），不要求扩展名，但 POSIX 绝对路径至少包含两级目录
//     （单独的 `/foo` 不识别，规避散文中的斜杠误判）。
// ~/… 是识别候选但不生成链接（wave 各宿主 openFile 按 OS 绝对路径处理，
// webview 无宿主用户主目录可展开），交由渲染层回退为普通文本。
//
// 本模块只做纯识别与字符串链接化，不接触 DOM/React：行内代码通道与正文
// 通道的拼装在 Message.tsx 的 marked renderer 中完成，点击解析复用这里。

// marked（escape encode=true）只对 & < > " ' 做实体转义，这里做精确逆操作。
const ENTITY_MAP: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
};

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
  /** posix 绝对 / win 盘符绝对 / file:/// 绝对 / rel 相对（仅行内代码通道） */
  kind: "posix" | "win" | "file" | "rel";
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

// 相对路径（仅行内代码通道）：可选 ./ ../ 前缀 + ≥1 级目录 + 末段带扩展名
// （点后至少一个 ASCII 字母数字，扩展名内不再含点，防把句尾句号吞进路径）。
const REL_RE = new RegExp(
  `^(?:\\.{1,2}\\/)?(?:${SEG}+\\/)+${SEG}*\\.[A-Za-z0-9][A-Za-z0-9_-]*$`,
  "u",
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
  if (REL_RE.test(body)) return "rel";
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
 * @param opts.allowRelative 是否允许相对路径（仅行内代码通道传 true）
 * @param opts.requireExtension 是否要求点扩展名（行内代码通道规则）
 * @param opts.lineSuffix 是否解析尾部 :N / :N-M 行号后缀（仅行内代码通道；
 *   false 时正文纯文本不吞入行号，规避把散文中的冒号当行号）
 */
export function detectFilePathToken(
  token: string,
  opts: {
    allowRelative?: boolean;
    requireExtension?: boolean;
    lineSuffix?: boolean;
  } = {},
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
  if (kind === "rel" && !opts.allowRelative) return null;
  // 扩展名检查：行内代码通道（requireExtension）恒要求点扩展名；正文纯文本
  // 通道（requireExtension=false）对纯 ASCII 绝对路径不要求（/etc/hosts 可点），
  // 但路径一旦含非 ASCII 字符（中文等）则必须带 ASCII 点扩展名收尾——否则
  // 散文里「/张三/李四」「参考 /etc/hosts文件」这类中文尾巴会被整体吞进链接，
  // 造成死链。真实含中文文件名的路径（报表.xlsx、CodeChat桌.html、笔记.md）
  // 均有扩展名，不受影响。
  const needsExt = opts.requireExtension || /[\u0080-\u{10ffff}]/u.test(body);
  if (kind !== "rel" && needsExt && !HAS_EXT_RE.test(body)) {
    return null;
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
 * 相对路径需要 workdir 归并；无 workdir（宿主未提供）→ null（调用方应回退纯文本）。
 */
export function resolveFilePathMatch(
  match: FilePathMatch,
  workdir?: string,
): string | null {
  if (match.kind === "rel") {
    if (!workdir) return null;
    const base = workdir.replace(/[\\/]+$/, "");
    return `${base}/${match.path.replace(/\\/g, "/")}`;
  }
  if (match.kind === "file") return stripFileScheme(match.path);
  return match.path;
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

// 正文纯文本通道的识别选项：相对路径与 :N 行号后缀都不识别。
const PROSE_OPTS = {
  allowRelative: false,
  requireExtension: false,
  lineSuffix: false,
} as const;

/**
 * 正文纯文本通道：把原始（未转义）文本中的绝对路径转成 <a class="file-path-link">。
 * 返回完整 HTML（所有非链接文本均经 HTML 转义），可安全用于 dangerouslySetInnerHTML。
 * 首尾标点不进链接目标、保留为链接外普通文本；路径后紧贴的中文文本
 * （如「/etc/hosts，然后看…」）只链接路径部分，其余保持普通文本。
 */
export function linkifyFilePathText(rawText: string): string {
  if (!rawText) return "";
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

    const matched = detectFilePathToken(core, PROSE_OPTS);
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
        const head = detectFilePathToken(core.slice(0, cut), PROSE_OPTS);
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

/** 剥离文本内已生成的路径链接标签（用于 markdown 链接 label 内防嵌套 <a>）。 */
export function stripFilePathLinks(html: string): string {
  return html.replace(
    /<a href="#" class="file-path-link">([\s\S]*?)<\/a>/g,
    "$1",
  );
}
