/**
 * `Poll` — the explicit wait of the REPL's async lane.
 *
 * A script that outlives its wait window answers with `(dispatched #N)` and keeps
 * running, so the result has to reach the model some other way. Two paths exist and
 * they share one queue: the outcome is announced as a message before the next turn,
 * and this tool is how a model that has nothing else to do asks for it now.
 *
 * Why a tool rather than "the model just waits": a turn ends when the model stops
 * calling tools. Without an explicit wait, a model facing a 20-minute script has to
 * choose between polling by resubmitting something (which would run it twice) and
 * ending the turn on a receipt. Both are worse than one call that answers "nothing
 * yet, 2 scripts still running".
 *
 * The wait is bounded on purpose. An unbounded wait is a turn held hostage, and the
 * status line costs one round-trip — and the script's own 2-hour ceiling is not the
 * caller's problem. Past the wait it answers with what is `running()`, which is the
 * same introspection a script has.
 */

import {
  REPL_MAX_TIMEOUT_MS,
  REPL_POLL_DEFAULT_WAIT_MS,
  REPL_POLL_MAX_EVENTS,
} from "../repl/constants.js";
import {
  listRunningReplScripts,
  replPendingEventCount,
  waitForReplEvents,
} from "../repl/replRuntime.js";
import type { ReplEvent } from "../repl/replRuntime.js";
import { POLL_TOOL_NAME } from "../constants/tools.js";
import { formatReplRun } from "./replTool.js";
import type { ToolPlugin, ToolResult } from "./types.js";

export { POLL_TOOL_NAME };

/** The shell a background outcome arrives in, whether here or in a turn's messages. */
export function renderReplEvent(event: ReplEvent): string {
  const run = formatReplRun(
    event.result,
    event.result.toolsUsed ?? [],
    event.elapsedMs,
  );
  return `<event kind="repl-eval" eval="${event.evalId}">\n${run.content}\n</event>`;
}

/** The status shell: what is still running, when nothing has settled yet. */
export function renderReplStatus(): string {
  const running = listRunningReplScripts();
  const lines = [`<event kind="repl-status" pending="${running.length}"/>`];
  for (const script of running) {
    lines.push(
      `#${script.id} ${script.state} ${script.ageMs}ms — ${script.snippet}`,
    );
  }
  if (running.length === 0) {
    lines.push("No REPL script is running in this context.");
  }
  return lines.join("\n");
}

const POLL_DESCRIPTION = `Wait for background REPL scripts to finish and read their results.

A \`REPL\` call that outlives its wait window answers \`(dispatched #N)\` and keeps running. Use this to wait for those results instead of sending the script again — a resubmission runs it a second time.

- Returns as soon as something settles, or after the wait with a status line naming what is still running.
- Several results arriving together are capped per answer; the rest say how many are still pending, oldest first.
- Waiting on nothing returns immediately.`;

export const pollTool: ToolPlugin = {
  name: POLL_TOOL_NAME,
  searchHint: "wait for background REPL scripts and read their results",
  // Reading a queue: it neither writes files nor reaches the world.
  isConcurrencySafe: true,
  config: {
    type: "function",
    function: {
      name: POLL_TOOL_NAME,
      description: POLL_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          timeoutMs: {
            type: "number",
            description:
              `How long to wait before answering with a status line instead, in milliseconds. ` +
              `Default ${REPL_POLL_DEFAULT_WAIT_MS}, capped at ${REPL_MAX_TIMEOUT_MS}.`,
          },
        },
      },
    },
  },

  leanPrompt:
    "Wait for background REPL scripts: returns their results as soon as any settles, or a status line naming what is still running.",

  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const requested =
      typeof args.timeoutMs === "number" && Number.isFinite(args.timeoutMs)
        ? args.timeoutMs
        : REPL_POLL_DEFAULT_WAIT_MS;
    const waitMs = Math.min(Math.max(0, requested), REPL_MAX_TIMEOUT_MS);

    // Nothing queued and nothing running: there is no event to wait for, and
    // parking here would spend the whole timeout to say "nothing happened".
    const settled = await (replPendingEventCount() === 0 &&
    listRunningReplScripts().length === 0
      ? Promise.resolve([])
      : waitForReplEvents(waitMs, REPL_POLL_MAX_EVENTS));

    if (settled.length === 0) {
      return {
        success: true,
        content: renderReplStatus(),
        shortResult:
          listRunningReplScripts().length === 0 ? "idle" : "still running",
      };
    }

    const lines = settled.map(renderReplEvent);
    const remaining = replPendingEventCount();
    if (remaining > 0) {
      lines.push(`(${remaining} more settled — read them with another poll)`);
    }
    return {
      success: settled.every((event) => event.result.ok),
      content: lines.join("\n"),
      shortResult: `${settled.length} result${settled.length === 1 ? "" : "s"}`,
      ...(settled.every((event) => event.result.ok)
        ? {}
        : { error: "A background REPL script failed." }),
    };
  },
};
