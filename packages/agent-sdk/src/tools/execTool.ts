import { EXEC_TOOL_NAME } from "../constants/tools.js";
import { EXEC_RESERVED_NAMESPACE } from "../exec/constants.js";
import { runExecScript, type ExecRunResult } from "../exec/execRuntime.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";

/**
 * The `search` bullet of the sandbox API blurb. It names the entry point and its
 * purpose; the tool description teaches the call form from `search`'s own schema.
 *
 * The path is derived from the reserved namespace, the same constant the sandbox
 * builds its `tools` object from, so the two cannot drift.
 */
const SEARCH_ENTRY =
  `- \`tools[${JSON.stringify(EXEC_RESERVED_NAMESPACE)}].search(...)\` — ` +
  "find a tool's parameters and return type. The pool is announced by name only, so this is how a call is built.";

/**
 * Model-visible API description.
 *
 * Static on purpose, and not merely "no tunable limits in it": it must be identical
 * for any tool pool. `tools[]` sits in the cached prefix, so a description that
 * mentioned the session's servers (or their tools) would rewrite that prefix every
 * time one connected or dropped. The pool is a tail announcement instead — see
 * `exec/catalogAnnouncement.ts`.
 */
const EXEC_DESCRIPTION = `Run a JavaScript script in a sandbox where this session's on-demand tools are exposed as functions, so a whole sequence of calls can be composed in a single turn instead of one model round-trip per call.

Sandbox API:
- \`await tools.<name>(args)\` — call a tool, passing that tool's own arguments object directly. Resolves to the tool's output: a structured object when the tool returned one, otherwise its text, otherwise \`null\`. \`search\` gives each tool's return type.
${SEARCH_ENTRY}
- \`console.log(...)\` — collected and returned alongside the result. Use it to inspect intermediate values.
- \`return <value>\` — the returned value is JSON-serialized and given back to you.

It is very helpful if you write a clear, concise description of what this script does in 5-10 words.

Which tools are reachable is announced in the conversation as it changes. The script has no filesystem, no network, no \`import\`, and no \`eval\`/\`new Function\`. It stops when it exceeds its time or tool-call budget. Every nested call goes through the normal permission check, so it can still be denied — a denied call rejects with the reason.`;

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
    // The calls themselves, not just their summary: a deferred tool leaves no
    // block of its own, so this is the only trace a host-side judgment (e.g. the
    // task reminder's counter) has of it. Carried on failure too — a call that
    // happened still happened.
    ...(calls.length > 0 ? { nestedToolCalls: [...calls] } : {}),
    ...(result.images.length > 0 ? { images: result.images } : {}),
  };
}

export const execTool: ToolPlugin = {
  name: EXEC_TOOL_NAME,
  searchHint: "run code in a sandbox to search and call the on-demand tools",
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
          description: {
            type: "string",
            description:
              "Clear, concise description of what this script does in 5-10 words.",
          },
        },
        required: ["code"],
      },
    },
  },

  leanPrompt: `Run a JavaScript script in a sandbox where this session's on-demand tools are exposed as functions, composing a whole sequence of calls in one turn instead of one model round-trip per call.

- \`await tools.<name>(args)\` — call a tool with its own arguments object; resolves to its output.
- ${SEARCH_ENTRY}
- \`console.log(...)\` — collected and returned alongside the result.
- \`return <value>\` — the returned value is JSON-serialized and given back to you.
Write a clear, concise description of what the script does in 5-10 words. The script has no filesystem, no network, no \`import\`, and no \`eval\`/\`new Function\`; it stops at its time or tool-call budget, and every nested call still goes through the permission check, so it can still be denied.`,
  prompt: () => EXEC_DESCRIPTION,

  /**
   * The parameter slot of the collapsed row, shared by the TUI and the desktop
   * UI: the model's own one-line summary of the script, taken verbatim — no
   * prefix (the row already prints `Exec`), no rewrite, no truncation.
   *
   * `Bash` can fall back to the command string; a script has no equivalent, and
   * the first line of a multi-line blob usually says nothing, so an absent or
   * empty description leaves the slot blank rather than inventing text. What the
   * script actually did is the result slot's job (`formatSummary`).
   *
   * Deliberately reads nothing but the argument: no code scan, no pool, no
   * catalog, so the preview cannot claim a call the script never makes.
   */
  formatCompactParams: (params: Record<string, unknown>) => {
    const description = params.description;
    return typeof description === "string" ? description : "";
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

    const toolManager = context.toolManager;
    if (!toolManager) {
      return {
        success: false,
        content: "",
        error: `${EXEC_TOOL_NAME}: tool manager is not available in this session`,
      };
    }

    // Recomputed here rather than reused from the declaration-time pool: a server
    // may have connected or dropped since. Declaring and running call the same
    // `ToolManager.getExecPool`, so the sandbox can never reach a tool the agent
    // could not already call directly.
    const pool = toolManager.getExecPool();
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
