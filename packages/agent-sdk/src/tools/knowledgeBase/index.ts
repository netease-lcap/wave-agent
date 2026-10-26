/**
 * The enterprise knowledge base's three retrieval tools.
 *
 * They are function tools, never an MCP server: an MCP tool has no
 * `formatCompactParams` and no `shortResult`, so the CLI, the webview and the
 * IM bridge would all show the tool name and raw JSON — the search term and the
 * hit count would never reach the user (spec 企业知识库·工具调用在对话里可读).
 *
 * Registration is gated (see `knowledgeBaseAvailability.ts`): off unless
 * `enableKnowledgeBase` says otherwise, because the capability pulls enterprise
 * documents into every conversation's context. With the gate closed the tools
 * are not registered at all, so no tool description — and therefore no prompt
 * paragraph — mentions the knowledge base, and the model never promises a search
 * it cannot run.
 *
 * The gate is evaluated by `ToolManager.initializeBuiltInTools()` (alongside
 * Artifact and Exec), not here: that is what makes the settings-page switch
 * apply on the next turn instead of only to a new session.
 */
import type { ToolPlugin } from "../types.js";
import { kbSearchTool } from "./kbSearchTool.js";
import { kbGetDocTool } from "./kbGetDocTool.js";
import { kbSuggestTool } from "./kbSuggestTool.js";

/** In the order they are used: search, read one hit, re-word a thin search. */
export const knowledgeBaseTools: ToolPlugin[] = [
  kbSearchTool,
  kbGetDocTool,
  kbSuggestTool,
];
