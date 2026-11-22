/**
 * Host side of the REPL: everything the sandbox must not own.
 *
 * The sandbox (`replSandbox.ts`) only knows how to run JavaScript in a realm and
 * how to ask the host for things. Everything that decides *what may happen* lives
 * here: the tool pool, the single dispatch funnel per tool kind, the permission
 * and hook path (inside those funnels), the call budget, the per-call watchdog,
 * the image cap and the async lane.
 *
 * Three shapes are worth knowing before reading the code:
 *
 * 1. **One host, many runs.** The sandbox's host binding is per *sandbox*, while
 *    the budget, the abort grace and the collected images are per *script*. A
 *    backgrounded script keeps running after its caller returned, so a second
 *    script can start on the same long-resident context while the first is still
 *    issuing calls. `AsyncLocalStorage` carries the run's frame across the
 *    script's awaits (including the ones the realm performs), which is what makes
 *    a host callback attributed to the run that caused it instead of to whichever
 *    script started last.
 * 2. **Waiting is not spending.** The sync budget (`timeout`) is enforced inside
 *    the sandbox, per synchronous segment, so an approval dialog costs nothing.
 *    The *ask* permission modes are the deliberate exception: there the script is
 *    kept alive at most `EXEC_ASK_MODE_TOTAL_MS` from start, counting the wait,
 *    because a prompt nobody answers would otherwise pin the context forever.
 * 3. **Never reject.** Every failure mode comes back as `{ ok: false, error }`:
 *    a script throw, a budget, an abort, a watchdog or a dispatch. A runaway
 *    script is stopped by *not answering* its calls, never by killing the
 *    context — the context outlives aborts, budgets and compaction.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import * as fs from "node:fs";
import * as path from "node:path";
import type { ToolContext, ToolResult } from "../tools/types.js";
import { logger } from "../utils/globalLogger.js";
import { parsePersistedOutput } from "../utils/toolResultStorage.js";
import {
  describeTool as describePoolEntry,
  listToolNames as listPoolToolNames,
  searchTools as searchPool,
  type ExecPoolEntry,
} from "./catalog.js";
import {
  EXEC_ABORT_GRACE_CALLS,
  EXEC_ASK_MODE_TOTAL_MS,
  EXEC_ASYNC_CONCURRENCY_LIMIT,
  EXEC_BACKGROUND_MAX_MS,
  EXEC_DEFAULT_MAX_LOG_CHARS,
  EXEC_DEFAULT_MAX_TOOL_CALLS,
  EXEC_DEFAULT_NATIVE_TIMEOUT_MS,
  EXEC_DEFAULT_TIMEOUT_MS,
  EXEC_MAX_IMAGES,
  EXEC_MAX_PDFS,
  EXEC_MAX_TIMEOUT_MS,
  EXEC_SHELL_DEFAULT_WAIT_MS,
  EXEC_SYNC_WAIT_MS,
  EXEC_WATCHDOG_BASE_MS,
  EXEC_WATCHDOG_FACTOR,
} from "./constants.js";
import {
  acquireReplSandbox,
  releaseReplSandbox,
  type ReplRunOutcome,
  type ReplSandbox,
  type ReplSandboxHost,
} from "./replSandbox.js";

export interface RunReplOptions {
  code: string;
  /** The model's `timeout`, in milliseconds. Default 30000, clamped to 600000. */
  timeout?: number;
  /** Every tool this script may call. The sandbox exposes these as globals. */
  pool: ExecPoolEntry[];
  context: ToolContext;
  /**
   * Called as each nested call is issued, before it is dispatched, in call order.
   *
   * The arguments come along because the collapsed row shows what each call is
   * operating on (`Read src/app.ts`), the way the `Agent` tool's short result
   * does; only the caller knows how to render them.
   *
   * The third argument says whether this occurrence is a tool call at all. It
   * exists because `searchTools` / `describeTool` reach this same callback — the
   * row has to show that the script is looking a tool up instead of sitting
   * silent — while they are *not* tool calls: nothing is dispatched, no
   * permission decision is taken, no budget is spent, and the spec says they do
   * not count toward `N tool calls`. The count is rendered by the caller from the
   * lines it collected, so the caller has to be told the difference; reading it
   * off the name would duplicate the runtime's own list of helpers in the tool
   * layer and let the two drift.
   */
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
    kind: "call" | "helper",
  ) => void;
  /** Permission mode: 'default' | 'acceptEdits' | 'plan' | 'dontAsk' | 'bypassPermissions' */
  permissionMode?: string;
  /** Fully-dispatched shape: hand back a receipt at once and never wait. */
  detach?: boolean;
  maxToolCalls?: number;
  /** Identifies the long-resident context: `(session, agent)`. */
  sessionKey?: string;
}

export interface ReplRunResult {
  ok: boolean;
  /**
   * The number this context gave the script. Carried on every shape of result,
   * because the model reads `<repl-output eval="N">` and needs the same `N` here
   * to find the script again in `running()` / `Poll` output.
   */
  evalId?: number;
  /** The script's last expression, serialized. Truncation belongs to the renderer. */
  value?: string;
  error?: string;
  /** `self.log` lines. */
  logs: string[];
  /** Host notes (call limit, dropped attachments, watchdog ceiling). */
  stderr?: string[];
  toolCalls: number;
  /** Tools the script reached, in call order, repeats kept. */
  toolsUsed?: string[];
  /** Calls a permission rule, a hook or the call limit refused. */
  refusedCalls?: string[];
  images: Array<{ data: string; mediaType?: string }>;
  /** Set = this call answered with a receipt instead of a result; `N` is the `evalId`. */
  dispatched?: number;
  /** True when the context was discarded as poisoned; `error` says so. */
  contextReset?: boolean;
}

export interface ReplEvent {
  evalId: number;
  result: ReplRunResult;
  /** Wall clock from dispatch to outcome; absent for a synchronous run. */
  elapsedMs?: number;
}

export interface RunningReplScript {
  id: number;
  snippet: string;
  ageMs: number;
  state: string;
  settled: boolean;
  self: boolean;
  abort: () => void;
}

interface ImageAttachment {
  data: string;
  mediaType?: string;
}

/** One tool call's value as the script sees it, plus the bytes hoisted out of it. */
interface ToolOutcome {
  output: unknown;
  images?: ImageAttachment[];
}

/**
 * Everything one script owns. Reached from the sandbox callbacks through
 * `frameStorage`, never through the sandbox's own host binding — see the header.
 */
interface ReplFrame {
  id: number;
  key: string;
  snippet: string;
  startedAt: number;
  /** Sync-segment wall clock, for the error text and the sandbox. */
  timeoutMs: number;
  pool: readonly ExecPoolEntry[];
  context: ToolContext;
  onToolCall?: (
    name: string,
    args: Record<string, unknown>,
    kind: "call" | "helper",
  ) => void;
  maxToolCalls: number;
  toolCalls: number;
  toolsUsed: string[];
  refused: string[];
  /** Host notes for `stderr`: nothing a `self.log` could have said. */
  notes: string[];
  logs: string[];
  images: ImageAttachment[];
  imageCount: number;
  pdfCount: number;
  consoleText: string;
  consoleDroppedChars: number;
  /** Nested calls currently in flight; drives the `running()` state. */
  waiting: number;
  /** Aborted or terminated: calls are still answered, but only within the grace. */
  stopped: boolean;
  graceCalls: number;
  /** Abandoned: no further call is answered, ever (a never-settling promise). */
  closed: boolean;
  /** The call limit was crossed: the rest of the script is not answered. */
  limitReached: boolean;
  scriptSettled: boolean;
  receiptSent: boolean;
  outcomeSent: boolean;
  resolve?: (result: ReplRunResult) => void;
  controller: AbortController;
  timers: {
    window?: ReturnType<typeof setTimeout>;
    background?: ReturnType<typeof setTimeout>;
    watchdog?: Set<ReturnType<typeof setTimeout>>;
  };
  abortSignal?: AbortSignal;
  abortListener?: () => void;
}

/** Fallback context key when neither the caller nor the context names a session. */
const DEFAULT_KEY = "repl:default";

const ABORTED_MESSAGE = "REPL script was aborted.";

/** The phrase `replSandbox.ts` uses for the one case a context is discarded. */
const CONTEXT_RESET_PATTERN = /REPL context was reset/i;

const DYNAMIC_IMPORT_PATTERN = /dynamic import callback/i;

/** A promise that is never resolved: how a runaway script is left to hang. */
const NEVER: Promise<never> = new Promise<never>(() => {
  /* deliberately unreachable */
});

const frameStorage = new AsyncLocalStorage<ReplFrame>();

/** Every live frame, so a disposed runtime can stop the ones it owns. */
const frames = new Set<ReplFrame>();

/** Dispatched scripts that have not been picked up yet, by evalId. */
const background = new Map<number, ReplFrame>();

/** Results waiting for `drainReplEvents`, oldest first. */
const pendingEvents: ReplEvent[] = [];

/**
 * Callers parked in `waitForReplEvents`.
 *
 * Kept next to the queue rather than folded into it: an event arriving has to wake
 * whoever is waiting, and a promise chain would make "arrived while nobody waited"
 * and "arrived while somebody waited" two different code paths.
 */
const eventWaiters = new Set<() => void>();

function notifyEventWaiters(): void {
  for (const wake of [...eventWaiters]) wake();
}

let nextEvalId = 1;

// ---------------------------------------------------------------------------
// Error text
// ---------------------------------------------------------------------------

/**
 * Rewrite engine-internal messages the model cannot act on into something it
 * can. `node:vm` refuses `import()` with a message that mentions a callback the
 * model has no way to know about; anything a sandbox or a tool already worded
 * for a reader is passed through untouched.
 */
function humanizeError(message: string): string {
  if (DYNAMIC_IMPORT_PATTERN.test(message)) {
    return "import() is not available inside REPL scripts";
  }
  return message;
}

/**
 * The message for a built-in that reported failure.
 *
 * `error` and `content` answer different questions, so neither may be dropped:
 * `error` is the short tag the model can recognise at a glance, while `content`
 * is the actionable half — the parameter to retry with, the reason a tool
 * refused. Either may be absent (the task tools report through `content` alone),
 * and many tools put the same string in both, so duplicates collapse.
 */
function failureMessage(
  name: string,
  result: { error?: string; content?: string },
): string {
  const parts = [result.error, result.content]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part));
  const unique = [...new Set(parts)];
  return unique.length > 0 ? unique.join("\n") : `${name} failed`;
}

/**
 * The `step budget or wall clock` message the sandbox throws back into the script.
 *
 * The realm's counter reports both budget kinds through one callback
 * (`bridge.stepError()`), so both are named here rather than guessed at: the
 * counts cover loop iterations and calls, the clock bounds one uninterrupted
 * synchronous segment — which is the only thing that can stop a single long
 * built-in call that made no steps at all.
 */
function stepErrorOf(frame: ReplFrame): Error {
  return new Error(
    "REPL script stopped: its step budget (loop iterations and calls) or the synchronous wall clock " +
      `(${frame.timeoutMs} ms for one uninterrupted synchronous segment) ran out. ` +
      "The step budget counts steps, not the time spent inside a single built-in call, so a slow regex or a " +
      "huge spread is only ever stopped by the wall clock — and a big step count does not buy time either. " +
      "Calls that already completed still apply; variables and functions are kept.",
  );
}

/** The note a script gets when it crossed the call budget, for `stderr`. */
function callLimitNote(limit: number): string {
  return (
    `REPL tool-call limit reached (${limit}): that call did not run, and no later call in this script is answered. ` +
    "The script's own computation continues, but anything awaiting a tool call will not return."
  );
}

// ---------------------------------------------------------------------------
// Timeouts and the per-call watchdog
// ---------------------------------------------------------------------------

/** `timeout` input: default when absent or nonsensical, clamped to the ceiling. */
function resolveTimeout(requested: number | undefined): number {
  const value =
    typeof requested === "number" && Number.isFinite(requested) && requested > 0
      ? Math.floor(requested)
      : EXEC_DEFAULT_TIMEOUT_MS;
  return Math.min(value, EXEC_MAX_TIMEOUT_MS);
}

/** Only these two modes stop for a human, and only they get the ask-mode ceiling. */
function isAskMode(mode: string | undefined): boolean {
  return mode === "default" || mode === "plan";
}

/**
 * How long one nested call may take before the host gives up on it and hands the
 * error back to the script. A tool that declares its own `timeout` gets the
 * generous multiplier; the file tools, which take none, are measured against the
 * default native timeout so a hung read cannot hold the script.
 */
function watchdogMsFor(nativeTimeoutMs: number): number {
  return Math.round(
    nativeTimeoutMs * EXEC_WATCHDOG_FACTOR + EXEC_WATCHDOG_BASE_MS,
  );
}

/** The `timeout` a nested call declared, or the default the watchdog assumes. */
function nativeTimeoutOf(args: Record<string, unknown>): number {
  const declared = args.timeout;
  return typeof declared === "number" &&
    Number.isFinite(declared) &&
    declared > 0
    ? Math.floor(declared)
    : EXEC_DEFAULT_NATIVE_TIMEOUT_MS;
}

/** Bookkeeping timers must never be the reason a process stays alive. */
function unrefTimer<T>(timer: T): T {
  (timer as unknown as { unref?: () => void } | null)?.unref?.();
  return timer;
}

/** Same, for a timer that may not exist. */
function clearTimer(timer: ReturnType<typeof setTimeout> | undefined): void {
  if (timer !== undefined) clearTimeout(timer);
}

/**
 * Run one nested call under its watchdog.
 *
 * The underlying call is not cancellable, so the *call* is abandoned rather than
 * killed: the script sees a rejection and keeps going, and the tool may still
 * finish host-side. A late rejection is absorbed by the already-settled race,
 * so nothing surfaces as an unhandled rejection.
 */
async function withWatchdog<T>(
  frame: ReplFrame,
  call: () => Promise<T>,
  nativeTimeoutMs: number,
  label: string,
): Promise<T> {
  const limitMs = watchdogMsFor(nativeTimeoutMs);
  frame.waiting += 1;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = unrefTimer(
        setTimeout(() => {
          reject(
            new Error(
              `${label} did not return within ${limitMs} ms ` +
                `(watchdog: ${nativeTimeoutMs} ms × ${EXEC_WATCHDOG_FACTOR} + ${EXEC_WATCHDOG_BASE_MS} ms). ` +
                "That call was abandoned and the script continues; it may still be running host-side.",
            ),
          );
        }, limitMs),
      );
      if (timer !== undefined) frame.timers.watchdog?.add(timer);
      call().then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    if (timer !== undefined) frame.timers.watchdog?.delete(timer);
    frame.waiting -= 1;
  }
}

// ---------------------------------------------------------------------------
// Values crossing into the sandbox
// ---------------------------------------------------------------------------

/** Base64 characters are 6 bits each, so 3 of them carry 2 bytes. */
function base64Bytes(chars: number): number {
  return Math.floor((chars * 3) / 4);
}

function placeholderFor(data: string): string {
  return `[${data.length} base64 chars — ${base64Bytes(data.length)} bytes moved to the REPL result, subject to its per-result cap]`;
}

/**
 * Move a call's attachments onto the result and answer the script with text.
 *
 * A script cannot compose with pixels, and an inlined base64 blob would cost the
 * context more than the flat call it replaced; the bytes therefore travel beside
 * the value, bounded by the per-result caps. What the script sees is a
 * placeholder, so it still knows something came back and where it went.
 *
 * A dropped attachment is reported twice on purpose: the script is told, because
 * it asked for it and its own accounting would otherwise be wrong, and the result
 * carries it in `stderr`, because the cap belongs to the result the *model* reads
 * and the script may well return a value that no longer mentions it.
 */
function hoistImages(
  frame: ReplFrame,
  images: readonly ImageAttachment[] | undefined,
): string[] {
  if (!images || images.length === 0) return [];
  const notes: string[] = [];
  for (const image of images) {
    const data = typeof image.data === "string" ? image.data : "";
    if (data.length === 0) continue;
    const isPdf = image.mediaType === "application/pdf";
    if (isPdf) {
      if (frame.pdfCount >= EXEC_MAX_PDFS) {
        const note = `[PDF dropped: the REPL result keeps at most ${EXEC_MAX_PDFS} PDFs]`;
        frame.notes.push(note);
        notes.push(note);
        continue;
      }
      frame.pdfCount += 1;
    } else {
      if (frame.imageCount >= EXEC_MAX_IMAGES) {
        const note = `[image dropped: the REPL result keeps at most ${EXEC_MAX_IMAGES} images]`;
        frame.notes.push(note);
        notes.push(note);
        continue;
      }
      frame.imageCount += 1;
    }
    frame.images.push(
      image.mediaType === undefined
        ? { data }
        : { data, mediaType: image.mediaType },
    );
    notes.push(placeholderFor(data));
  }
  return notes;
}

/**
 * The value handed to the script: unchanged, with the placeholders appended when
 * the value is text (the shape file and MCP tools return). A structured value
 * keeps its shape — rewriting its keys would break every script that reads them —
 * and its attachments still reach the result.
 */
function withPlaceholders(value: unknown, notes: string[]): unknown {
  if (notes.length === 0) return value;
  const text = notes.join("\n");
  if (value === null || value === undefined) return text;
  if (typeof value === "string")
    return value.length === 0 ? text : `${value}\n${text}`;
  return value;
}

/** Tool arguments are an object; a bare `null` / `undefined` means "no arguments". */
function plainArgs(args: unknown): Record<string, unknown> {
  if (args === undefined || args === null) return {};
  if (typeof args !== "object" || Array.isArray(args)) {
    throw new TypeError(
      `REPL tool arguments must be a plain object, got ${Array.isArray(args) ? "an array" : typeof args}`,
    );
  }
  return args as Record<string, unknown>;
}

/**
 * The arguments as a summary line may read them.
 *
 * Unlike `plainArgs` this never throws. The summary counts a call the moment it
 * is issued — including one whose arguments turn out to be unusable — so the
 * display path must not be what fails the script.
 */
function displayArgs(args: unknown): Record<string, unknown> {
  return args !== null && typeof args === "object" && !Array.isArray(args)
    ? (args as Record<string, unknown>)
    : {};
}

// ---------------------------------------------------------------------------
// The console ring
// ---------------------------------------------------------------------------

/**
 * `console.*` goes to a bounded in-memory ring that is *not* part of the result.
 * It exists for the script's own debugging: reading it back is the script's job
 * (`console.tail(n)`), which is what keeps a noisy script from paying for its
 * noise in the model's context.
 */
function writeConsole(
  frame: ReplFrame,
  level: string,
  values: readonly string[],
): void {
  const text = values.join(" ");
  const line = level === "log" ? text : `[${level}] ${text}`;
  frame.consoleText += `${line}\n`;
  const overflow = frame.consoleText.length - EXEC_DEFAULT_MAX_LOG_CHARS;
  if (overflow > 0) {
    frame.consoleText = frame.consoleText.slice(overflow);
    frame.consoleDroppedChars += overflow;
  }
}

function tailConsole(frame: ReplFrame, count: number): string {
  const limit = Number.isFinite(count) && count > 0 ? Math.floor(count) : 50;
  const lines = frame.consoleText.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines.slice(-limit).join("\n");
}

/** The opening of the ring note, which is also how a repeat is recognised. */
const CONSOLE_RING_NOTE_PREFIX = "[console.log wrote ";

/**
 * Say where `console.*` output went, once the result is being assembled.
 *
 * The ring is invisible to the model by design, so a script that debugged with
 * `console.log` reads its own result as "the script produced nothing" and starts
 * rewriting a script that worked. The wording is Claude Code's, because that is
 * the sentence the model has been shown; the count is the ring's line count.
 *
 * Deliberately wider than Claude Code, which appends it only when the script
 * produced no stdout at all: "a little output plus a ring full of lines" is the
 * combination that reads wrong, so *any* ring content triggers it. Guarding on the
 * note already being present is what keeps the push idempotent without adding a
 * flag to the frame.
 */
function noteConsoleRing(frame: ReplFrame): void {
  const lines = frame.consoleText
    .split("\n")
    .filter((line) => line.length > 0).length;
  if (lines === 0) return;
  if (frame.notes.some((note) => note.startsWith(CONSOLE_RING_NOTE_PREFIX)))
    return;
  frame.notes.push(
    `${CONSOLE_RING_NOTE_PREFIX}${lines} line${lines === 1 ? "" : "s"} to the console ring, ` +
      "not to this output — use self.log(...) for output you want to see, or read the ring with console.tail()]",
  );
}

// ---------------------------------------------------------------------------
// Dispatch: one funnel per tool kind
// ---------------------------------------------------------------------------

/**
 * A built-in goes through `ToolManager.execute`, which is the builtins' single
 * funnel: it runs the built-in's own `checkPermission` and the Pre/PostToolUse
 * hooks, and it supplies the enhanced context they read their managers from.
 *
 * Failure is reported in the result rather than thrown, and it is handed back as
 * `{ error }` instead of a rejection: a built-in refusing a call is ordinary
 * operation, so a script can continue to the next step without a `try/catch`.
 */
async function callBuiltInTool(
  frame: ReplFrame,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const toolManager = frame.context.toolManager;
  if (!toolManager) {
    throw new Error("Tool manager is not available in the REPL context");
  }
  const result = await toolManager.execute(name, args, frame.context);
  if (!result.success) {
    return {
      output: { error: failureMessage(name, result) },
      images: result.images,
    };
  }
  return {
    output: stripEmptyShellSentence(result, exitCodeOf(result)),
    images: result.images,
  };
}

/** An MCP failure, carrying what the model needs to tell it from a script error. */
interface McpFailure extends Error {
  toolName: string;
  error: string;
  detail?: unknown;
}

/** `JSON.parse`, with "not JSON" answered as `undefined` instead of a throw. */
function tryParseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

/** A server that answered with a JSON body: the parsed body is the useful part. */
function jsonDetailOf(message: string): unknown {
  const stripped = message.replace(/^Tool execution failed:\s*/, "");
  for (const candidate of [message, stripped]) {
    const text = candidate.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) continue;
    const parsed = tryParseJson(text);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

/**
 * Annotate an MCP failure instead of replacing it: `toolName`, `error` (the
 * tool's own text) and `detail` (the parsed response body, when it was JSON) are
 * attached to the original error, so whatever class the funnel threw — a hook
 * block included — stays recognisable, and its wording reaches the script intact.
 */
function annotateMcpFailure(name: string, cause: unknown): Error {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  const message = error.message;
  const detail = jsonDetailOf(message);
  const failure = error as McpFailure;
  failure.toolName = name;
  failure.error = message;
  if (detail !== undefined) failure.detail = detail;
  // A hook refusal already says what it is (`PreToolUse:<tool> hook error: …`);
  // everything else gets the one clarification a script author needs: this came
  // back from a tool, not from their JavaScript.
  if (!message.startsWith("PreToolUse:")) {
    error.message = `${message} (MCP tool "${name}" failed; this is a tool failure, not a script error.)`;
  }
  return error;
}

/**
 * An MCP call goes through `McpManager.executeMcpTool`: the same funnel a flat
 * MCP call uses, so hooks and the permission check cannot be skipped by reaching
 * a tool through the pool. MCP reports failure by throwing — the script has to
 * `catch` — which is the deliberate asymmetry with built-ins.
 */
async function callMcpTool(
  frame: ReplFrame,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolOutcome> {
  const mcpManager = frame.context.mcpManager;
  if (!mcpManager) {
    throw new Error("MCP manager is not available in the REPL context");
  }
  try {
    const result = await mcpManager.executeMcpTool(name, args, frame.context);
    return { output: result.output, images: result.images };
  } catch (error) {
    throw annotateMcpFailure(name, error);
  }
}

/**
 * Answer one nested call, or decline to.
 *
 * The order of the gates is the contract:
 *
 * - once the limit is crossed, *nothing* later is answered (not "refused once
 *   and then fine"): a runaway script has to stop at its next round-trip;
 * - the same is true past the post-abort grace, so `finally` blocks still get
 *   their 20 calls while a script that keeps looping stops;
 * - a call that is answered exercises the same permission and hook path a flat
 *   call would, because it goes through the same funnel.
 *
 * A declined call returns a promise that never settles. That is not an error the
 * script can catch on purpose: it is how a script that will not stop is left to
 * be collected by the abort or the ceiling.
 */
async function answerToolCall(
  frame: ReplFrame,
  name: string,
  rawArgs: unknown,
): Promise<unknown> {
  const attempt = frame.toolCalls + 1;
  frame.toolCalls = attempt;
  frame.onToolCall?.(name, displayArgs(rawArgs), "call");

  if (frame.closed || frame.limitReached) return NEVER;
  if (attempt > frame.maxToolCalls) {
    frame.limitReached = true;
    frame.refused.push(name);
    frame.notes.push(callLimitNote(frame.maxToolCalls));
    return NEVER;
  }
  if (frame.stopped) {
    frame.graceCalls += 1;
    if (frame.graceCalls > EXEC_ABORT_GRACE_CALLS) {
      frame.closed = true;
      return NEVER;
    }
  }

  // No "unknown tool" answer here, and deliberately so: the sandbox installs a
  // global (and a `tools.<name>`) only for the names in `frame.pool`, so a name
  // outside it never reaches this function — the engine throws its own
  // `ReferenceError` / `TypeError`, which is the failure the model can act on. A
  // host-side branch would have to invent wording for "this tool is not reachable
  // from this script", and every wording of it invites the model to go searching
  // for a tool it was never meant to have (Claude Code has no such branch either).
  const entry = frame.pool.find((candidate) => candidate.name === name);

  const args = plainArgs(rawArgs);
  // The call happened, whatever its outcome: the summary lists it, and a denial
  // counts the same as a success (spec「结果摘要列出实际的内层调用」场景 7).
  frame.toolsUsed.push(name);

  const nativeTimeoutMs = nativeTimeoutOf(args);
  const outcome = await withWatchdog(
    frame,
    () =>
      entry?.isMcp === true
        ? callMcpTool(frame, name, args)
        : callBuiltInTool(frame, name, args),
    nativeTimeoutMs,
    name,
  );
  return withPlaceholders(outcome.output, hoistImages(frame, outcome.images));
}

/**
 * The sentence `Bash` / `PowerShell` say when a command printed nothing.
 *
 * A model reading only the tool result needs to know a silent command ended
 * (rather than that the tool broke), so the tool writes a sentence. A script does
 * not: it gets `exitCode` as data, and a sentence posing as stdout is worse than
 * nothing — a script reading `.stdout` would get prose.
 *
 * Two conditions, both needed, because the sentence is also something a command can
 * print: it must be the *whole* of what came back, and the tool must say it printed
 * nothing. `shortResult` is derived from the raw stdout/stderr, so it is absent
 * exactly then — a real session showed why that guard matters: `echo 'Command
 * executed with exit code: 0'` came back as `.stdout === ""` without it, because the
 * command's entire output was indistinguishable from the tool's own filler.
 *
 * Left as is: the shape where an empty command also changed the working directory,
 * whose `content` is the `cd` note followed by the sentence. Recognising that would
 * mean re-deriving `Bash`'s own note strings here; the notes already read as display
 * text in `output`, and `.stdout` carries them today either way.
 */
const EMPTY_SHELL_SENTENCE = /^Command executed with exit code: (\d+)$/;

function stripEmptyShellSentence(result: ToolResult, exitCode: number): string {
  const text = result.content ?? "";
  if (result.shortResult) return text;
  const match = EMPTY_SHELL_SENTENCE.exec(text.trim());
  if (!match || Number(match[1]) !== exitCode) return text;
  return "";
}

/** The exit code a Bash result carries, with a sane fallback for a missing one. */
function exitCodeOf(result: ToolResult): number {
  const metadata = result.metadata as { exitCode?: unknown } | undefined;
  if (metadata && typeof metadata.exitCode === "number")
    return metadata.exitCode;
  return result.success ? 0 : 1;
}

/**
 * The exit code the shell itself reported, or `undefined` when it never ran.
 *
 * The difference matters for the exit-1 exemption below: a denied, refused or
 * blocked call also reads as "failed", and the fallback in `exitCodeOf` would
 * turn that into a 1 that looks like `grep` finding nothing.
 */
function shellExitCodeOf(result: ToolResult): number | undefined {
  const metadata = result.metadata as { exitCode?: unknown } | undefined;
  return metadata && typeof metadata.exitCode === "number"
    ? metadata.exitCode
    : undefined;
}

/** Commands whose exit 1 is an answer ("nothing to report"), not a failure. */
const EXIT_ONE_IS_AN_ANSWER = new Set([
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "find",
  "diff",
  "test",
  "[",
]);

/** `git <sub>` for the two subcommands that answer with exit 1 the same way. */
const EXIT_ONE_IS_AN_ANSWER_SUBCOMMANDS = new Set(["diff", "grep"]);

/**
 * The words of each command segment, split on the shell's own operators.
 *
 * Quotes are honoured, because a `|` inside them is data: `rg "a|b" src` is one
 * command, and reading it as two would put `b"` where the command name belongs
 * and lose the exemption for a search that simply found nothing.
 */
function commandSegments(command: string): string[][] {
  const segments: string[][] = [];
  let words: string[] = [];
  let word = "";
  let quote: '"' | "'" | undefined;
  const endWord = () => {
    if (word !== "") {
      words.push(word);
      word = "";
    }
  };
  const endSegment = () => {
    endWord();
    if (words.length > 0) segments.push(words);
    words = [];
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote !== undefined) {
      if (char === quote) quote = undefined;
      else word += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "\\" && index + 1 < command.length) {
      index += 1;
      word += command[index];
      continue;
    }
    if (char === " " || char === "\t") {
      endWord();
      continue;
    }
    if (char === "\n" || char === ";" || char === "&" || char === "|") {
      endSegment();
      // `&&` and `||` are one operator; skipping the second char keeps it simple.
      if (index + 1 < command.length && command[index + 1] === char) index += 1;
      continue;
    }
    word += char;
  }
  endSegment();
  return segments;
}

/**
 * The last command word of a command line, plus the word after it.
 *
 * "Last" is what the exemption is about: `rg foo` answers 1 when nothing
 * matched, but `rg foo | head` answers with `head`'s status. Leading `NAME=value`
 * assignments are skipped, and a path (`/usr/bin/grep`) is read by its basename.
 */
function lastCommandWord(
  command: string,
): { word: string; next?: string } | undefined {
  const segments = commandSegments(command);
  for (let index = segments.length - 1; index >= 0; index--) {
    const words = segments[index].slice();
    while (words.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) {
      words.shift();
    }
    if (words.length === 0) continue;
    const word = words[0].split("/").pop() ?? words[0];
    return words.length > 1 ? { word, next: words[1] } : { word };
  }
  return undefined;
}

/**
 * What to put in `note` when this command's exit 1 is its answer.
 *
 * Returns `undefined` for every other command: the exemption is deliberately one
 * cell wide (this family, this exit code), because widening it would turn real
 * failures into silent empty output.
 */
function exitOneNote(command: string): string | undefined {
  const found = lastCommandWord(command);
  if (!found) return undefined;
  const isGitSubcommand =
    found.word === "git" &&
    found.next !== undefined &&
    EXIT_ONE_IS_AN_ANSWER_SUBCOMMANDS.has(found.next);
  if (!isGitSubcommand && !EXIT_ONE_IS_AN_ANSWER.has(found.word)) {
    return undefined;
  }
  const name = isGitSubcommand ? `git ${found.next}` : found.word;
  return `${name} exits 1 when there is nothing to report (no match, an unreadable directory, files differ, a false test) — that is the command's answer, not a failure`;
}

/** The text a `$` result shows: stdout, then the tool's own reading of it. */
function shellDisplayText(
  stdout: string,
  stderr: string,
  note: string | undefined,
  exitCode: number,
): string {
  const lines = [stdout];
  if (stderr) lines.push(`[stderr] ${stderr}`);
  if (note) lines.push(`[note] ${note}`);
  if (exitCode !== 0) lines.push(`[exit ${exitCode}]`);
  const text = lines.filter((line) => line !== "").join("\n");
  // A command that said nothing has to stay tellable from one that never ran, so
  // the all-empty case keeps a marker. Claude Code's shell result does exactly
  // this: `[exit 0]` when stdout, stderr and the error are all empty, no exit line
  // at all when there was output and the code is 0.
  return text === "" ? `[exit ${exitCode}]` : text;
}

/** Environment variable names a script may set through `.env()`. */
const SHELL_ENV_KEY = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** What the chain methods declared for one `$` call. */
interface ShellCallOptions {
  /** How long the call waits, in ms. */
  waitMs: number;
  /** Ran the command here instead of in the session's directory. */
  cwd?: string;
  /** Added to this command's environment (on top of the session's). */
  env?: Record<string, string>;
}

/**
 * Read and validate the options the sandbox sent along with a `$` call.
 *
 * The sandbox forwards them as written (its own chain methods do no checking),
 * so this is the one place that decides what a usable directory or variable name
 * is — and the one place whose wording the script sees when it got it wrong.
 */
function readShellCallOptions(options: unknown): ShellCallOptions {
  const record =
    options !== null && typeof options === "object"
      ? (options as { timeout?: unknown; cwd?: unknown; env?: unknown })
      : {};

  const declared = record.timeout;
  const waitMs =
    typeof declared === "number" && Number.isFinite(declared) && declared > 0
      ? Math.min(Math.floor(declared), EXEC_BACKGROUND_MAX_MS)
      : EXEC_SHELL_DEFAULT_WAIT_MS;

  let cwd: string | undefined;
  if (record.cwd !== undefined) {
    if (typeof record.cwd !== "string" || record.cwd === "") {
      throw new Error(
        "$ did not run this command: .cwd(path) needs the path to a directory",
      );
    }
    cwd = record.cwd;
  }

  let env: Record<string, string> | undefined;
  if (record.env !== undefined) {
    const vars = record.env;
    if (vars === null || typeof vars !== "object" || Array.isArray(vars)) {
      throw new Error(
        "$ did not run this command: .env({...}) needs an object of NAME: value pairs",
      );
    }
    env = {};
    for (const [key, value] of Object.entries(vars)) {
      if (!SHELL_ENV_KEY.test(key)) {
        throw new Error(
          `$ did not run this command: .env() key ${JSON.stringify(key)} is not an environment variable name`,
        );
      }
      if (
        typeof value !== "string" &&
        typeof value !== "number" &&
        typeof value !== "boolean"
      ) {
        throw new Error(
          `$ did not run this command: .env() value for ${key} must be a string, a number or a boolean`,
        );
      }
      env[key] = String(value);
    }
  }

  const callOptions: ShellCallOptions = { waitMs };
  if (cwd !== undefined) callOptions.cwd = cwd;
  if (env !== undefined) callOptions.env = env;
  return callOptions;
}

function isDirectory(target: string): boolean {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The tool context one `$` call runs under.
 *
 * `.cwd()` and `.env()` are scoped to the single call by deriving a context
 * rather than by rewriting the command into `cd … && …` / `export …; …` the way
 * Claude Code's prelude does. A rewritten command would (a) hide a leading
 * `sleep` from `Bash`'s "do not background this" check, (b) be the text a
 * permission rule matches against instead of what the model wrote, and (c) let a
 * `cd` inside the command move the *session's* working directory through
 * `onCwdChange`. Two fields, one call, no text surgery.
 */
function shellToolContext(
  context: ToolContext,
  cwd: string | undefined,
  env: Record<string, string> | undefined,
): ToolContext {
  if (cwd === undefined && env === undefined) return context;
  const scoped: ToolContext = { ...context };
  if (cwd !== undefined) {
    // Relative to the session's current directory: that is where the shell lives.
    const target = path.resolve(context.workdir, cwd);
    if (!isDirectory(target)) {
      throw new Error(
        `$ did not run this command: .cwd() got ${target}, which is not a directory`,
      );
    }
    scoped.workdir = target;
    // A directory scoped to one call must not become the session's: dropping the
    // callback is what keeps `cd` inside this command from moving every later
    // tool call (and the `cd` note `Bash` would add to the output).
    scoped.onCwdChange = undefined;
  }
  if (env !== undefined) {
    scoped.sessionEnv = { ...context.sessionEnv, ...env };
  }
  return scoped;
}

/**
 * Answer one `` $`cmd` `` call.
 *
 * It is the Bash tool's own funnel — same permission check, same hooks, same
 * sandbox — and only the shape differs: the script gets `{ stdout, stderr,
 * exitCode }` as data, and a non-zero exit is turned into a `ShellError` by the
 * sandbox unless the result carries a `note` (an exit 1 from `grep` and friends
 * is the command's answer, not a failure).
 *
 * A command that outlives its wait is not a failure: `Bash` moves it to the
 * background, and the script is answered with `exitCode: null` plus `running`
 * naming the task and the file its output streams to. `sleep` never gets there —
 * `Bash` refuses to background it and kills it instead.
 */
async function answerShellCall(
  frame: ReplFrame,
  command: string,
  options: unknown,
): Promise<unknown> {
  const attempt = frame.toolCalls + 1;
  frame.toolCalls = attempt;
  const commandText = typeof command === "string" ? command : String(command);
  // The command is the only thing worth showing here; `timeout` is this tool's
  // own bookkeeping and `Bash`'s summary line drops it for the same reason.
  frame.onToolCall?.("Bash", { command: commandText }, "call");

  if (frame.closed || frame.limitReached) return NEVER;
  if (attempt > frame.maxToolCalls) {
    frame.limitReached = true;
    frame.refused.push("Bash");
    frame.notes.push(callLimitNote(frame.maxToolCalls));
    return NEVER;
  }
  if (frame.stopped) {
    frame.graceCalls += 1;
    if (frame.graceCalls > EXEC_ABORT_GRACE_CALLS) {
      frame.closed = true;
      return NEVER;
    }
  }

  const toolManager = frame.context.toolManager;
  if (!toolManager) {
    throw new Error(
      "Tool manager is not available in the REPL context: $ cannot run a command here",
    );
  }

  const { waitMs, cwd, env } = readShellCallOptions(options);
  const context = shellToolContext(frame.context, cwd, env);
  const args: Record<string, unknown> = {
    command: commandText,
    // Always explicit: `Bash`'s own default is two minutes, and a script's shell
    // call is meant to be waited on for ten before it hands itself over.
    timeout: waitMs,
  };

  frame.toolsUsed.push("Bash");
  const result = await withWatchdog(
    frame,
    () => toolManager.execute("Bash", args, context),
    waitMs,
    "Bash",
  );
  const taskId =
    typeof result.backgroundTaskId === "string"
      ? result.backgroundTaskId
      : undefined;
  if (taskId) {
    // The command outlived its wait, so `Bash` moved it to the background. The
    // script is told that rather than handed an exit code it never produced: it
    // can go on, and read the file instead of running the command again.
    const task = frame.context.backgroundTaskManager?.getTask(taskId);
    return {
      stdout: "",
      stderr: result.content ?? "",
      exitCode: null,
      output: result.content ?? "",
      truncated: false,
      command: commandText,
      running: { taskId, outputPath: task?.outputPath ?? "" },
    };
  }

  // Past 30000 characters `Bash` persists the whole output and hands the model a
  // `<persisted-output>` wrapper with a 2048-character preview. The script gets
  // the same information as fields instead of as a wrapper to parse: the preview
  // in `stdout`, and the spill file in `file` — that file is what `Read` or a
  // second `$` can open to get the part that did not fit.
  const persisted = parsePersistedOutput(result.content ?? "");
  const exitCode = exitCodeOf(result);
  const stdout = persisted
    ? persisted.preview
    : stripEmptyShellSentence(result, exitCode);
  const stderr = result.success ? "" : (result.error ?? "");
  // Exit 1 is the answer of a whole family of commands; anything else is a
  // failure the script has to see. A call that never ran (denied, refused) has no
  // shell exit code at all, and `shellExitCodeOf` keeps it out of this branch.
  const note =
    shellExitCodeOf(result) === 1 ? exitOneNote(commandText) : undefined;

  const answer: Record<string, unknown> = {
    stdout,
    stderr,
    exitCode,
    output: shellDisplayText(stdout, stderr, note, exitCode),
    truncated: persisted !== undefined,
    command: commandText,
  };
  if (persisted) answer.file = persisted.filePath;
  if (note !== undefined) answer.note = note;
  return answer;
}

// ---------------------------------------------------------------------------
// The sandbox host
// ---------------------------------------------------------------------------

/** The run a sandbox callback belongs to, or a clear failure if there is none. */
function currentFrame(): ReplFrame {
  const frame = frameStorage.getStore();
  if (!frame) {
    throw new Error(
      "The REPL sandbox called the host outside of a script run; no run is attached to this call.",
    );
  }
  return frame;
}

/**
 * One host for every sandbox.
 *
 * The sandbox rebinds its host per `run()`, and a backgrounded script outlives
 * its caller, so the routing cannot come from the binding: every callback reads
 * its run out of `AsyncLocalStorage`, which follows the script's own async chain.
 */
const REPL_HOST: ReplSandboxHost = {
  callTool: (name, args) => answerToolCall(currentFrame(), name, args),
  searchTools: (query, max) => {
    const frame = currentFrame();
    // Reported before the lookup, so a search that fails (`searchTools("")` throws
    // its usage error) still shows up: the row is about what the script is doing,
    // and "it was searching and got nowhere" is exactly what a silent row hides.
    frame.onToolCall?.("searchTools", { query }, "helper");
    return Promise.resolve(
      searchPool(
        frame.pool,
        query as string,
        typeof max === "number" ? max : undefined,
      ),
    );
  },
  describeTool: (name) => {
    const frame = currentFrame();
    // Same as `searchTools`: a miss answers `{ error }` and the row still says
    // which tool was being looked up.
    frame.onToolCall?.("describeTool", { name }, "helper");
    return Promise.resolve(describePoolEntry(frame.pool, name as string));
  },
  listToolNames: () => listPoolToolNames(currentFrame().pool),
  runShell: (command, options) =>
    answerShellCall(currentFrame(), command, options),
  // The sandbox already collects `self.log` into the run's own log state; the
  // host only mirrors it so a stopped run can still report what it logged.
  selfLog: (values) => {
    currentFrame().logs.push(values.join(" "));
  },
  consoleWrite: (level, values) =>
    writeConsole(currentFrame(), level, values.map(String)),
  consoleTail: (n) => tailConsole(currentFrame(), n),
  consoleBuffer: () => currentFrame().consoleText,
  consoleDropped: () => currentFrame().consoleDroppedChars,
  running: () => listRunningReplScripts(currentFrame().id),
  stepError: () => stepErrorOf(currentFrame()),
};

// ---------------------------------------------------------------------------
// Frame lifecycle
// ---------------------------------------------------------------------------

/** A short single-line form of the script, for `running()`. */
function snippetOf(code: string): string {
  const flat = code.replace(/\s+/g, " ").trim();
  return flat.length > 120 ? `${flat.slice(0, 117)}...` : flat;
}

function resolveKey(options: RunReplOptions): string {
  if (options.sessionKey && options.sessionKey.length > 0)
    return options.sessionKey;
  const sessionId = options.context.sessionId;
  return sessionId ? `session:${sessionId}` : DEFAULT_KEY;
}

/** Live scripts of one context — the number the concurrency gate reads. */
function activeCount(key: string): number {
  let count = 0;
  for (const frame of frames) {
    if (frame.key === key && !frame.scriptSettled) count += 1;
  }
  return count;
}

function clearFrameTimers(frame: ReplFrame): void {
  clearTimer(frame.timers.window);
  clearTimer(frame.timers.background);
  for (const timer of frame.timers.watchdog ?? []) clearTimeout(timer);
  frame.timers.watchdog?.clear();
  frame.timers.window = undefined;
  frame.timers.background = undefined;
  if (frame.abortSignal && frame.abortListener) {
    frame.abortSignal.removeEventListener("abort", frame.abortListener);
  }
  frame.abortSignal = undefined;
  frame.abortListener = undefined;
}

/** Collect a result from the frame's current state. */
function buildResult(
  frame: ReplFrame,
  fields: {
    ok: boolean;
    value?: string;
    error?: string;
    logs?: string[];
    contextReset?: boolean;
  },
): ReplRunResult {
  const logs =
    fields.logs !== undefined && fields.logs.length > 0
      ? fields.logs
      : frame.logs;
  // Every finishing path builds its result here, so this is the one place the
  // ring's whereabouts have to be said — on a throw, a budget stop and a normal
  // end alike.
  noteConsoleRing(frame);
  const result: ReplRunResult = {
    ok: fields.ok,
    evalId: frame.id,
    logs: [...logs],
    toolCalls: frame.toolCalls,
    images: frame.images.slice(),
  };
  if (fields.value !== undefined) result.value = fields.value;
  if (fields.error !== undefined) result.error = fields.error;
  if (frame.toolsUsed.length > 0) result.toolsUsed = [...frame.toolsUsed];
  if (frame.refused.length > 0) result.refusedCalls = [...frame.refused];
  if (frame.notes.length > 0) result.stderr = [...frame.notes];
  if (fields.contextReset === true) result.contextReset = true;
  return result;
}

/**
 * Cut the live row off from whatever the script does next.
 *
 * `onToolCall` belongs to the caller of `runReplScript`, and that caller is gone
 * the moment it holds a receipt — or, for a script that stayed inside the wait
 * window, its final result: the tool block it was writing into is already
 * `stage: "end"`, and both `messageOperations.updateToolBlock` and the webview's
 * reducer merge field by field. So one more `onShortResultUpdate` after that
 * point does not "refresh" the row, it rewrites `stage` back to `running` and
 * leaves a finished script spinning for the rest of the session.
 *
 * The model's side is deliberately untouched: `pendingEvents` carries the
 * outcome, and `toolsUsed` is collected on the frame by `answerToolCall`, not
 * through this callback — so a backgrounded script keeps reporting to `Poll`
 * while its row stays settled. Cutting here (the receipt, and the end of the
 * script) is the only pair of points where "the caller stopped listening" and
 * "the script may still run" become true.
 */
function detachToolRow(frame: ReplFrame): void {
  frame.onToolCall = undefined;
}

/**
 * Deliver one script's outcome — exactly once, to exactly one place.
 *
 * A receipt already handed out means the model is waiting for an event, not for
 * a result, so the outcome becomes an event; otherwise it settles the caller's
 * promise. The flag is what guarantees a script can never be both.
 */
function finishScript(frame: ReplFrame, result: ReplRunResult): void {
  if (frame.outcomeSent) return;
  frame.outcomeSent = true;
  frame.scriptSettled = true;
  detachToolRow(frame);
  frames.delete(frame);
  clearFrameTimers(frame);
  if (frame.receiptSent) {
    pendingEvents.push({
      evalId: frame.id,
      result,
      elapsedMs: Math.max(0, Date.now() - frame.startedAt),
    });
    notifyEventWaiters();
    return;
  }
  frame.receiptSent = true;
  frame.resolve?.(result);
  background.delete(frame.id);
}

/** Stop a script's answers but let the grace calls through; report the reason. */
function stopScript(frame: ReplFrame, message: string): void {
  if (frame.outcomeSent) return;
  frame.stopped = true;
  frame.controller.abort();
  finishScript(frame, buildResult(frame, { ok: false, error: message }));
}

/** Abandon a script outright: no grace, no further answers, no result. */
function discardScript(frame: ReplFrame): void {
  frame.closed = true;
  frame.stopped = true;
  frame.controller.abort();
  frame.outcomeSent = true;
  frame.scriptSettled = true;
  frames.delete(frame);
  background.delete(frame.id);
  clearFrameTimers(frame);
}

/** Terminate a background script at its wall-clock ceiling and report it. */
function terminateFrame(frame: ReplFrame, message: string): void {
  if (frame.outcomeSent) return;
  frame.closed = true;
  frame.stopped = true;
  frame.controller.abort();
  finishScript(frame, buildResult(frame, { ok: false, error: message }));
}

function armBackgroundCeiling(frame: ReplFrame): void {
  frame.timers.background = unrefTimer(
    setTimeout(() => {
      terminateFrame(
        frame,
        `REPL script exceeded the background ceiling (${EXEC_BACKGROUND_MAX_MS} ms) and was terminated. ` +
          "Tool calls that already completed still apply.",
      );
    }, EXEC_BACKGROUND_MAX_MS),
  );
}

/** The receipt handed back when the model stops waiting for a dispatched script. */
function sendDispatchReceipt(frame: ReplFrame): void {
  if (frame.receiptSent || frame.outcomeSent) return;
  frame.receiptSent = true;
  detachToolRow(frame);
  background.set(frame.id, frame);
  armBackgroundCeiling(frame);
  frame.resolve?.({
    ok: true,
    evalId: frame.id,
    dispatched: frame.id,
    // Everything the script collects from here on travels with the event, so the
    // receipt carries only what a reader needs to correlate it with the call.
    logs: [],
    toolCalls: frame.toolCalls,
    images: [],
    ...(frame.toolsUsed.length > 0 ? { toolsUsed: [...frame.toolsUsed] } : {}),
    ...(frame.refused.length > 0 ? { refusedCalls: [...frame.refused] } : {}),
    ...(frame.notes.length > 0 ? { stderr: [...frame.notes] } : {}),
  });
}

/** Turn a sandbox outcome into the result the caller or the event queue gets. */
function completeFromOutcome(frame: ReplFrame, outcome: ReplRunOutcome): void {
  if (frame.outcomeSent) {
    // A receipt was refused by the ceiling or the script was abandoned: the
    // outcome has nowhere to go, and fabricating a second delivery would make
    // the model see the same script twice.
    return;
  }
  const error = outcome.ok
    ? undefined
    : humanizeError(outcome.error ?? "REPL script failed");
  const reset = error !== undefined && CONTEXT_RESET_PATTERN.test(error);
  finishScript(
    frame,
    buildResult(frame, {
      ok: outcome.ok,
      value: outcome.ok ? outcome.value : undefined,
      error,
      logs: outcome.logs,
      contextReset: reset,
    }),
  );
}

function completeFromError(frame: ReplFrame, error: unknown): void {
  const message = humanizeError(
    error instanceof Error ? error.message : String(error),
  );
  logger.error(`[REPL] sandbox failure: ${message}`);
  finishScript(frame, buildResult(frame, { ok: false, error: message }));
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * The refusal a script gets when the context already has too many in flight.
 *
 * It keeps the *receipt* shape on purpose (spec「并发上限时拒绝而不是排队」): the
 * model has to recognise this as "that lane answered, nothing started", and the
 * `(dispatched #N)` form is the one it already reads as an answer from the async
 * lane. `ok: false` is what makes the renderer print the reason instead of
 * "already running".
 */
function concurrencyRefusal(
  running: number,
  snippet: string,
  evalId: number,
): ReplRunResult {
  return {
    ok: false,
    evalId,
    dispatched: evalId,
    error:
      `REPL concurrency limit reached: ${running} script(s) from this context are still in flight ` +
      `(limit ${EXEC_ASYNC_CONCURRENCY_LIMIT}). 已达并发上限，先用 Poll 等它们 settle. ` +
      "This script was not started.",
    logs: [],
    toolCalls: 0,
    images: [],
    stderr: [`script snippet: ${snippet}`],
  };
}

/**
 * Run one script.
 *
 * Never rejects. The three shapes it can answer with:
 *
 * - the script's own result, when it finishes inside the wait window;
 * - `{ ok: true, dispatched: N }`, when the window closed first (or `detach`
 *   asked for it): the script keeps running and its result arrives as an event;
 * - `{ ok: false, error }` for everything else — a throw, a budget, an abort, a
 *   watchdog, a refusal.
 */
export function runReplScript(options: RunReplOptions): Promise<ReplRunResult> {
  const code = typeof options.code === "string" ? options.code : "";
  const key = resolveKey(options);
  const snippet = snippetOf(code);
  const live = activeCount(key);
  if (live >= EXEC_ASYNC_CONCURRENCY_LIMIT) {
    // The refused call still consumes a number: the receipt the model reads and
    // the number a later script gets must never be the same one.
    const refusedId = nextEvalId;
    nextEvalId += 1;
    return Promise.resolve(concurrencyRefusal(live, snippet, refusedId));
  }

  const frame: ReplFrame = {
    id: nextEvalId,
    key,
    snippet,
    startedAt: Date.now(),
    timeoutMs: resolveTimeout(options.timeout),
    pool: options.pool ?? [],
    context: options.context,
    onToolCall: options.onToolCall,
    maxToolCalls: options.maxToolCalls ?? EXEC_DEFAULT_MAX_TOOL_CALLS,
    toolCalls: 0,
    toolsUsed: [],
    refused: [],
    notes: [],
    logs: [],
    images: [],
    imageCount: 0,
    pdfCount: 0,
    consoleText: "",
    consoleDroppedChars: 0,
    waiting: 0,
    stopped: false,
    graceCalls: 0,
    closed: false,
    limitReached: false,
    scriptSettled: false,
    receiptSent: false,
    outcomeSent: false,
    controller: new AbortController(),
    timers: { watchdog: new Set() },
  };
  nextEvalId += 1;

  if (options.context.abortSignal?.aborted) {
    return Promise.resolve(
      buildResult(frame, { ok: false, error: ABORTED_MESSAGE }),
    );
  }

  const outcome = new Promise<ReplRunResult>((resolve) => {
    frame.resolve = resolve;
  });
  frames.add(frame);

  const signal = options.context.abortSignal;
  if (signal) {
    frame.abortSignal = signal;
    frame.abortListener = () => stopScript(frame, ABORTED_MESSAGE);
    signal.addEventListener("abort", frame.abortListener, { once: true });
  }

  const permissionMode =
    options.permissionMode ?? options.context.permissionMode;
  const askMode = isAskMode(permissionMode);

  // The wait window is a fixed `EXEC_SYNC_WAIT_MS`, not the model's `timeout`.
  // They answer different questions — "how long may the synchronous segment run"
  // versus "how long does this call hold the turn" — and using one number for both
  // let `timeout: 600000` occupy a whole turn for ten minutes. Past the window the
  // script keeps running and its result arrives as an event. Ask mode is the
  // deliberate exception: the script is kept at most the ask-mode total *and* that
  // total counts the time spent on approval prompts, so the window is that ceiling
  // and it terminates instead of dispatching.
  if (!options.detach) {
    frame.timers.window = unrefTimer(
      setTimeout(
        () => {
          if (askMode) {
            stopScript(
              frame,
              `REPL script stopped ${EXEC_ASK_MODE_TOTAL_MS} ms after it starts, counting the time spent waiting on permission prompts. ` +
                "Tool calls that already completed still apply; variables and functions are kept.",
            );
            return;
          }
          sendDispatchReceipt(frame);
        },
        askMode ? EXEC_ASK_MODE_TOTAL_MS : EXEC_SYNC_WAIT_MS,
      ),
    );
  }

  let sandbox: ReplSandbox;
  try {
    sandbox = acquireReplSandbox(key, REPL_HOST);
  } catch (error) {
    completeFromError(frame, error);
    return outcome;
  }

  let running: Promise<ReplRunOutcome>;
  try {
    // The frame goes into the async context here, and everything the script does
    // after an await stays inside it — that is what lets a host callback name the
    // run that caused it while another run is on the same context.
    running = frameStorage.run(frame, () =>
      sandbox.run(code, {
        toolNames: frame.pool.map((entry) => entry.name),
        timeoutMs: frame.timeoutMs,
        abortSignal: frame.controller.signal,
      }),
    );
  } catch (error) {
    completeFromError(frame, error);
    return outcome;
  }

  running.then(
    (sandboxOutcome) => completeFromOutcome(frame, sandboxOutcome),
    (error: unknown) => completeFromError(frame, error),
  );

  if (options.detach) sendDispatchReceipt(frame);
  return outcome;
}

/** Take at most `max` queued events, oldest first, and forget their scripts. */
function takeEvents(max: number): ReplEvent[] {
  const taken = pendingEvents.splice(0, max);
  for (const event of taken) background.delete(event.evalId);
  return taken;
}

/** Results of dispatched scripts that have settled, oldest first. Consumes them. */
export function drainReplEvents(): ReplEvent[] {
  return takeEvents(Number.POSITIVE_INFINITY);
}

/** How many settled scripts are waiting to be read. */
export function replPendingEventCount(): number {
  return pendingEvents.length;
}

/**
 * Wait for dispatched scripts to settle, up to `timeoutMs`, and answer with at
 * most `max` of them.
 *
 * Returns immediately when something is already queued. An empty answer after the
 * timeout is not an error: a script that legitimately runs for twenty minutes owes
 * the caller nothing sooner, and `Poll`'s job is to say "still running", not to
 * hang until a result exists.
 *
 * `max` is what keeps one answer from being every event at once: whatever is not
 * taken stays queued, so the caller can see that more is pending and read the rest
 * on the next call.
 */
export function waitForReplEvents(
  timeoutMs: number,
  max = Number.POSITIVE_INFINITY,
): Promise<ReplEvent[]> {
  if (pendingEvents.length > 0) return Promise.resolve(takeEvents(max));

  return new Promise<ReplEvent[]>((resolve) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const wake = () => {
      if (timer !== undefined) clearTimeout(timer);
      eventWaiters.delete(wake);
      resolve(takeEvents(max));
    };
    eventWaiters.add(wake);
    timer = setTimeout(
      () => {
        eventWaiters.delete(wake);
        resolve([]);
      },
      Math.max(0, timeoutMs),
    );
  });
}

/**
 * Scripts still running on the caller's context, for `running()` and for `Poll`.
 *
 * `selfId` names the script doing the asking, so it can tell its own entry from
 * its siblings — that is the only thing `self` is for.
 */
export function listRunningReplScripts(selfId?: number): RunningReplScript[] {
  const now = Date.now();
  const scripts: RunningReplScript[] = [];
  for (const frame of background.values()) {
    scripts.push({
      id: frame.id,
      snippet: frame.snippet,
      ageMs: Math.max(0, now - frame.startedAt),
      state: frame.scriptSettled
        ? "settled"
        : frame.closed
          ? "abandoned"
          : frame.stopped
            ? "stopped"
            : frame.waiting > 0
              ? "waiting"
              : "running",
      settled: frame.scriptSettled,
      self: frame.id === selfId,
      abort: () => terminateFrame(frame, ABORTED_MESSAGE),
    });
  }
  scripts.sort((left, right) => left.id - right.id);
  return scripts;
}

/**
 * Release one `(session, agent)` context: the sandbox and every background script
 * it owns. Called for `/clear`, for switching sessions and when a subagent ends —
 * never for compaction, an idle turn, an abort or an exhausted budget.
 */
export function disposeReplRuntime(key: string): void {
  releaseReplSandbox(key);
  for (const frame of [...frames]) {
    if (frame.key !== key) continue;
    if (frame.receiptSent) {
      // The pending result of a subagent's script is dropped with it, so an
      // abandoned script reports nothing anywhere.
      discardScript(frame);
      continue;
    }
    frame.closed = true;
    stopScript(frame, "The REPL runtime was disposed; this script is over.");
  }
  for (const frame of [...background.values()]) {
    if (frame.key === key) discardScript(frame);
  }
}
