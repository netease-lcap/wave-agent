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

// 剥离裸 URL 尾部的 ASCII/中文标点。marked 默认 url tokenizer 的
// _backpedal 正则只剔除 ASCII 标点（?!.,:;*_'"~()&），中文标点（。、（ 等）
// 会被百分号编码进 href，点击打开错误链接（如 "https://example.com。" →
// href 带 %E3%80%82）。这里对纯文本链接化同时处理两类标点。
//
// 注意括号语义差异：ASCII 括号成对时是 URL 内容（如 "/foo(bar)"、
// "wiki_(disambiguation)"），保留；孤立闭括号（如 "(https://a.com)" 中的
// ")"）剥离。中文括号成对时多为注释（如 "（帮助）"），整体剥离。
const asciiPunct = "!?.,:;*_~'\"&";
const plainCjkPunct = "，。、；：！？…";

// 成对中文括号整体剥离（如 "（帮助文档）"），孤立开括号（如 "（"）也剥掉。
const closingPairs: Record<string, string> = {
  "）": "（",
  "」": "「",
  "』": "『",
  "】": "【",
};

export function stripTrailingUrlPunct(url: string): string {
  let s = url;
  for (;;) {
    const last = s[s.length - 1];
    if (!last) break;
    if (asciiPunct.includes(last) || plainCjkPunct.includes(last)) {
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
    const open = closingPairs[last];
    if (open) {
      const openIdx = s.lastIndexOf(open);
      if (openIdx >= 0) {
        s = s.slice(0, openIdx); // 成对中文括号（注释/说明）整体剥离
        continue;
      }
      s = s.slice(0, -1);
      continue;
    }
    if (Object.values(closingPairs).includes(last)) {
      s = s.slice(0, -1); // 孤立中文开括号
      continue;
    }
    break;
  }
  return s;
}

// 非空白序列。URL 尾部标点由 stripTrailingUrlPunct 在候选上剥离。
const URL_RE = /https?:\/\/\S+/g;
// 空白分隔的 token：URL 与文件路径都以 token 为最小识别单位。
const RUN_RE = /\S+/g;

// URL token → <a>；尾部标点按既有规则剥离（见 stripTrailingUrlPunct）。
const urlAnchor = (rawUrl: string): string => {
  const url = stripTrailingUrlPunct(rawUrl);
  if (!/^https?:\/\/\S+$/i.test(url)) {
    // 剥离后不再是合法 http(s) URL（极端情况），原样转义整段
    return escapeHtml(rawUrl);
  }
  let html = `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
  // 剥离掉的后缀：含开括号的成对中文括号（注释/说明，如
  // "（帮助）"）整体丢弃，纯尾部标点（如 "。"、"）"）作为普通文本
  // 保留显示——标点不进链接目标，但输出原文保持可见。
  const remainder = rawUrl.slice(url.length);
  const hasOpeningBracket = Object.values(closingPairs).some((open) =>
    remainder.includes(open),
  );
  if (!hasOpeningBracket) html += escapeHtml(remainder);
  return html;
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
