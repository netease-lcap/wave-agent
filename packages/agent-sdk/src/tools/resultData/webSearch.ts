/**
 * `WebSearch` 的 `data` 形状与 `data → 文本` 渲染器（issue #3055 的分工：结构化真相进
 * `data`，模型读到的文本由这里现场渲染）。
 *
 * 文本逐字照 CC 的 `mapToolResultToToolResultBlockParam`
 * （`~/.cache/cc-reference/2.1.331-linux-x64/js/1022-211817B-D3o.js:2770-2813`）：
 *
 * ```
 * Web search results for query: "<query>"
 * （空行）
 * Links: [{"title":"…","url":"…"}]        ← JSON.stringify，不是 markdown 列表
 * （空行）
 * REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.
 * ```
 *
 * 三个要点：
 *
 * - **链接是 JSON 数组**。CC 用 `JSON.stringify` 交 `Links:`，模型要「哪些链接」时读的是
 *   数组而不是渲染后的列表；换成 `- [title](url)` 会让这段回执与 CC 不再是同一份数据。
 * - **`No links found.` 不是失败**。`content: []` 是「搜了但没命中」，与服务端的空组
 *   语义一致——把它删掉或渲成错误，模型就分不清「网上没有」和「搜索坏了」。
 * - **`leftOut` 是单独一段**。CC 把它作为 `results` 里一条字符串参与拼接，所以它落在
 *   `Links` 之后、`REMINDER` 之前（`:2526`，单数复数跟着 `P(n,"result")`）。
 *
 * `snippet` 留在 `data` 里但**不进这段文本**：CC 的语义是模型只看 `title` + `url`
 * （摘要只进 PostToolUse hooks 与 UI），给模型 200 字的摘要会诱导它拿摘要硬答，
 * 而正文的正路是 `WebFetch` 打开 URL。
 */
/** 一条命中进 `data` 的字段，与服务端契约逐字段对应。 */
export interface WebSearchHitData {
  title: string;
  url: string;
  /** 服务端截到 ≤200 字的摘要；只在 `data` 里，回执文本不带。 */
  snippet?: string;
}

export type WebSearchResultData =
  | {
      status: "ok";
      query: string;
      results: WebSearchHitData[];
      /** 被域名名单硬过滤掉的条数；0 表示没有过滤。 */
      leftOut: number;
      durationSeconds?: number;
      searchCount?: number;
    }
  /** 404：本部署没有这个能力（服务端开关没开）。 */
  | { status: "unsupported" }
  /** 401 / 403：账号这一侧不行（未登录、非企业成员、license 闸门）。 */
  | { status: "unauthorized"; reason: string }
  | { status: "error"; reason: string; errorCode?: string };

/** CC 那句固定结尾。 */
const SOURCES_REMINDER =
  "REMINDER: You MUST include the sources above in your response to the user using markdown hyperlinks.";

/**
 * 404 那句。它同时是「模型这次读到的错误」和「之后这个工具不再出现」的解释，
 * 所以既说清能力不存在，也明说别再试。
 */
const UNSUPPORTED_SENTENCE =
  "Web search is not available on this server (the deployment has the capability switched off). Do not call WebSearch again in this session — answer without it, or ask the user to open the page themselves.";

/**
 * CC 的拼接顺序，逐段对应 `:2791-2813`。
 *
 * 注意 `Links` 块结尾自带空行、而 reminder 自带一个前导换行，所以两者之间实际是
 * **两个**空行——这是 CC 的输出，不是笔误：`links + "\n\n"` 再 `+ "\nREMINDER…"`。
 * 照抄它，回执才能与 CC 逐字相同。
 */
export function renderWebSearchResultData(data: WebSearchResultData): string {
  switch (data.status) {
    case "ok": {
      const links = data.results.map((hit) => ({
        title: hit.title,
        url: hit.url,
      }));
      let text = `Web search results for query: "${data.query}"\n\n`;
      text +=
        links.length > 0
          ? `Links: ${JSON.stringify(links)}\n\n`
          : "No links found.\n\n";
      if (data.leftOut > 0) {
        const noun = data.leftOut === 1 ? "result" : "results";
        text += `${data.leftOut} ${noun} left out by allowed_domains or blocked_domains.\n\n`;
      }
      text += `\n${SOURCES_REMINDER}`;
      return text.trim();
    }
    case "unsupported":
      return UNSUPPORTED_SENTENCE;
    case "unauthorized":
      return `Web search needs a signed-in enterprise account: ${data.reason}`;
    case "error":
      return `Web search failed: ${data.reason}`;
  }
}

/**
 * `WebSearch` 的 `data` 形状（JSON Schema），供 REPL 把工具签名渲染成真实返回类型
 * （spec `core/repl-tool.md`「公告分档呈现」）。与 {@link WebSearchResultData} 逐字段
 * 对应，改一处必须改另一处。
 */
export const webSearchOutputSchema: Record<string, unknown> = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["ok", "unsupported", "unauthorized", "error"],
      description:
        'Outcome kind. "ok" also covers "searched but nothing matched" (results is then empty).',
    },
    query: {
      type: "string",
      description: "The query the search ran with, echoed by the server.",
    },
    results: {
      type: "array",
      description:
        "Hits in provider order; empty means the search matched nothing (not a failure).",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "Title of the hit." },
          url: { type: "string", description: "URL to open with WebFetch." },
          snippet: {
            type: "string",
            description:
              "Short page excerpt (≤200 chars) when the provider supplied one; present in data, never in the model-facing text.",
          },
        },
        required: ["title", "url"],
        additionalProperties: false,
      },
    },
    leftOut: {
      type: "number",
      description:
        "Hits dropped by allowed_domains / blocked_domains, as counted by the server.",
    },
    durationSeconds: {
      type: "number",
      description: "Server-side duration of the search in seconds.",
    },
    searchCount: {
      type: "number",
      description: "Searches performed for this call; always 1 by contract.",
    },
    reason: {
      type: "string",
      description:
        "One model-facing sentence describing the failure (only for unauthorized / error).",
    },
    errorCode: {
      type: "string",
      description:
        "The server's WEB_SEARCH_* code when it sent one, e.g. WEB_SEARCH_RATE_LIMITED.",
    },
  },
  required: ["status"],
  additionalProperties: false,
};
