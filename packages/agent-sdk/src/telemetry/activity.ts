/**
 * Active time, for the `wave.active_time` counter
 * (see docs/specs/enterprise/opentelemetry.md).
 *
 * Two kinds of active time, the same split Claude Code draws with
 * `claude_code.active_time.total`'s `type` attribute:
 *
 * - `user` — the user at the prompt. Recorded as the gap between two
 *   consecutive user interactions, and **only when that gap is under five
 *   seconds**: a longer gap means the user walked away, and that idle stretch
 *   is not engagement.
 * - `cli` — the agent working: a model call in flight, a tool executing.
 *   Tracked as a set of in-flight operations, so ten parallel tool calls are
 *   one wall-clock stretch rather than ten (a `Set`, not a counter, is what
 *   makes concurrent operations collapse instead of pile up).
 *
 * **Bucketed per session, not per process.** Claude Code is one process per
 * session, so a process-wide singleton is the same thing as a per-session one.
 * Wave's daemon hosts every session at once: a process-wide interval would be
 * split by whichever session happened to close it, handing one session's
 * concurrent work to another. Each session therefore keeps its own operations
 * set and its own open interval, and the records carry that session's
 * attributes. The consequence is deliberate: the sum over sessions is the
 * fleet's total *session* time, which can exceed the process's wall clock when
 * several sessions run at once — this metric never answers "how long was the
 * process alive".
 *
 * Waiting on the user does not count as the agent working: while a permission
 * prompt or a question is up, the session's interval is closed (`beginUserWait`
 * / `endUserWait`), so a prompt left open over lunch does not inflate the
 * number.
 */

import type { RecordContext } from "./metrics.js";
import { recordActiveTime } from "./metrics.js";

/** A gap between two user interactions longer than this is idle, not engaged. */
export const USER_ACTIVITY_TIMEOUT_MS = 5_000;

/** One session's activity state. */
interface SessionActivity {
  /** Ids of the CLI operations in flight, so concurrency collapses to one interval. */
  operations: Set<string>;
  /** User-facing waits in flight — the interval is closed while one is open. */
  waits: number;
  /** Start of the open CLI-active interval, or undefined when idle. */
  since?: number;
  /** Wall clock of the previous user interaction. */
  lastUserActivity?: number;
  /** Attribution of the records this session makes. */
  context: RecordContext;
}

/**
 * The activity state machine. Exported as a class so tests can drive it with
 * their own clock; production uses the module-level instance below.
 */
export class ActivityTracker {
  private sessions = new Map<string, SessionActivity>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  private keyOf(context?: RecordContext): string {
    return context?.sessionId ?? "";
  }

  private stateOf(key: string, context?: RecordContext): SessionActivity {
    let session = this.sessions.get(key);
    if (!session) {
      session = { operations: new Set(), waits: 0, context: context ?? {} };
      this.sessions.set(key, session);
    } else if (context) {
      session.context = context;
    }
    return session;
  }

  /**
   * Close or open the session's interval to match whether the agent is working.
   *
   * Closing records the length of the stretch that just ended — one bounded
   * segment per close, never a running total.
   */
  private settle(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;

    const working = session.operations.size > 0 && session.waits === 0;
    if (working) {
      session.since ??= this.now();
      return;
    }

    if (session.since === undefined) return;
    const seconds = (this.now() - session.since) / 1000;
    session.since = undefined;
    recordActiveTime(seconds, "cli", session.context);
  }

  /** The session's `done` counter for {@link trackOperation}. */
  startOperation(operationId: string, context?: RecordContext): void {
    const key = this.keyOf(context);
    const session = this.stateOf(key, context);

    if (session.operations.has(operationId)) {
      // The same id starting twice means the previous run never ended (a caller
      // died mid-operation, leaving the set non-empty forever). Close its
      // interval first: undercounting a crashed stretch beats letting one
      // interval swallow the idle time that follows it.
      session.operations.delete(operationId);
      this.settle(key);
    }

    session.operations.add(operationId);
    this.settle(key);
  }

  endOperation(operationId: string, context?: RecordContext): void {
    const key = this.keyOf(context);
    const session = this.sessions.get(key);
    if (!session?.operations.delete(operationId)) return;
    this.settle(key);
  }

  /**
   * Note that the user just interacted, and record the gap since the previous
   * interaction when it is short enough to be engagement.
   *
   * CLI time wins: while the agent is working, the same wall clock is already
   * counted as `cli`, so no `user` segment is recorded (the timestamp is still
   * advanced).
   */
  recordUserActivity(context?: RecordContext): void {
    const key = this.keyOf(context);
    const session = this.stateOf(key, context);
    const now = this.now();
    const previous = session.lastUserActivity;

    if (previous !== undefined && session.operations.size === 0) {
      const seconds = (now - previous) / 1000;
      if (seconds > 0 && seconds < USER_ACTIVITY_TIMEOUT_MS / 1000) {
        recordActiveTime(seconds, "user", session.context);
      }
    }

    session.lastUserActivity = now;
  }

  /** The session started waiting on the user (a prompt, a question). */
  beginUserWait(context?: RecordContext): void {
    const key = this.keyOf(context);
    const session = this.stateOf(key, context);
    session.waits++;
    this.settle(key);
  }

  /** The session stopped waiting on the user. */
  endUserWait(context?: RecordContext): void {
    const key = this.keyOf(context);
    const session = this.sessions.get(key);
    if (!session || session.waits === 0) return;
    session.waits--;
    this.settle(key);
  }

  /**
   * Close and forget one session — the interval still open is recorded first,
   * so a session that ends mid-operation reports what it ran for. Pruning also
   * keeps a daemon's map bounded by its live sessions.
   */
  flush(sessionId?: string): void {
    const key = sessionId ?? "";
    const session = this.sessions.get(key);
    if (!session) return;
    if (session.since !== undefined) {
      const seconds = (this.now() - session.since) / 1000;
      session.since = undefined;
      recordActiveTime(seconds, "cli", session.context);
    }
    this.sessions.delete(key);
  }

  /** Drop every session: telemetry was shut down. */
  reset(): void {
    this.sessions.clear();
  }
}

const tracker = new ActivityTracker();
let operationSequence = 0;

/**
 * Count `run` as CLI-active time for its session.
 *
 * Every CLI operation — a model call, a tool execution — is one id, so nested
 * and parallel operations inside a session add up to a single wall-clock
 * stretch. `finally` closes it: a failed call still spent that time.
 */
export async function trackCliOperation<T>(
  kind: "llm" | "tool",
  context: RecordContext | undefined,
  run: () => Promise<T>,
): Promise<T> {
  const operationId = `${kind}:${++operationSequence}`;
  tracker.startOperation(operationId, context);
  try {
    return await run();
  } finally {
    tracker.endOperation(operationId, context);
  }
}

/** Note a user interaction (a message sent), for the `user` half of the metric. */
export function recordUserActivity(context?: RecordContext): void {
  tracker.recordUserActivity(context);
}

/** The session is about to wait on the user; its CLI-active interval closes. */
export function beginUserWait(context?: RecordContext): void {
  tracker.beginUserWait(context);
}

/** The user answered; the session's CLI-active interval reopens if still working. */
export function endUserWait(context?: RecordContext): void {
  tracker.endUserWait(context);
}

/** Record whatever is still open for this session and drop it. */
export function flushSessionActivity(sessionId?: string): void {
  tracker.flush(sessionId);
}

/** Drop all activity state (telemetry shutdown). */
export function resetActivity(): void {
  tracker.reset();
}
