/**
 * Determines if a tool should be deferred (not sent to the API until discovered).
 *
 * A tool is deferred if:
 * - It has shouldDefer: true
 * - It is an MCP tool (isMcp: true)
 *
 * A tool is NEVER deferred if:
 * - It has alwaysLoad: true
 * - It is the ToolSearch tool itself (must always be available)
 */

import type { ToolPlugin } from "../tools/types.js";

export const TOOL_SEARCH_TOOL_NAME = "ToolSearch";

export function isDeferredTool(tool: ToolPlugin): boolean {
  // Never defer if explicitly marked as alwaysLoad
  if (tool.alwaysLoad === true) return false;

  // Never defer ToolSearch itself — the model needs it to discover other tools
  if (tool.name === TOOL_SEARCH_TOOL_NAME) return false;

  // MCP tools are always deferred (workflow-specific, potentially many)
  if (tool.isMcp === true) return true;

  // Defer if marked with shouldDefer flag
  return tool.shouldDefer === true;
}

/**
 * Get the list of deferred tool names from a tools array.
 */
export function getDeferredToolNames(tools: ToolPlugin[]): string[] {
  return tools.filter(isDeferredTool).map((t) => t.name);
}
