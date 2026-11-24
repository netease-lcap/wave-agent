import { WEB_SEARCH_TOOL_NAME } from "../constants/tools.js";
import type { ToolContext, ToolPlugin, ToolResult } from "./types.js";
import { searchWeb, type WebSearchHit } from "../services/webSearchApi.js";
import {
  isWebSearchAvailable,
  markWebSearchUnsupported,
} from "../services/webSearchAvailability.js";
import {
  renderWebSearchResultData,
  webSearchOutputSchema,
  type WebSearchHitData,
  type WebSearchResultData,
} from "./resultData/webSearch.js";

/**
 * 入参逐字照 CC 的 WebSearch（`1022-211817B-D3o.js:2221-2223`）：三个字段、
 * `query` 最短 2 字、另有域名名单二选一。CC 内部变体的 `mode` 不暴露——那是它的
 * 检索档位，本接口没有对应参数。
 */
const WEB_SEARCH_DESCRIPTION =
  "Search the web and use the results to inform your response. " +
  "Each hit carries a title and a URL (plus a short snippet when the search provider supplies one) — no page text: " +
  "open a URL with WebFetch when you need what the page actually says. " +
  "Use this tool for anything beyond your knowledge cutoff: current events, recent releases, library versions, prices, " +
  "docs that changed after you were trained. " +
  "allowed_domains / blocked_domains narrow the hits to — or away from — specific sites; give one or the other, never both.\n\n" +
  "CRITICAL REQUIREMENT - You MUST follow this:\n" +
  '  - After answering the user\'s question, you MUST include a "Sources:" section at the end of your response\n' +
  "  - In the Sources section, list all relevant URLs from the search results as markdown hyperlinks: [Title](URL)\n" +
  "  - This is MANDATORY - never skip including sources in your response\n\n" +
  "An empty result is an answer — it means the search matched nothing, so say so rather than answering from general " +
  "knowledge. A failed search is not an empty one: the error text says which it was.";

const WEB_SEARCH_LEAN_PROMPT =
  "Search the web; results are titles + URLs (no page text — use WebFetch for the page). Use it beyond your knowledge cutoff, and cite sources as markdown links.";

/** CC's `validateInput` wording (`1022-211817B-D3o.js:2417`), minus its `Error: ` prefix. */
const DOMAIN_CONFLICT_MESSAGE =
  "Cannot specify both allowed_domains and blocked_domains in the same request";

/** A domain list as the endpoint wants it: plain strings, blanks dropped. */
function readDomains(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** `data` 只留回执与宿主卡片要的字段（契约里的原文见 `resultData/webSearch.ts`）。 */
function toHitData(hit: WebSearchHit): WebSearchHitData {
  return {
    title: hit.title,
    url: hit.url,
    ...(hit.snippet ? { snippet: hit.snippet } : {}),
  };
}

export const webSearchTool: ToolPlugin = {
  name: WEB_SEARCH_TOOL_NAME,
  // 与 `WebFetch` 同档：REPL 开启时进按需池，靠池子公告让模型知道它存在，
  // 而不是每次对话都摊平一份长描述。
  defer: true,
  searchHint:
    "search the web for current information and get titles + URLs to cite or open",
  config: {
    type: "function",
    function: {
      name: WEB_SEARCH_TOOL_NAME,
      description: WEB_SEARCH_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            minLength: 2,
            description: "The search query to use",
          },
          allowed_domains: {
            type: "array",
            items: { type: "string" },
            description: "Only include search results from these domains",
          },
          blocked_domains: {
            type: "array",
            items: { type: "string" },
            description: "Never include search results from these domains",
          },
        },
        required: ["query"],
      },
    },
  },
  leanPrompt: WEB_SEARCH_LEAN_PROMPT,
  outputSchema: webSearchOutputSchema,
  formatCompactParams: (params: Record<string, unknown>) => {
    const query = typeof params.query === "string" ? params.query.trim() : "";
    const allowed = readDomains(params.allowed_domains);
    const blocked = readDomains(params.blocked_domains);
    return [
      `「${query}」`,
      allowed.length > 0 ? `仅 ${allowed.join("、")}` : "",
      blocked.length > 0 ? `排除 ${blocked.join("、")}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const failed = (reason: string, errorCode?: string): ToolResult => {
      const data: WebSearchResultData = {
        status: "error",
        reason,
        ...(errorCode ? { errorCode } : {}),
      };
      return { success: false, data, content: renderWebSearchResultData(data) };
    };

    // 之前已经撞过 404：这个部署没有搜索能力，一个请求都不再发（脚本可能捏着
    // unregister 之前的插件引用，所以入口这里也要拦）。
    if (!isWebSearchAvailable()) {
      const data: WebSearchResultData = { status: "unsupported" };
      return { success: false, data, content: renderWebSearchResultData(data) };
    }

    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return {
        success: false,
        content: "",
        error: `${WEB_SEARCH_TOOL_NAME}: missing required parameter "query"`,
      };
    }

    const allowedDomains = readDomains(args.allowed_domains);
    const blockedDomains = readDomains(args.blocked_domains);
    // CC 在本地就拦下这条（`:2415-2420`）：服务端也会 400，但先拦省一个往返，
    // 而且模型拿到的是同一句话。其余校验（长度、域名格式）交给服务端的 400 ——
    // 重复实现只会和契约漂移。
    if (allowedDomains.length > 0 && blockedDomains.length > 0) {
      return failed(DOMAIN_CONFLICT_MESSAGE, "WEB_SEARCH_DOMAIN_CONFLICT");
    }

    const outcome = await searchWeb(
      { query, allowedDomains, blockedDomains },
      { abortSignal: context.abortSignal },
    );

    if (outcome.kind === "unsupported") {
      // 记下「本部署没有这个能力」并把自己从工具表里摘掉：之后既不再探测，
      // 也不再出现在模型看到的工具声明里。
      markWebSearchUnsupported();
      context.toolManager?.unregister(WEB_SEARCH_TOOL_NAME);
      const data: WebSearchResultData = { status: "unsupported" };
      return { success: false, data, content: renderWebSearchResultData(data) };
    }

    if (outcome.kind === "unauthorized") {
      const data: WebSearchResultData = {
        status: "unauthorized",
        reason: outcome.reason,
      };
      return { success: false, data, content: renderWebSearchResultData(data) };
    }

    if (outcome.kind === "error") {
      return failed(outcome.reason, outcome.errorCode);
    }

    const value = outcome.value;
    // 命中与左扔条数一起进 `data`：`leftOut` 是服务端唯一能告诉我们「你的域名
    // 名单扔掉了多少」的信号，它进不了回执就再也读不回来了。
    const data: WebSearchResultData = {
      status: "ok",
      query: value.query,
      results: value.results.map(toHitData),
      leftOut: value.leftOut,
      ...(value.durationSeconds !== undefined
        ? { durationSeconds: value.durationSeconds }
        : {}),
      ...(value.searchCount !== undefined
        ? { searchCount: value.searchCount }
        : {}),
    };
    if (value.results.length === 0) {
      // 不是失败：「搜了但没命中」正是模型该说出来的一句话（契约与 CC 同口径）。
      return {
        success: true,
        data,
        content: renderWebSearchResultData(data),
        shortResult:
          value.leftOut > 0
            ? `没有结果 · 过滤掉 ${value.leftOut} 条`
            : "没有结果",
      };
    }

    return {
      success: true,
      data,
      content: renderWebSearchResultData(data),
      shortResult:
        value.leftOut > 0
          ? `${value.results.length} 个结果 · 过滤掉 ${value.leftOut} 条`
          : `${value.results.length} 个结果`,
    };
  },
};
