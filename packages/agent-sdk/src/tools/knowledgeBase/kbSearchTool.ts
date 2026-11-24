import { KB_SEARCH_TOOL_NAME } from "../../constants/tools.js";
import type { ToolContext, ToolPlugin, ToolResult } from "../types.js";
import {
  KB_SEARCH_DEFAULT_LIMIT,
  KB_SEARCH_MAX_LIMIT,
  searchKnowledgeBase,
  type KbHit,
} from "../../services/knowledgeBaseApi.js";
import { countDocuments } from "./kbFormatting.js";
import {
  renderKbSearchResultData,
  type KbSearchHitData,
  type KbSearchResultData,
} from "../resultData/kbSearch.js";

const KB_SEARCH_DESCRIPTION =
  "Search the enterprise knowledge base — the documents your organization uploaded (handbooks, policies, process docs). " +
  "Only documents ingested for the signed-in enterprise are searched: tenant and visibility filtering happen on the server, " +
  "so there is nothing to scope and no other tenant is reachable. " +
  `Each call returns 3-5 hits (default ${KB_SEARCH_DEFAULT_LIMIT}, max ${KB_SEARCH_MAX_LIMIT}), and a hit carries the document title, ` +
  "its section path, the page number when the source had paging, and a short snippet — not the full text. " +
  "Call kb_get_doc with a hit's chunk_id when the snippet is not enough context. " +
  "If you are not sure how the company words something (「婚假」 vs 「婚姻登记」), call kb_suggest first and search again with a term " +
  "that actually occurs in the corpus. " +
  "An empty result is an answer: it means the documents do not cover the question — say so rather than answering from general knowledge.";

const KB_SEARCH_LEAN_PROMPT = `Search the enterprise knowledge base's ingested documents. Returns 3-5 hits (title, section path, page, snippet — no full text); call kb_get_doc with a chunk_id for the context around a hit, and kb_suggest when the wording is uncertain. No hits means the documents do not cover it — say that instead of guessing.`;

/**
 * `top_k` as the number to send, or an error message.
 *
 * A non-integer is rejected (the model should pass a count, and a NaN would be
 * sent as `null`). An over-large value is clamped instead: the server clamps to
 * the same ceiling, so a round trip to learn that buys nothing.
 */
function readTopK(raw: unknown): number | string {
  if (raw === undefined || raw === null) return KB_SEARCH_DEFAULT_LIMIT;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 1) {
    return `top_k must be a positive integer (got ${JSON.stringify(raw)})`;
  }
  return Math.min(raw, KB_SEARCH_MAX_LIMIT);
}

/**
 * The fields that go into `data`; the rest of the server's hit stays out of it
 * (see `resultData/kbSearch.ts` for each field's reason). Copied verbatim, with
 * no trimming: the renderer reads every one of them through `readText`, exactly
 * as this file used to.
 */
function toSearchHitData(hit: KbHit): KbSearchHitData {
  return {
    chunkId: hit.chunkId,
    docId: hit.docId,
    title: hit.title,
    sectionPath: hit.sectionPath,
    page: hit.page,
    score: hit.score,
    degraded: hit.degraded,
    snippet: hit.snippet,
  };
}

export const kbSearchTool: ToolPlugin = {
  name: KB_SEARCH_TOOL_NAME,
  searchHint:
    "search the company's documents (handbooks, policies, processes) and get cited snippets",
  config: {
    type: "function",
    function: {
      name: KB_SEARCH_TOOL_NAME,
      description: KB_SEARCH_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "What to look for, in the words the documents would use — a short phrase beats a whole question (「婚假」, not 「我想知道婚假该怎么申请」).",
          },
          top_k: {
            type: "number",
            description: `How many hits to return (default ${KB_SEARCH_DEFAULT_LIMIT}, max ${KB_SEARCH_MAX_LIMIT}). Keep it small — 3 to 5 — and search again with better wording rather than reading 10 hits at once.`,
          },
        },
        required: ["query"],
      },
    },
  },
  leanPrompt: KB_SEARCH_LEAN_PROMPT,
  formatCompactParams: (params: Record<string, unknown>) => {
    const query = typeof params.query === "string" ? params.query.trim() : "";
    const topK =
      typeof params.top_k === "number" ? `(top_k=${params.top_k})` : "";
    return `「${query}」${topK}`;
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return {
        success: false,
        content: "",
        error: `${KB_SEARCH_TOOL_NAME}: missing required parameter "query"`,
      };
    }
    const topK = readTopK(args.top_k);
    if (typeof topK === "string") {
      return {
        success: false,
        content: "",
        error: `${KB_SEARCH_TOOL_NAME}: ${topK}`,
      };
    }

    const outcome = await searchKnowledgeBase(query, topK, {
      abortSignal: context.abortSignal,
    });
    if (outcome.kind === "unauthorized") {
      const data: KbSearchResultData = { status: "unauthorized" };
      return { success: false, data, content: renderKbSearchResultData(data) };
    }
    if (outcome.kind === "not_found") {
      // Search has no 404 of its own; a routed 404 means the endpoint is not
      // deployed for this server, which is a failure, not an empty library.
      const data: KbSearchResultData = { status: "unavailable" };
      return { success: false, data, content: renderKbSearchResultData(data) };
    }
    if (outcome.kind === "error") {
      const data: KbSearchResultData = {
        status: "error",
        error: outcome.error,
      };
      return { success: false, data, content: renderKbSearchResultData(data) };
    }

    const hits = outcome.value.hits;
    // 原始命中与归一化的 `hits` 一起进 `data`：宿主引用卡读前者（阶段 2 之前
    // 它是 `ToolResult.metadata.citations`），正文只读后者。
    const data: KbSearchResultData = {
      status: "ok",
      hits: hits.map(toSearchHitData),
      citations: hits,
    };
    if (hits.length === 0) {
      // Not an error: "the documents do not say" is exactly what the model is
      // supposed to be able to conclude (spec 企业知识库·场景 4).
      return {
        success: true,
        data,
        content: renderKbSearchResultData(data),
        shortResult: "未命中",
      };
    }

    return {
      success: true,
      data,
      content: renderKbSearchResultData(data),
      shortResult: `命中 ${hits.length} 条 · ${countDocuments(hits)} 个文档`,
    };
  },
};
