import { KB_GET_DOC_TOOL_NAME } from "../../constants/tools.js";
import type { ToolContext, ToolPlugin, ToolResult } from "../types.js";
import { fetchKbDoc, type KbDoc } from "../../services/knowledgeBaseApi.js";
import {
  KB_UNAUTHORIZED,
  formatDegraded,
  formatDocSummary,
  formatLocation,
  readCaptions,
  readText,
} from "./kbFormatting.js";

const KB_GET_DOC_DESCRIPTION =
  "Read one knowledge-base chunk in full, by the chunk_id shown on each kb_search hit. " +
  "Use it when a snippet is not enough context — the chunk comes back with its complete text, document title, section path and page number, " +
  "plus any parser-gap markers and image descriptions the ingestion produced. " +
  "A 404 means the chunk no longer exists or is outside what this account may see: search again rather than retrying the same id.";

const KB_GET_DOC_LEAN_PROMPT = `Read one knowledge-base chunk in full by its chunk_id (as returned by kb_search) — complete text with document title, section path and page. A 404 means the chunk was deleted or is not visible to this account.`;

/** `员工手册 · 假期制度 > 婚假（第 3 页）` plus the ids and parser notes under it. */
function formatDocHeader(doc: KbDoc, requestedChunkId: string): string[] {
  const lines = [formatLocation(doc)];
  const ids = [`chunk_id=${readText(doc.chunkId) || requestedChunkId}`];
  const docId = readText(doc.docId);
  if (docId) ids.push(`doc_id=${docId}`);
  lines.push(ids.join("  "));

  const degraded = formatDegraded(doc.degraded);
  if (degraded) lines.push(degraded);
  const captions = readCaptions(doc.imageCaptions);
  if (captions.length > 0) lines.push(`图片说明：${captions.join(" / ")}`);
  return lines;
}

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
      return { success: false, content: KB_UNAUTHORIZED };
    }
    if (outcome.kind === "not_found") {
      return { success: false, content: "这个片段不存在或已删除" };
    }
    if (outcome.kind === "error") {
      return { success: false, content: `知识库取全文失败：${outcome.error}` };
    }

    const doc = outcome.value;
    const body = doc.content.trim();
    const lines = formatDocHeader(doc, chunkId);
    lines.push("", body);
    return {
      success: true,
      content: lines.join("\n"),
      shortResult: formatDocSummary(doc, body),
    };
  },
};
