/**
 * ToolSearchTool - Discovers deferred tool schemas on demand.
 *
 * When tool deferral is enabled, deferred tools are not sent to the API.
 * The model must call this tool to discover a deferred tool's full schema
 * before it can invoke it.
 *
 * Query formats:
 * - "select:ToolName" — direct selection by name (comma-separated for multiple)
 * - "keyword search" — fuzzy match against tool names and descriptions
 */

import { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import {
  isDeferredTool,
  TOOL_SEARCH_TOOL_NAME,
} from "../utils/isDeferredTool.js";

function formatSchema(tool: ToolPlugin): string {
  const desc = tool.config.function.description || "";
  const params = JSON.stringify(tool.config.function.parameters || {}, null, 2);
  return `${tool.name}: ${desc}\nParameters: ${params}`;
}

/**
 * Parse tool name into searchable parts (handles CamelCase and underscores).
 */
function parseToolName(name: string): string[] {
  return name
    .replace(/([a-z])([A-Z])/g, "$1 $2") // CamelCase to spaces
    .replace(/_/g, " ")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Keyword search over deferred tools by name and description.
 */
function keywordSearch(
  query: string,
  deferredTools: ToolPlugin[],
  maxResults: number,
): ToolPlugin[] {
  const queryLower = query.toLowerCase().trim();
  const queryTerms = queryLower.split(/\s+/).filter(Boolean);

  // Exact match fast path
  const exact = deferredTools.find((t) => t.name.toLowerCase() === queryLower);
  if (exact) return [exact];

  // Score each tool
  const scored = deferredTools
    .map((tool) => {
      const parts = parseToolName(tool.name);
      const desc = (tool.config.function.description || "").toLowerCase();
      let score = 0;

      for (const term of queryTerms) {
        if (parts.includes(term)) score += 10;
        else if (parts.some((p) => p.includes(term))) score += 5;
        if (desc.includes(term)) score += 2;
      }

      return { tool, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults)
    .map((s) => s.tool);

  return scored;
}

export const toolSearchTool: ToolPlugin = {
  name: TOOL_SEARCH_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: TOOL_SEARCH_TOOL_NAME,
      description:
        "Fetches full schema definitions for deferred tools so they can be called. Before calling any deferred tool (CronCreate, CronDelete, CronList, WebFetch, EnterWorktree, ExitWorktree, TaskCreate, TaskGet, TaskUpdate, TaskList, TaskStop), you MUST call ToolSearch first. Use query='select:ToolName' for direct selection, or keywords to search.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'Query to find deferred tools. Use "select:ToolName" for direct selection, or keywords to search.',
          },
          max_results: {
            type: "number",
            description: "Maximum number of results to return (default: 5)",
            default: 5,
          },
        },
        required: ["query"],
      },
    },
  },
  shouldDefer: false, // Always available
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const { query, max_results = 5 } = args as {
      query: string;
      max_results?: number;
    };

    if (!context.toolManager) {
      return {
        success: false,
        content: "",
        error: "ToolManager not available in context",
      };
    }

    const allTools = context.toolManager.list();
    const deferredTools = allTools.filter(isDeferredTool);

    // Handle select: prefix
    const selectMatch = query.match(/^select:(.+)$/i);
    if (selectMatch) {
      const requested = selectMatch[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      const found: ToolPlugin[] = [];
      const missing: string[] = [];

      for (const toolName of requested) {
        const tool =
          deferredTools.find((t) => t.name === toolName) ??
          allTools.find((t) => t.name === toolName);
        if (tool) {
          if (!found.some((f) => f.name === tool.name)) found.push(tool);
        } else {
          missing.push(toolName);
        }
      }

      if (found.length === 0) {
        return {
          success: false,
          content: "",
          error: `No matching deferred tools found for: ${missing.join(", ")}`,
        };
      }

      const result = found.map(formatSchema).join("\n\n---\n\n");
      const shortResult = `Discovered tools: ${found.map((t) => t.name).join(", ")}`;

      return {
        success: true,
        content: result,
        shortResult,
      };
    }

    // Keyword search
    const matches = keywordSearch(query, deferredTools, max_results);

    if (matches.length === 0) {
      return {
        success: false,
        content: "",
        error: `No matching deferred tools found for query: "${query}". Available deferred tools: ${getDeferredToolNamesList(deferredTools)}`,
      };
    }

    const result = matches.map(formatSchema).join("\n\n---\n\n");
    const shortResult = `Found ${matches.length} tools: ${matches.map((t) => t.name).join(", ")}`;

    return {
      success: true,
      content: result,
      shortResult,
    };
  },
};

function getDeferredToolNamesList(tools: ToolPlugin[]): string {
  return tools.map((t) => t.name).join(", ");
}
