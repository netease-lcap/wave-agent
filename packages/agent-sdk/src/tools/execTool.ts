import { EXEC_TOOL_NAME } from "../constants/tools.js";
import {
  EXEC_DEFAULT_CATALOG_TOKENS,
  EXEC_RESERVED_NAMESPACE,
} from "../exec/constants.js";
import { buildExecPool, renderCatalog } from "../exec/catalog.js";
import type { ExecPoolEntry } from "../exec/catalog.js";
import { runExecScript, type ExecRunResult } from "../exec/execRuntime.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";

/**
 * Model-visible API description. Static on purpose: it names the sandbox surface
 * but none of the tunable limits, so changing a budget cannot change the text.
 */
const EXEC_DESCRIPTION = `Run a JavaScript script in a sandbox where every MCP tool of this session is exposed as a function, so a whole sequence of MCP calls can be composed in a single turn instead of one model round-trip per call.

Sandbox API:
- \`await tools.<name>(args)\` — call an MCP tool, passing that tool's own arguments object directly. Resolves to \`{ content, images }\`.
- \`tools["${EXEC_RESERVED_NAMESPACE}"].search("query")\` — list tools whose name or description matches the query.
- \`console.log(...)\` — collected and returned alongside the result. Use it to inspect intermediate values.
- \`return <value>\` — the returned value is JSON-serialized and given back to you.

The script has no filesystem, no network, no \`import\`, and no \`eval\`/\`new Function\`. It stops when it exceeds its time or tool-call budget. Every nested MCP call goes through the normal permission check, so it can still be denied — a denied call rejects with the reason.`;

/**
 * Characters of a script's first line shown in a collapsed tool row. Same
 * threshold as the Claude Code REPL's summary, and like it the comparison is on
 * code units (`.length`) rather than on display width.
 */
const MAX_PREVIEW_CHARS = 50;

/** Rows rendered under the sandbox API blurb; the catalog is the mutable part. */
function renderToolSection(pool: ExecPoolEntry[]): string {
  if (pool.length === 0) {
    return "No MCP tools are currently available.";
  }
  return renderCatalog(pool, EXEC_DEFAULT_CATALOG_TOKENS).text;
}

function formatRun(result: ExecRunResult): ToolResult {
  const lines: string[] = [];
  if (result.logs.length > 0) {
    lines.push(result.logs.join("\n"));
  }
  if (result.ok) {
    if (result.value !== undefined && result.value !== "undefined") {
      lines.push(result.value);
    } else if (lines.length === 0) {
      lines.push("Exec finished without a return value or console output.");
    }
  } else {
    lines.push(result.error ?? "Exec script failed");
  }

  const content = lines.join("\n");
  const toolCalls = `${result.toolCalls} tool call${result.toolCalls === 1 ? "" : "s"}`;

  return {
    success: result.ok,
    content,
    ...(result.ok ? {} : { error: result.error }),
    shortResult: result.ok ? `Exec · ${toolCalls}` : "Exec failed",
    ...(result.images.length > 0 ? { images: result.images } : {}),
  };
}

export const execTool: ToolPlugin = {
  name: EXEC_TOOL_NAME,
  // Nested calls reach arbitrary MCP tools, which are conservatively non-safe.
  isConcurrencySafe: false,
  config: {
    type: "function",
    function: {
      name: EXEC_TOOL_NAME,
      description: EXEC_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "JavaScript to run in the sandbox. It may `await` tool calls and `return` a value.",
          },
        },
        required: ["code"],
      },
    },
  },

  prompt: (options) => {
    const pool = options?.execPool ?? [];
    return `${EXEC_DESCRIPTION}

MCP tools reachable from the sandbox, called as \`tools.<name>\` (no other name resolves):
${renderToolSection(pool)}`;
  },

  // Value only, never the tool name: the collapsed row renders
  // "<tool name> <compactParams>" (webview Message.tsx, CLI ToolDisplay), so
  // wrapping the preview in "Exec(...)" printed the name twice.
  // Shape follows the Claude Code REPL's summary — the script's first line, with an
  // ellipsis only when it does not fit — except that blank lines are skipped, so a
  // script opening with a newline still shows something.
  formatCompactParams: (params: Record<string, unknown>) => {
    const code = typeof params.code === "string" ? params.code : "";
    const line =
      code
        .split("\n")
        .find((candidate) => candidate.trim().length > 0)
        ?.trim() ?? "";
    if (line.length <= MAX_PREVIEW_CHARS) {
      return line;
    }
    return `${line.slice(0, MAX_PREVIEW_CHARS - 1)}…`;
  },

  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const code = typeof args.code === "string" ? args.code : "";
    if (code.trim().length === 0) {
      return {
        success: false,
        content: "",
        error: `${EXEC_TOOL_NAME}: missing required parameter "code"`,
      };
    }

    const mcpManager = context.mcpManager;
    if (!mcpManager) {
      return {
        success: false,
        content: "",
        error: `${EXEC_TOOL_NAME}: MCP manager is not available in this session`,
      };
    }

    // Recomputed here rather than reused from the declaration-time catalog: a
    // server may have connected or dropped since. Both are derived from the same
    // `buildExecPool`, so the sandbox can never reach a tool the agent could not
    // already call directly.
    const pool = buildExecPool(mcpManager, context.permissionManager);
    const result = await runExecScript({ code, pool, context });
    return formatRun(result);
  },
};
