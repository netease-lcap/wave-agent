import { KB_GET_DOC_TOOL_NAME } from "../../constants/tools.js";
import type { ToolContext, ToolPlugin, ToolResult } from "../types.js";
import { fetchKbDoc } from "../../services/knowledgeBaseApi.js";
import { formatDocSummary, readText } from "./kbFormatting.js";
import {
  renderKbGetDocFailureResultData,
  renderKbGetDocResultData,
  type KbGetDocFailureResultData,
  type KbGetDocTextResultData,
} from "../resultData/kbGetDoc.js";

const KB_GET_DOC_DESCRIPTION =
  "Read one knowledge-base chunk in full, by the chunk_id shown on each kb_search hit. " +
  "Use it when a snippet is not enough context — the chunk comes back with its complete text, document title, section path and page number, " +
  "plus any parser-gap markers and image descriptions the ingestion produced. " +
  "A 404 means the chunk no longer exists or is outside what this account may see: search again rather than retrying the same id.";

const KB_GET_DOC_LEAN_PROMPT = `Read one knowledge-base chunk in full by its chunk_id (as returned by kb_search) — complete text with document title, section path and page. A 404 means the chunk was deleted or is not visible to this account.`;

export const kbGetDocTool: ToolPlugin = {
  name: KB_GET_DOC_TOOL_NAME,
  searchHint: "read one knowledge-base chunk in full after a search hit",
  config: {
    type: "function",
    function: {
      name: KB_GET_DOC_TOOL_NAME,
      description: KB_GET_DOC_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          chunk_id: {
            type: "string",
            description:
              "The chunk to read, as printed on a kb_search hit (`chunk_id=…`). Pass it back verbatim — it is the only handle this tool accepts.",
          },
        },
        required: ["chunk_id"],
      },
    },
  },
  leanPrompt: KB_GET_DOC_LEAN_PROMPT,
  formatCompactParams: (params: Record<string, unknown>) => {
    const chunkId =
      typeof params.chunk_id === "string" ? params.chunk_id.trim() : "";
    return chunkId;
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const chunkId =
      typeof args.chunk_id === "string" ? args.chunk_id.trim() : "";
    if (!chunkId) {
      return {
        success: false,
        content: "",
        error: `${KB_GET_DOC_TOOL_NAME}: missing required parameter "chunk_id"`,
      };
    }

    const outcome = await fetchKbDoc(chunkId, {
      abortSignal: context.abortSignal,
    });
    if (outcome.kind === "unauthorized") {
      const data: KbGetDocFailureResultData = { status: "unauthorized" };
      return {
        success: false,
        data,
        content: renderKbGetDocFailureResultData(data),
      };
    }
    if (outcome.kind === "not_found") {
      const data: KbGetDocFailureResultData = { status: "not_found" };
      return {
        success: false,
        data,
        content: renderKbGetDocFailureResultData(data),
      };
    }
    if (outcome.kind === "error") {
      const data: KbGetDocFailureResultData = {
        status: "error",
        error: outcome.error,
      };
      return {
        success: false,
        data,
        content: renderKbGetDocFailureResultData(data),
      };
    }

    const doc = outcome.value;
    const body = doc.content.trim();
    const data: KbGetDocTextResultData = {
      status: "ok",
      // 正文头部打印的那个 id：服务端回了就用它的，否则用入参这个。
      chunkId: readText(doc.chunkId) || chunkId,
      docId: doc.docId,
      title: doc.title,
      sectionPath: doc.sectionPath,
      page: doc.page,
      degraded: doc.degraded,
      imageCaptions: doc.imageCaptions,
      // 文档全文只在 `data` 里（阶段 2 口径），头部与正文的拼装归渲染器。
      content: body,
      chars: body.length,
    };
    return {
      success: true,
      data,
      content: renderKbGetDocResultData(data),
      shortResult: formatDocSummary(doc, body),
    };
  },
};
