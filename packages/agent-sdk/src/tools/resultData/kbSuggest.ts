import { KB_UNAUTHORIZED } from "../knowledgeBase/kbFormatting.js";

/**
 * `kb_suggest` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * CC 没有对应物（企业知识库是我方独有能力），形状按 `grep.ts` 的口径自己定。
 *
 * 进 `data` 的只有两个字段：
 * - `term`：模型传进来的那个词。正文就是 `「差旅」的相近词：…`，没有它渲不出这句；
 *   它是短标量，不是「参数副本」那种大对象。
 * - `terms`：语料里的写法本身 —— 本工具唯一的主载荷，每一项都是一个短词，正文
 *   `差旅报销 · 出差 · 交通补贴` 就是用 ` · ` 拼它。
 *
 * 不进 `data` 的：服务端原样回复里的 `term` 回显（与入参同值，抄一遍没有信息量）。
 *
 * 失败分支（`unauthorized` / `unavailable` / `error`）的正文同样由渲染器渲出来：
 * 这三句话没有 `error` 兜底，不从 `data` 重建的话阶段 2 丢掉 `content` 之后就没有
 * 来源了。`data` 里只有判别键与那句错误文本，不放参数、堆栈这类诊断。
 */

export type KbSuggestResultData =
  | { status: "ok"; term: string; terms: string[] }
  | { status: "unauthorized" }
  | { status: "unavailable" }
  | { status: "error"; error: string };

/** 路由层 404 的正文：相近词接口没部署，不是「语料里没有这个词」。 */
const ENDPOINT_MISSING_SENTENCE =
  "知识库相近词接口不可用，请确认服务端已部署知识库";

export function renderKbSuggestResultData(data: KbSuggestResultData): string {
  switch (data.status) {
    case "ok":
      // 没有相近词也是一句结论：模型据此换自己的措辞再搜，不是失败。
      return data.terms.length === 0
        ? `没有找到「${data.term}」的相近词`
        : `「${data.term}」的相近词：${data.terms.join(" · ")}`;
    case "unauthorized":
      return KB_UNAUTHORIZED;
    case "unavailable":
      return ENDPOINT_MISSING_SENTENCE;
    case "error":
      return `知识库相近词查询失败：${data.error}`;
  }
}
