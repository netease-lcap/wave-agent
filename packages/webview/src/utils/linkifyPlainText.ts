// 纯文本区域（bash 命令输出等）的链接化：裸 http(s) URL + 文件路径。与消息
// markdown 不同，这里不经过 marked——输出是终端风格的纯文本，注入 HTML 前必须
// 完整转义非链接文本，且仅 http(s) 协议生成链接（javascript: 等危险协议不生成，
// 防注入）。文件路径按围栏代码块的同一套规则识别
// （见 specs/ui/file-path-links.md 的「bash 输出通道」），复用 linkifyCodeBlockPaths。
//
// 点击路由不在本文件处理：生成的 <a> 由容器上的 handleContentClick（desktop
// 上 localhost → 预览面板、其余 → 系统浏览器；IDE 原生处理；文件路径走
// openFile）统一接管。

import { escapeHtml, linkifyCodeBlockPaths } from "./filePathLinks";

// 剥离 URL 候选里的正文尾巴。marked 默认 url tokenizer 的 _backpedal 正则
// 只剔除 ASCII 标点（?!.,:;*_'"~()&），中文标点（。、（ 等）会被百分号编码进
// href，点击打开错误链接（如 "https://example.com。" → href 带 %E3%80%82）。
// 这里对纯文本链接化同时处理两类标点。
//
// 全角标点一律是终止符而非仅尾部：中文写作习惯里 URL 后可直接接「（注释）」
// 或「，然后」而不打空格，此时标点及其后内容属于正文，并入链接目标会得到
// 带 %EF%BC%88 的错误地址（如 "…/pull/2217（commit 说明"、
// "https://a.com/b（中文说明）后"）。真实 URL 中的非 ASCII 字符应百分号编码，
// 故把第一个全角标点之后整体交给正文是安全的。
//
// ASCII 括号语义不同（见下）：成对时是 URL 内容（如 "/foo(bar)"、
// "wiki_(disambiguation)"），保留；孤立闭括号（如 "(https://a.com)" 中的
// ")"）剥离。
const asciiPunct = "!?.,:;*_~'\"&";
const cjkPunctRe = /[，。、；：！？…（）「」『』【】《》〈〉“”‘’—]/;

export function stripTrailingUrlPunct(url: string): string {
  const cut = url.search(cjkPunctRe);
  let s = cut >= 0 ? url.slice(0, cut) : url;
  for (;;) {
    const last = s[s.length - 1];
    if (!last) break;
    if (asciiPunct.includes(last)) {
      s = s.slice(0, -1);
      continue;
    }
    if (last === ")") {
      // ASCII 成对括号是 URL 内容，保留；孤立闭括号剥离
      if (s.lastIndexOf("(", s.length - 1) >= 0) break;
      s = s.slice(0, -1);
      continue;
    }
    if (last === "(") {
      s = s.slice(0, -1);
      continue;
    }
    break;
  }
  return s;
}

// 非空白序列。URL 候选里的正文尾巴（尾部标点、全角标点及其后内容）由
// stripTrailingUrlPunct 截断，截断掉的部分随后原样显示。
const URL_RE = /https?:\/\/\S+/g;
// 空白分隔的 token：URL 与文件路径都以 token 为最小识别单位。
const RUN_RE = /\S+/g;

// URL token → <a>；正文尾巴按上述规则截断（见 stripTrailingUrlPunct）。
const urlAnchor = (rawUrl: string): string => {
  const url = stripTrailingUrlPunct(rawUrl);
  if (!/^https?:\/\/\S+$/i.test(url)) {
    // 剥离后不再是合法 http(s) URL（极端情况），原样转义整段
    return escapeHtml(rawUrl);
  }
  // 剥离/截断掉的后缀（尾部标点，或全角标点及其后的正文）作为普通文本保留
  // 显示——不进链接目标，但输出原文保持可见。
  return (
    `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>` +
    escapeHtml(rawUrl.slice(url.length))
  );
};

// 单个 token：先切出其中的 URL（保持既有行为），剩余片段按文件路径规则处理。
const linkifyRun = (run: string, workdir?: string): string => {
  let html = "";
  let last = 0;
  for (const match of run.matchAll(URL_RE)) {
    const index = match.index!;
    html += linkifyCodeBlockPaths(run.slice(last, index), workdir);
    html += urlAnchor(match[0]);
    last = index + match[0].length;
  }
  return html + linkifyCodeBlockPaths(run.slice(last), workdir);
};

// 将纯文本中的裸 http(s) URL 与文件路径转为 <a> 链接，其余文本完整 HTML 转义
// 后按原文返回（含换行与缩进）。返回的 HTML 字符串可安全用于
// dangerouslySetInnerHTML。workdir 用于归并相对路径：缺省时相对路径回退纯文本。
export function linkifyPlainText(text: string, workdir?: string): string {
  if (!text) return "";
  let html = "";
  let lastIndex = 0;
  for (const run of text.matchAll(RUN_RE)) {
    const index = run.index!;
    html += escapeHtml(text.slice(lastIndex, index));
    html += linkifyRun(run[0], workdir);
    lastIndex = index + run[0].length;
  }
  return html + escapeHtml(text.slice(lastIndex));
}
