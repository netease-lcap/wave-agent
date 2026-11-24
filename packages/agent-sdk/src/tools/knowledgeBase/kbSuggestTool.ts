import { KB_SUGGEST_TOOL_NAME } from "../../constants/tools.js";
import type { ToolContext, ToolPlugin, ToolResult } from "../types.js";
import { suggestKbTerms } from "../../services/knowledgeBaseApi.js";
import {
  renderKbSuggestResultData,
  type KbSuggestResultData,
} from "../resultData/kbSuggest.js";

const KB_SUGGEST_DESCRIPTION =
  "List terms that actually occur in the enterprise knowledge base and look like the one you pass. " +
  "Use it when a search came back empty or thin because of wording — the company may write 「差旅报销」 where you searched 「交通费」. " +
  "Then search again with one of the returned terms; the terms are how the corpus spells things, not a dictionary.";

const KB_SUGGEST_LEAN_PROMPT = `List terms that occur in the enterprise knowledge base and resemble the one you pass — re-word a search that returned nothing, then search again with a returned term.`;

export const kbSuggestTool: ToolPlugin = {
  name: KB_SUGGEST_TOOL_NAME,
  searchHint: "find the wording a company's documents use before searching",
  config: {
    type: "function",
    function: {
      name: KB_SUGGEST_TOOL_NAME,
      description: KB_SUGGEST_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          term: {
            type: "string",
            description:
              "The word or short phrase to find variants of, as you would type it into a search (「差旅」, 「年假」).",
          },
        },
        required: ["term"],
      },
    },
  },
  leanPrompt: KB_SUGGEST_LEAN_PROMPT,
  formatCompactParams: (params: Record<string, unknown>) => {
    const term = typeof params.term === "string" ? params.term.trim() : "";
    return `「${term}」`;
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const term = typeof args.term === "string" ? args.term.trim() : "";
    if (!term) {
      return {
        success: false,
        content: "",
        error: `${KB_SUGGEST_TOOL_NAME}: missing required parameter "term"`,
      };
    }

    const outcome = await suggestKbTerms(term, {
      abortSignal: context.abortSignal,
    });
    if (outcome.kind === "unauthorized") {
      const data: KbSuggestResultData = { status: "unauthorized" };
      return { success: false, data, content: renderKbSuggestResultData(data) };
    }
    if (outcome.kind === "not_found") {
      const data: KbSuggestResultData = { status: "unavailable" };
      return { success: false, data, content: renderKbSuggestResultData(data) };
    }
    if (outcome.kind === "error") {
      const data: KbSuggestResultData = {
        status: "error",
        error: outcome.error,
      };
      return { success: false, data, content: renderKbSuggestResultData(data) };
    }

    const terms = outcome.value.terms;
    const data: KbSuggestResultData = { status: "ok", term, terms };
    if (terms.length === 0) {
      // Same rule as an empty search: nothing to re-word with is a finding, not
      // a failure — the model should search with its own wording.
      return {
        success: true,
        data,
        content: renderKbSuggestResultData(data),
        shortResult: "没有相近词",
      };
    }
    return {
      success: true,
      data,
      content: renderKbSuggestResultData(data),
      shortResult: `相近词 ${terms.length} 个`,
    };
  },
};
