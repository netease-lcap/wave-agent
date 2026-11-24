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
import {
  pollEventDataOf,
  pollRunningDataOf,
  renderPollResultData,
} from "./resultData/poll.js";
import type { PollResultData } from "./resultData/poll.js";
import type { ToolPlugin, ToolResult } from "./types.js";

export { POLL_TOOL_NAME };

/** The shell a background outcome arrives in, whether here or in a turn's messages. */
export function renderReplEvent(event: ReplEvent): string {
  // The text is rendered from the same `data` the script's own result carries
  // (`resultData/repl.ts`): one renderer, so a background settle cannot read
  // differently from the result a script that stayed inside the wait window got.
  return renderPollResultData({
    events: [pollEventDataOf(event)],
    remaining: 0,
  });
}

/**
 * The status answer of this moment: what is still running, and what is queued.
 *
 * The running list is snapshotted into `data` rather than left to be re-read: a
 * transcript's `data` is all stage 2 has, and by then the runtime is gone.
 */
function statusData(): PollResultData {
  return {
    events: [],
    remaining: replPendingEventCount(),
    running: pollRunningDataOf(listRunningReplScripts()),
  };
}

/** The status shell: what is still running, when nothing has settled yet. */
export function renderReplStatus(): string {
  return renderPollResultData(statusData());
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
      const data = statusData();
      return {
        success: true,
        content: renderPollResultData(data),
        data,
        shortResult:
          (data.running?.length ?? 0) === 0 ? "idle" : "still running",
      };
    }

    const ok = settled.every((event) => event.result.ok);
    const data: PollResultData = {
      events: settled.map(pollEventDataOf),
      remaining: replPendingEventCount(),
    };
    return {
      success: ok,
      content: renderPollResultData(data),
      data,
      shortResult: `${settled.length} result${settled.length === 1 ? "" : "s"}`,
      ...(ok ? {} : { error: "A background REPL script failed." }),
    };
  },
};
