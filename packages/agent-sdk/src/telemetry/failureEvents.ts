/**
 * Telemetry outlets for failures the user can actually feel — spec
 * `enterprise/opentelemetry.md`「可感知失败的覆盖——持久化 / MCP / 工具执行」.
 *
 * Three surfaces report here instead of calling `logOTelEvent` directly, because
 * they share two things a bare call site cannot get right on its own:
 *
 * - **Dedup.** A drifted transcript directory fails on every tool step (four
 *   figures of times in a real archive), and an unreachable MCP server fails on
 *   every dial. Monitoring wants "this session started failing", not a counter
 *   curve that tracks how much work the session did.
 * - **Clipping.** Tool failures carry whatever the tool said, which can be a
 *   whole command's output. Only a bounded summary ever leaves the process.
 *
 * Everything here is a side channel: it never throws, never blocks the caller,
 * and does nothing when telemetry is off.
 */

import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import { logOTelEvent } from "./events.js";
import type { StandardAttributeContext } from "./attributes.js";

/** Upper bound on the free-text failure summary carried by any event. */
const MESSAGE_LIMIT = 500;

/**
 * Per-session ceiling for `tool_error`. A model that keeps retrying the same
 * failing call must not turn one session into thousands of records; past the
 * ceiling the session is already represented, so dropping the tail loses no
 * signal. Deliberately a plain counter, not a sampler: the first N failures of
 * a session are the ones worth reading.
 */
const MAX_TOOL_FAILURES_PER_SESSION = 50;

/** Dedup keys already reported: `<sessionId>:<surface>:<detail>`. */
const reportedOnce = new Set<string>();

/** `tool_error` records emitted so far, per session. */
const toolFailuresPerSession = new Map<string, number>();

/**
 * Claim the right to report a once-per-session failure. Returns false when this
 * exact failure was already reported.
 */
function claimOnce(key: string): boolean {
  if (reportedOnce.has(key)) return false;
  reportedOnce.add(key);
  return true;
}

function claimToolFailure(sessionId: string): boolean {
  const used = toolFailuresPerSession.get(sessionId) ?? 0;
  if (used >= MAX_TOOL_FAILURES_PER_SESSION) return false;
  toolFailuresPerSession.set(sessionId, used + 1);
  return true;
}

/**
 * Forget that a persistence failure was reported — called after a write finally
 * succeeds, so a later relapse produces a fresh event instead of silence.
 */
export function releasePersistFailure(sessionId: string): void {
  reportedOnce.delete(`${sessionId}:persist`);
}

/** Test seam: forget every dedup key and counter. */
export function resetFailureEventState(): void {
  reportedOnce.clear();
  toolFailuresPerSession.clear();
}

function clip(text: string): string {
  return text.length <= MESSAGE_LIMIT
    ? text
    : `${text.slice(0, MESSAGE_LIMIT)}…`;
}

/**
 * Every export funnels through here: telemetry is a side channel, so a failure
 * inside it (an exporter that rejects, a logger that was torn down) must never
 * surface in the caller's control flow.
 */
async function emit(
  eventName: "error" | "tool_error",
  attributes: Record<string, string>,
  context: StandardAttributeContext | undefined,
): Promise<void> {
  try {
    await logOTelEvent(eventName, attributes, context);
  } catch {
    // Nothing to do: a dropped telemetry record is not the caller's problem.
  }
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : String(error);
}

function errorTypeOf(error: unknown): string {
  return error instanceof Error ? error.constructor.name : "Unknown";
}

/**
 * Report a transcript write failure.
 *
 * The directory recorded is the one the write actually used — not the session's
 * opening directory (`SessionWorkdir`): when the two disagree, that disagreement
 * *is* the bug being diagnosed, so substituting the stable one would hide it.
 * The path itself is hashed, plus whether it is a symlink: those two facts are
 * what tells "the directory moved out from under us" apart from "the disk is
 * full", and they do not leak a customer's internal layout.
 */
export async function reportPersistFailure(input: {
  error: unknown;
  sessionId: string;
  workdir: string;
  context?: StandardAttributeContext;
}): Promise<void> {
  if (!claimOnce(`${input.sessionId}:persist`)) return;

  const hash = createHash("sha256")
    .update(input.workdir)
    .digest("hex")
    .substring(0, 12);
  let isSymlink = "unknown";
  try {
    isSymlink = (await lstat(input.workdir)).isSymbolicLink()
      ? "true"
      : "false";
  } catch {
    // The directory cannot even be stat'ed — that is itself worth reporting, so
    // the event still goes out and the shape stays "unknown".
  }

  await emit(
    "error",
    {
      error_type: errorTypeOf(input.error),
      "error.category": "persist",
      message: clip(messageOf(input.error)),
      "workdir.hash": hash,
      "workdir.is_symlink": isSymlink,
    },
    input.context,
  );
}

/** Report an MCP server that could not be reached; once per server per session. */
export async function reportMcpConnectionFailure(input: {
  error?: unknown;
  sessionId: string;
  serverName: string;
  phase: "initialize" | "lazy" | "config";
  context?: StandardAttributeContext;
}): Promise<void> {
  if (!claimOnce(`${input.sessionId}:mcp:${input.serverName}`)) return;

  await emit(
    "error",
    {
      error_type: errorTypeOf(input.error),
      "error.category": "mcp",
      message: clip(
        input.error === undefined
          ? `MCP server ${input.serverName} failed to connect`
          : messageOf(input.error),
      ),
      mcp_server_name: input.serverName,
      mcp_phase: input.phase,
    },
    input.context,
  );
}

/**
 * Report a tool that could not run at all: it threw, or it does not exist.
 * These are environment/registration faults, so they belong in the `ERROR`
 * series.
 */
export async function reportToolCrash(input: {
  error: unknown;
  sessionId: string;
  toolName: string;
  isMcp: boolean;
  context?: StandardAttributeContext;
}): Promise<void> {
  if (!claimOnce(`${input.sessionId}:tool:${input.toolName}`)) return;

  await emit(
    "error",
    {
      error_type: errorTypeOf(input.error),
      "error.category": "tool",
      message: clip(messageOf(input.error)),
      tool_name: input.toolName,
      is_mcp: input.isMcp ? "true" : "false",
    },
    input.context,
  );
}

/**
 * Report a tool that ran and reported failure (`success: false`).
 *
 * Kept separate from {@link reportToolCrash} and filed as `WARN`: a failing
 * `grep`, a rejected permission and a model that wrote the wrong arguments are
 * all ordinary operation. Merging them into `ERROR` would make the alert series
 * meaningless — the same reasoning that keeps an aborted turn out of it.
 */
export async function reportToolFailure(input: {
  sessionId: string;
  toolName: string;
  isMcp: boolean;
  message: string;
  context?: StandardAttributeContext;
}): Promise<void> {
  if (!claimToolFailure(input.sessionId)) return;

  await emit(
    "tool_error",
    {
      "error.category": "tool",
      message: clip(input.message),
      tool_name: input.toolName,
      is_mcp: input.isMcp ? "true" : "false",
    },
    input.context,
  );
}
