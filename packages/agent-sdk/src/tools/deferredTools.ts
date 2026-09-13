/**
 * Declaration shapes for the two tools that carry deferred loading:
 *
 * - `ToolInvoke` — the single declared forwarding tool. Its **parameter
 *   declaration is constant** (namespace / tool / args) so that a changing tool
 *   pool only ever changes its *description* (the catalog), never the shape the
 *   request declares. See `docs/specs/core/tool-deferred-loading.md`, 「转发工具
 *   声明契约」.
 * - `ToolSearch` — the read-only search tool over the complete catalog (the
 *   resident part plus everything truncated out of it). Declared and retracted
 *   together with `ToolInvoke`.
 *
 * Neither is registered in `ToolManager`'s registry: they are mechanism tools
 * that exist only while the gate is open, which is what keeps the disabled path
 * byte-identical to the pre-deferral tool list.
 */
import { ChatCompletionFunctionTool } from "openai/resources.js";
import { RESERVED_BUILTIN_NAMESPACE } from "../utils/toolCatalog.js";

export const TOOL_INVOKE_TOOL_NAME = "ToolInvoke";
export const TOOL_SEARCH_TOOL_NAME = "ToolSearch";

/**
 * Build `ToolInvoke`'s declaration. `catalogText` is the rendered catalog and
 * doubles as the whole description: it starts with its own preamble, so the
 * model reads the calling convention and the tool list together.
 */
export function buildToolInvokeConfig(
  catalogText: string,
): ChatCompletionFunctionTool {
  return {
    type: "function",
    function: {
      name: TOOL_INVOKE_TOOL_NAME,
      description: catalogText,
      parameters: {
        type: "object",
        properties: {
          namespace: {
            type: "string",
            description: `Namespace of the target tool: an MCP server name, or "${RESERVED_BUILTIN_NAMESPACE}" for built-in tools.`,
          },
          tool: {
            type: "string",
            description:
              "Name of the target tool, exactly as listed in the catalog above.",
          },
          args: {
            type: "object",
            description:
              "Arguments for the target tool, shaped as its catalog signature.",
            // Open object: the inner shape is carried by the catalog signature
            // and validated by the target tool, not declared here.
            additionalProperties: true,
          },
        },
        required: ["namespace", "tool"],
      },
    },
  };
}

/** Build `ToolSearch`'s declaration. Read-only, so it needs no approval. */
export function buildToolSearchConfig(): ChatCompletionFunctionTool {
  return {
    type: "function",
    function: {
      name: TOOL_SEARCH_TOOL_NAME,
      description:
        "Search the deferred tool catalog of this session, including tools that " +
        "are not listed in the ToolInvoke description. Read-only: it only looks " +
        "through already available tools, never loads new ones. Call ToolInvoke " +
        "with the namespace and tool of a result to actually use it.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "Case-insensitive substring matched against namespace, tool name, description and parameter names.",
          },
          limit: {
            type: "integer",
            description: "Maximum number of results to return. Defaults to 10.",
          },
          offset: {
            type: "integer",
            description:
              "Number of matches to skip, for paging through the results.",
          },
        },
        required: ["query"],
      },
    },
  };
}
