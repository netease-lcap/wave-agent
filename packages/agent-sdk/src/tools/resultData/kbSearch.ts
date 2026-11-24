import {
  KB_UNAUTHORIZED,
  collapseWhitespace,
  formatDegraded,
  formatLocation,
  readText,
} from "../knowledgeBase/kbFormatting.js";
// 只借类型：`import type` 编译后不留 import，宿主读路径不会因此拖进 auth 服务。
import type { KbHit } from "../../services/knowledgeBaseApi.js";

/**
 * `kb_search` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * 这个工具 CC 没有对应物（企业知识库是我方独有能力），所以没有现成的 outputSchema
 * 可抄；形状按 `grep.ts` 的口径自己定 —— **只放渲染那段文本真正需要的结构化信息**，
 * 大字段一律不进 `data`。
 *
 * 进 `data` 的：
 * - 每条命中的 `chunkId` / `title` / `sectionPath` / `page`：正文那行
 *   `[1] 员工手册 · 假期制度 > 婚假（第 3 页）  chunk_id=…` 就是它们的渲染，都是
 *   短标量。`chunkId` 尤其是 `kb_get_doc` 的唯一句柄，所以它必须留在结构化载荷里。
 * - `degraded`：正文的 `解析降级：emf_or_chart` 那句，短字符串数组。
 * - `snippet`：命中片段，本工具的主载荷（与 `Grep` 的匹配行、`Read` 的正文同一档）。
 *   它不是文档正文的副本 —— 服务端已经截短，全文归 `kb_get_doc`（那边因此渲不出
 *   文本，见 `kbGetDoc.ts`）；但没有它，这段正文一个字都拼不出来。
 * - `docId` / `score`：正文不打印。留着是因为折叠行那句 `命中 3 条 · 2 个文档` 要按
 *   `docId` 去重，`score` 是服务端给的唯一排序信号 —— 二者都是进不了正文的短标量，
 *   丢进 `content` 之后就再也读不回来了。
 *
 * 不进 `data` 的：
 * - `query`：模型自己刚传的参数，正文也不打印它（回传等于落盘翻倍）。
 *
 * 命中的原始服务端对象另存在 `ok` 分支的 `citations`（阶段 2 从
 * `ToolResult.metadata.citations` 搬过来）：webview 的引用卡要读 title / page /
 * sectionPath 之外的字段，服务端多加的字段也得原样透传，所以不做归一化。
 *
 * 失败分支（`unauthorized` / `unavailable` / `error`）的正文同样由渲染器渲出来：
 * 这三句话没有 `error` 兜底（工具只给了 `content`），若不从 `data` 重建，阶段 2
 * 丢掉 `content` 之后它们就没有来源了。`data` 里只有判别键与那句错误文本，不放
 * 参数、堆栈这类诊断。
 */

/** 一条命中里进 `data` 的字段。服务端字段一律可选，缺了按「没有」渲染。 */
export interface KbSearchHitData {
  /** 本片段 id，正文的 `chunk_id=…`，也是 `kb_get_doc` 唯一的入参。 */
  chunkId?: string;
  /** 所属文档 id：正文不打印它，折叠行的文档数按它去重。 */
  docId?: string;
  title?: string;
  /** 文档内标题路径（服务端按标题层级拼出来的 `假期制度 > 婚假`）。 */
  sectionPath?: string;
  /** 1-based 页码；没有分页的来源（docx、多数 Markdown）没有这个字段。 */
  page?: number;
  /**
   * 服务端排序分。正文与折叠行都不用它，但它是这次检索里唯一的排序信号，
   * 也是脚本拿得到、`content` 里读不到的东西。
   */
  score?: number;
  /** 解析降级标记（`emf_or_chart` …），正文渲成 `解析降级：…`。 */
  degraded?: string[];
  /** 命中片段（服务端已截短的一段，不是文档全文）。 */
  snippet?: string;
}

export type KbSearchResultData =
  | {
      status: "ok";
      hits: KbSearchHitData[];
      /**
       * 原始命中对象，一条都没命中时是空数组（宿主引用卡用，见文件头）。
       * 归一化过的 `hits` 只留了正文与折叠行要用的字段，服务端的其它字段走这里。
       */
      citations?: KbHit[];
    }
  | { status: "unauthorized" }
  | { status: "unavailable" }
  | { status: "error"; error: string };

/** 一条都没命中时的正文。它是一句结论，不是错误（spec 企业知识库·场景 4）。 */
const NO_HITS_SENTENCE = "没有检索到相关内容";

/** 路由层 404 的正文：检索接口没部署，不是「库里没有」。 */
const ENDPOINT_MISSING_SENTENCE =
  "知识库检索接口不可用，请确认服务端已部署知识库";

/**
 * 一条命中在模型侧的样子：
 *
 * `[1] 员工手册 · 假期制度 > 婚假（第 3 页）  chunk_id=…`
 * `婚假申请流程：提前三个工作日提交…`
 *
 * 原样搬自 `kbSearchTool.ts`（措辞一字未动）：`chunk_id` 挂在地点行上，因为它是
 * `kb_get_doc` 唯一接受的句柄 —— 只有 snippet 时，模型没法自己去读全文。
 */
function formatHitBlock(hit: KbSearchHitData, index: number): string {
  const header = `[${index + 1}] ${formatLocation(hit)}`;
  const extras = [
    readText(hit.chunkId) ? `chunk_id=${readText(hit.chunkId)}` : "",
    formatDegraded(hit.degraded),
  ].filter(Boolean);
  const snippet = collapseWhitespace(readText(hit.snippet));
  return [
    extras.length > 0 ? `${header}  ${extras.join("  ")}` : header,
    snippet,
  ]
    .filter(Boolean)
    .join("\n");
}

export function renderKbSearchResultData(data: KbSearchResultData): string {
  switch (data.status) {
    case "ok":
      return data.hits.length === 0
        ? NO_HITS_SENTENCE
        : data.hits.map(formatHitBlock).join("\n\n");
    case "unauthorized":
      return KB_UNAUTHORIZED;
    case "unavailable":
      return ENDPOINT_MISSING_SENTENCE;
    case "error":
      return `知识库检索失败：${data.error}`;
  }
}
