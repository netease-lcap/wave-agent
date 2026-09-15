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
- \`tools["${EXEC_RESERVED_NAMESPACE}"].search("query")\` — list tools whose name or description matches the query, each with the same signature the catalog below shows, so a hit can be copied verbatim. An empty query lists the entire pool: use it when you cannot name what you are looking for.
- \`console.log(...)\` — collected and returned alongside the result. Use it to inspect intermediate values.
- \`return <value>\` — the returned value is JSON-serialized and given back to you.

The script has no filesystem, no network, no \`import\`, and no \`eval\`/\`new Function\`. It stops when it exceeds its time or tool-call budget. Every nested MCP call goes through the normal permission check, so it can still be denied — a denied call rejects with the reason.`;

/** Rows rendered under the sandbox API blurb; the catalog is the mutable part. */
function renderToolSection(pool: ExecPoolEntry[]): string {
  if (pool.length === 0) {
    return "No MCP tools are currently available.";
  }
  return renderCatalog(pool, EXEC_DEFAULT_CATALOG_TOKENS).text;
}

/**
 * How many of the most recent nested calls the result summary lists, mirroring
 * how the `Agent` tool lists the subagent tools it just ran.
 */
const RECENT_CALLS_SHOWN = 2;

/**
 * The collapsed result row: the call count, then the most recent calls by name.
 *
 * Names only — MCP tools have no compact-params summary of their own, and a
 * flat MCP call's collapsed row shows just the name. No "Exec" prefix either:
 * the row this text sits in already prints the tool name.
 *
 * Derived from the calls the sandbox actually issued, so it can be rendered
 * mid-run as well as at the end.
 */
function formatSummary(calls: readonly string[]): string {
  const count = calls.length;
  const lines: string[] = [
    `${count > RECENT_CALLS_SHOWN ? "... " : ""}${count} tool call${
      count === 1 ? "" : "s"
    }`,
  ];
  for (const name of calls.slice(-RECENT_CALLS_SHOWN)) {
    lines.push(name);
  }
  return lines.join("\n");
}

function formatRun(
  result: ExecRunResult,
  calls: readonly string[],
): ToolResult {
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

  return {
    success: result.ok,
    content,
    ...(result.ok ? {} : { error: result.error }),
    shortResult: result.ok ? formatSummary(calls) : "failed",
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
    const calls: string[] = [];
    const result = await runExecScript({
      code,
      pool,
      context,
      // Report each call as it is issued, so the collapsed row shows what the
      // script is doing while it runs — the same live update the Agent tool does.
      onToolCall: (name) => {
        calls.push(name);
        context.onShortResultUpdate?.(formatSummary(calls));
      },
    });
    return formatRun(result, calls);
  },
};
