// 纯文本区域（bash 命令输出等）的裸 http(s) URL 链接化。与消息 markdown
// 不同，这里不经过 marked——输出是终端风格的纯文本，注入 HTML 前必须完整
// 转义非 URL 文本，且仅 http(s) 协议生成链接（javascript: 等危险协议不生成，
// 防注入）。
//
// 点击路由不在本文件处理：生成的 <a> 由容器上的 handleContentClick（desktop
// 上 localhost → 预览面板、其余 → 系统浏览器；IDE 原生处理）统一接管。

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

const escapeHtml = (s: string): string =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

// 非空白序列。URL 尾部标点由 stripTrailingUrlPunct 在候选上剥离。
const URL_RE = /https?:\/\/\S+/g;

// 将纯文本中的裸 http(s) URL 转为 <a> 链接，其余文本完整 HTML 转义后按
// 原文返回。返回的 HTML 字符串可安全用于 dangerouslySetInnerHTML。
export function linkifyPlainText(text: string): string {
  if (!text) return "";
  let html = "";
  let lastIndex = 0;
  for (const match of text.matchAll(URL_RE)) {
    const rawUrl = match[0];
    const index = match.index!;
    html += escapeHtml(text.slice(lastIndex, index));
    const url = stripTrailingUrlPunct(rawUrl);
    if (/^https?:\/\/\S+$/i.test(url)) {
      html += `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
      // 剥离掉的后缀：含开括号的成对中文括号（注释/说明，如
      // "（帮助）"）整体丢弃，纯尾部标点（如 "。"、"）"）作为普通文本
      // 保留显示——标点不进链接目标，但输出原文保持可见。
      const remainder = rawUrl.slice(url.length);
      const hasOpeningBracket = Object.values(closingPairs).some((open) =>
        remainder.includes(open),
      );
      if (!hasOpeningBracket) html += escapeHtml(remainder);
    } else {
      // 剥离后不再是合法 http(s) URL（极端情况），原样转义整段
      html += escapeHtml(rawUrl);
    }
    lastIndex = index + rawUrl.length;
  }
  html += escapeHtml(text.slice(lastIndex));
  return html;
}
