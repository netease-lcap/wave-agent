import {
  KB_UNAUTHORIZED,
  formatDegraded,
  formatLocation,
  readCaptions,
  readText,
} from "../knowledgeBase/kbFormatting.js";

/**
 * `kb_get_doc` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 阶段 1）。
 *
 * CC 没有对应物（企业知识库是我方独有能力），形状按 `grep.ts` / `skill.ts` 的口径
 * 自己定。阶段 2 起 **ok 分支的正文也在 `data.content` 里**（文档全文，用户明确选的
 * 「搬进 data」：它本来就落盘在 `content` 里，搬过去体积不变），所以这一支渲得出
 * 全文，和 `kb_search` 一样。
 *
 * `data` 里的字段：
 * - `content`：文档全文（工具已 trim），正文的最后一段。
 * - `chunkId` / `docId` / `title` / `sectionPath` / `page`：正文第一、二行
 *   （`员工手册 · 假期制度 > 婚假（第 3 页）` + `chunk_id=…  doc_id=…`）就是它们渲的。
 *   服务端没回 `chunkId` 时用**入参那个 id** 兜底，与正文头部同一份值。
 * - `degraded` / `imageCaptions`：正文里 `解析降级：…` 与 `图片说明：…` 两行；都是
 *   短字符串数组，且是「这份文档没被完整解析」的唯一信号，不能丢。
 * - `chars`：正文（trim 后）的长度 —— 折叠行那句 `132 字` 用它（等于
 *   `content.length`，阶段 1 就有的字段，留着不动）。
 *
 * 不进 `data` 的只有 `blockType`：服务端给的块类型，正文、折叠行、引用卡都不读它 ——
 * 抄进来只是一份没人用的副本。
 *
 * 失败分支（`unauthorized` / `not_found` / `error`）的正文同样从 `data` 重建：这三句
 * 话没有 `error` 兜底（工具只给了 `content`），不从 `data` 重建的话阶段 2 丢掉
 * `content` 之后就没有来源了。`not_found` 在这里的含义是「这个片段不存在或已删除」
 * （与检索那边的「接口没部署」不是一回事）。
 */

/** 读到的那一段：头部那几行的来源 + 文档全文。 */
export interface KbGetDocTextResultData {
  status: "ok";
  /** 正文头部 `chunk_id=…` 的那个 id；服务端没回时是入参的 id。 */
  chunkId: string;
  /** 正文头部 `doc_id=…` 的文档 id，没有就不打印。 */
  docId?: string;
  title?: string;
  sectionPath?: string;
  page?: number;
  /** 解析降级标记，正文渲成 `解析降级：emf_or_chart`。 */
  degraded?: string[];
  /** 解析器为这块产出的图片说明，正文渲成 `图片说明：a / b`。 */
  imageCaptions?: string[];
  /** 文档全文（工具已 trim），正文的最后一段。 */
  content: string;
  /** 正文（trim 后）的字符数，折叠行的 `N 字`。 */
  chars: number;
}

export type KbGetDocFailureResultData =
  | { status: "unauthorized" }
  | { status: "not_found" }
  | { status: "error"; error: string };

export type KbGetDocResultData =
  | KbGetDocTextResultData
  | KbGetDocFailureResultData;

/**
 * 三个失败分支的正文。单独出一个入口是因为它永远有正文，而 ok 分支要拼头部；
 * 实现只有这一份，两个出口共用。
 */
export function renderKbGetDocFailureResultData(
  data: KbGetDocFailureResultData,
): string {
  switch (data.status) {
    case "unauthorized":
      return KB_UNAUTHORIZED;
    case "not_found":
      return "这个片段不存在或已删除";
    case "error":
      return `知识库取全文失败：${data.error}`;
  }
}

/**
 * ok 分支的正文 = 头部几行（地点、id、解析降级、图片说明）+ 空行 + 文档全文。
 *
 * 头部与 `kbFormatting` 里的格式化函数是同一份实现（`formatLocation` /
 * `formatDegraded` / `readCaptions`），所以「搬进 `data`」这一步不会改动任何一个字：
 * `docId` 等原始值按同一套 `readText` 规则归一化，缺了就整行不打印。
 */
export function renderKbGetDocTextResultData(
  data: KbGetDocTextResultData,
): string {
  const lines = [formatLocation(data)];
  const ids = [`chunk_id=${data.chunkId}`];
  const docId = readText(data.docId);
  if (docId) ids.push(`doc_id=${docId}`);
  lines.push(ids.join("  "));

  const degraded = formatDegraded(data.degraded);
  if (degraded) lines.push(degraded);
  const captions = readCaptions(data.imageCaptions);
  if (captions.length > 0) lines.push(`图片说明：${captions.join(" / ")}`);
  lines.push("", data.content);
  return lines.join("\n");
}

export function renderKbGetDocResultData(data: KbGetDocResultData): string {
  return data.status === "ok"
    ? renderKbGetDocTextResultData(data)
    : renderKbGetDocFailureResultData(data);
}
