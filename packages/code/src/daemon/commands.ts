/**
 * `wave daemon` client subcommands — talk to the wave daemon's unix socket
 * (JSON-RPC over newline-delimited JSON) to create/destroy sessions, list
 * hosted sessions, inspect progress, inject messages, respond to pending
 * permission requests, abort in-flight message generation, and stop/restart
 * the daemon itself. When the daemon is not running (stopped / killed /
 * machine reboot), every subcommand except `stop` starts one on demand
 * (detached --daemon spawn, the local equivalent of the remote nohup
 * launcher) and retries the connection — once started the daemon stays
 * resident (it does not exit on idle), so a subcommand usually finds it up.
 * `stop` never auto-starts: with no daemon running it is an idempotent no-op.
 *
 * All subcommands are non-interactive: results go to stdout, diagnostics to
 * stderr, and every handler calls process.exit() itself (yargs would fall
 * through to the TUI otherwise). Every command connects to the fixed default
 * socket `~/.wave/daemon.sock` — the daemon only runs on remote hosts, so no
 * `--socket` override is offered (spec: daemon-command.md).
 *
 * Attach semantics: `initialize {workdir, restoreSessionId}` + `restoreSession`
 * re-attach to a live session in the daemon's in-memory registry, or reload a
 * transcript from disk under the current working directory. A session that is
 * nowhere (live registry or disk) silently starts a FRESH session under a
 * different id — the only reliable existence check is the `restoreSession`
 * rejection ("Session not found: <id>"), after which the junk fresh session
 * must be destroyed via the envelope sessionId returned by `initialize`.
 */

import { execFile, spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  getGitMainRepoRoot,
  getMessageContent,
  hasWorktreeCreateHook,
  loadMergedWaveConfig,
  type AskUserQuestion,
  type Message,
  type PermissionDecision,
  type PermissionMode,
  type ToolPermissionContext,
} from "wave-agent-sdk";
import { SocketClient } from "./socketClient.js";

/** Fixed default daemon socket (spec: 默认 socket 固定，无 --socket 覆盖). */
export const DEFAULT_DAEMON_SOCKET = path.join(
  os.homedir(),
  ".wave",
  "daemon.sock",
);

const PERMISSION_MODES: PermissionMode[] = [
  "default",
  "bypassPermissions",
  "acceptEdits",
  "plan",
  "dontAsk",
];

/** How long to wait for an auto-started daemon's socket to come up (mutable so tests can shorten it). */
export const daemonStartTimeout = { ms: 10_000 };
const DAEMON_POLL_INTERVAL_MS = 500;

// ── Connection helpers ─────────────────────────────────────────

function connectDaemon(socketPath: string): Promise<SocketClient> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    socket.once("connect", () => resolve(new SocketClient(socket)));
    socket.once("error", (err) => {
      socket.destroy();
      reject(err);
    });
  });
}

/**
 * Start a wave daemon on demand, detached — the local equivalent of the remote
 * nohup launcher `nohup <wave> --daemon <socket> </dev/null >/dev/null 2>&1 &`
 * (spec: daemon-command.md 按需即用). Re-execs the current wave CLI (`node
 * <this script> --daemon <socket>`) with no stdio and unrefs the child so the
 * client exits without waiting; the daemon cleans stale socket files itself on
 * start.
 */
function startDaemon(socketPath: string): void {
  const entry = process.argv[1];
  if (!entry) {
    fail("Cannot start the wave daemon: unknown CLI entry path");
  }
  const child = spawn(process.execPath, [entry, "--daemon", socketPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

/**
 * Connect or start the daemon on demand: try the socket, and when the daemon is
 * not running, launch one detached and retry until its socket accepts a
 * connection (or daemonStartTimeout.ms elapses). Exits (nonzero) with the
 * spec'd error when the daemon cannot be started/reached.
 */
async function connectDaemonOrExit(socketPath: string): Promise<SocketClient> {
  try {
    return await connectDaemon(socketPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    startDaemon(socketPath);
    const deadline = Date.now() + daemonStartTimeout.ms;
    while (Date.now() < deadline) {
      await sleep(DAEMON_POLL_INTERVAL_MS);
      try {
        return await connectDaemon(socketPath);
      } catch {
        // Daemon still coming up — keep polling.
      }
    }
    console.error(
      `Cannot connect to daemon socket ${socketPath}: started a daemon but it did not come up` +
        (code ? ` (${code})` : ""),
    );
    process.exit(1);
  }
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

interface DaemonSessionEntry {
  sessionId: string;
  workingDirectory: string;
  isLoading: boolean;
  messageCount: number;
}

interface PendingPermission {
  requestId: string;
  sessionId?: string;
  context: ToolPermissionContext;
}

/**
 * Session-scoped notification filter for the `wave daemon` subcommands.
 *
 * The daemon broadcasts every session-scoped notification to EVERY attached
 * client (`DaemonServer`'s emit loops over all connections) and only annotates
 * the envelope with the owning `sessionId` — demultiplexing is the client's job,
 * which is how the hosts do it (the SDK/JB `NotificationRouter` drops
 * notifications for sessions it has not registered). These subcommands instead
 * applied every push to their own local state, so another session's turn ending
 * (`loadingChange:false`) settled a `wait` that was watching a still-generating
 * session: exit code 0 with a `Status: idle` snapshot, and a foreign
 * `loadingChange:true` satisfied `--from-busy` for a session that never went busy.
 *
 * A notification without a `sessionId` is a global one (e.g. `authUrl`), never
 * another session's state, so it passes.
 *
 * The filter is bound to a session only once `initialize` returns, but the
 * subscription must be installed BEFORE it — the attach replay that carries the
 * settle-time snapshot is emitted from inside `restoreSession`
 * (spec: 订阅早于 initialize/restoreSession 以接收重放). Until `bind` runs
 * nothing matches, which is correct: no session of ours can push yet. See
 * `attachSession`'s `onInitialized` for that hand-off point.
 */
function sessionNotificationFilter(): {
  bind: (sessionId: string) => void;
  accepts: (sessionId: string | undefined) => boolean;
} {
  let attached: string | undefined;
  return {
    bind: (sessionId) => {
      attached = sessionId;
    },
    accepts: (sessionId) => sessionId === undefined || sessionId === attached,
  };
}

/**
 * Attach to a session; returns the initialized sessionId + working directory.
 * Exits (nonzero) with the spec'd error when the session exists neither in the
 * daemon registry nor on disk, destroying the fresh session that `initialize`
 * silently created.
 */
async function attachSession(
  client: SocketClient,
  sessionId: string,
  options: {
    /**
     * Called with the sessionId `initialize` resolved — after `initialize`,
     * before `restoreSession`. That is the only moment a caller's notification
     * filter can learn which session this connection is attached to: the
     * subscription itself is installed earlier, the attach replay arrives later
     * (see `sessionNotificationFilter`).
     */
    onInitialized?: (sessionId: string) => void;
  } = {},
): Promise<{ sessionId: string; workingDirectory: string }> {
  const init = (await client.request("initialize", {
    workdir: process.cwd(),
    restoreSessionId: sessionId,
  })) as { sessionId: string; workingDirectory: string };
  const initId = init.sessionId;
  options.onInitialized?.(initId);
  try {
    await client.request("restoreSession", { sessionId }, initId);
  } catch (err) {
    if ((err as Error).message.includes("Session not found")) {
      // initialize silently started a junk fresh session — remove it from the
      // registry so the failed attach leaves no trace (spec: 会话不存在错误).
      await client.request("destroy", undefined, initId).catch(() => {});
      fail(`Session not found or not hosted by this daemon: ${sessionId}`);
    }
    throw err;
  }
  return init;
}

async function listPendingPermissions(
  client: SocketClient,
): Promise<PendingPermission[]> {
  const result = (await client.request("listPendingPermissions")) as {
    requests: PendingPermission[];
  };
  return result.requests ?? [];
}

/**
 * The daemon's in-memory registry entry for `sessionId`, or undefined when the
 * session is no longer hosted.
 *
 * The registry (not notifications) is the authority on both facts the waiter
 * needs: existence and whether the session is still generating. `destroy` drops
 * the entry, and the only notifications that come with it are side effects of
 * the agent teardown — `loadingChange:false` (destroy aborts, which clears the
 * loading flag) plus a few no-op state re-emits. A `loading:false` push is
 * indistinguishable from "the turn finished", so it can never be read as "the
 * session is gone"; and it happens once, during the destroy, so a waiter that
 * does not act on it is left with no further event and blocks forever.
 *
 * The same reasoning applies to the loading flag itself: a pushed
 * `loadingChange` can be a transient (an aborted turn re-dispatches a queued one
 * a millisecond later) and — since the daemon broadcasts to every client, see
 * `sessionNotificationFilter` — it can even describe a different session. So
 * `wait` reads `isLoading` from here on every wake and treats the push as a
 * pure wake-up signal.
 */
async function findHostedSession(
  client: SocketClient,
  sessionId: string,
): Promise<DaemonSessionEntry | undefined> {
  const result = (await client.request("listDaemonSessions")) as {
    sessions: DaemonSessionEntry[];
  };
  return (result.sessions ?? []).find((s) => s.sessionId === sessionId);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** sleep() that can be cancelled, so a lost race never leaves a live timer behind. */
function sleepCancellable(ms: number): {
  promise: Promise<void>;
  cancel: () => void;
} {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

// ── create ─────────────────────────────────────────────────────

export interface CreateOptions {
  /** Working directory for the new session (default: current directory). */
  workdir?: string;
  /** Permission mode for the new session (default: bypassPermissions). */
  permissionMode?: string;
  /** Model override for the new session (default: configured model). */
  model?: string;
  /** Create the session in a new git worktree (name auto-generated when omitted). */
  worktree?: string;
}

/**
 * Create a fresh session in the daemon. initialize WITHOUT restoreSessionId
 * always creates a brand-new session (never an attach), so no existence checks
 * are needed. Defaults mirror the daemon's background-task use case: workdir =
 * current directory, permissionMode = bypassPermissions. With --worktree the
 * daemon first creates a git worktree (protocol createWorktree) and the session
 * is created inside it. Prints the new sessionId (first line, for scripts),
 * plus the worktree path/branch when --worktree was used.
 */
export async function daemonCreateCommand(
  socketPath: string,
  options: CreateOptions = {},
): Promise<void> {
  const mode = options.permissionMode ?? "bypassPermissions";
  if (!PERMISSION_MODES.includes(mode as PermissionMode)) {
    fail(
      `Invalid permission mode: ${mode} (options: ${PERMISSION_MODES.join(", ")})`,
    );
  }
  let client: SocketClient | undefined;
  try {
    client = await connectDaemonOrExit(socketPath);
    let workdir = options.workdir ?? process.cwd();
    let worktreePath: string | undefined;
    let worktreeBranch: string | undefined;
    if (options.worktree !== undefined) {
      const wt = (await client.request("createWorktree", {
        workdir,
        name: options.worktree,
      })) as { name: string; path: string; branch: string; repoRoot: string };
      workdir = wt.path;
      worktreePath = wt.path;
      worktreeBranch = wt.branch;
    }
    const result = (await client.request("initialize", {
      workdir,
      permissionMode: mode,
      model: options.model,
    })) as { sessionId: string };
    console.log(result.sessionId);
    if (worktreePath !== undefined) {
      console.log(`Worktree: ${worktreePath} (branch: ${worktreeBranch})`);
    }
  } catch (err) {
    fail(`wave daemon create failed: ${(err as Error).message}`);
  } finally {
    await client?.dispose();
  }
  process.exit(0);
}

// ── list ───────────────────────────────────────────────────────

export async function daemonListCommand(socketPath: string): Promise<void> {
  let client: SocketClient | undefined;
  try {
    client = await connectDaemonOrExit(socketPath);
    const result = (await client.request("listDaemonSessions")) as {
      sessions: DaemonSessionEntry[];
    };
    const sessions = result.sessions ?? [];

    if (sessions.length > 0) {
      const rows = sessions.map((s) => ({
        sessionId: s.sessionId,
        status: s.isLoading ? "generating" : "idle",
        messageCount: String(s.messageCount),
        workingDirectory: s.workingDirectory,
      }));
      const width = (key: keyof (typeof rows)[number]) =>
        Math.max(...rows.map((r) => r[key].length), key.length);
      const pad = (value: string, w: number) => value.padEnd(w);

      console.log(
        `${pad("Session", width("sessionId"))}  ${pad("Status", width("status"))}  ${pad("Messages", width("messageCount"))}  Working directory`,
      );
      for (const r of rows) {
        console.log(
          `${pad(r.sessionId, width("sessionId"))}  ${pad(r.status, width("status"))}  ${pad(r.messageCount, width("messageCount"))}  ${r.workingDirectory}`,
        );
      }
    } else {
      // Daemon idle-exit is normal — an empty registry is not an error.
      console.log("No sessions");
    }
  } catch (err) {
    fail(`wave daemon list failed: ${(err as Error).message}`);
  } finally {
    await client?.dispose();
  }
  // Exits outside the try so the success path's exit is never re-wrapped by the
  // error handler above.
  process.exit(0);
}

// ── status ─────────────────────────────────────────────────────

function summarizeToolInput(context: ToolPermissionContext): string {
  const input = context.toolInput;
  if (!input || Object.keys(input).length === 0) return "";
  let text: string;
  try {
    text = JSON.stringify(input);
  } catch {
    text = "";
  }
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

/** The questions array of an AskUserQuestion toolInput (SDK schema), if any. */
function getAskUserQuestions(
  context: ToolPermissionContext,
): AskUserQuestion[] | undefined {
  const raw = context.toolInput?.questions;
  return Array.isArray(raw) && raw.length > 0
    ? (raw as AskUserQuestion[])
    : undefined;
}

/**
 * Multi-line full render of an AskUserQuestion tool input, mirroring the
 * desktop ConfirmationDialog layout so the CLI user sees every question and
 * option (spec: daemon-command.md AskUserQuestion 多行完整渲染). Question
 * lines carry the 1-based question number + header; option lines carry the
 * 0-based number that `respond --answer` accepts.
 */
function renderAskUserQuestions(context: ToolPermissionContext): string {
  const questions = getAskUserQuestions(context);
  if (!questions) return "";
  return questions
    .map((q, qi) => {
      const title = `    Q${qi + 1} [${q.header}] ${q.question}`;
      const options = (q.options ?? []).map(
        (o, oi) =>
          `      ${oi}. ${o.label}${o.description ? ` — ${o.description}` : ""}`,
      );
      return [title, ...options].join("\n");
    })
    .join("\n");
}

/**
 * Parse `respond --answer` for an AskUserQuestion request. Legacy format — a
 * valid JSON object keyed by the full question text (value = the option label,
 * exactly what the desktop dialog would submit) — passes through untouched.
 * Anything else is parsed as comma-separated option numbers: the i-th number
 * answers the i-th question (as numbered Q1..Qn by `wave daemon status`),
 * 0-based like the status rendering, and is mapped to that option's label so
 * the model sees the same answers the GUI would produce.
 */
function parseAskUserQuestionAnswer(
  raw: string,
  context: ToolPermissionContext,
): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      !Array.isArray(parsed)
    ) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Not JSON — fall through to per-question option numbers below.
  }
  const questions = getAskUserQuestions(context);
  if (!questions) {
    fail(
      `Cannot parse --answer "${raw}": not a JSON object of {question: answer} and the pending request has no questions to answer by number`,
    );
  }
  const numbers = raw.split(",").map((n) => n.trim());
  if (numbers.length !== questions.length) {
    fail(
      `--answer must give one option number per question (${questions.length} question${questions.length > 1 ? "s" : ""}, comma-separated, matching the numbering in \`wave daemon status\`): got ${numbers.length} number${numbers.length > 1 ? "s" : ""} in "${raw}"`,
    );
  }
  const answers: Record<string, unknown> = {};
  numbers.forEach((n, qi) => {
    const q = questions[qi];
    if (!/^\d+$/.test(n)) {
      fail(
        `--answer contains a non-numeric option number "${n}" for question ${qi + 1} (${q.question})`,
      );
    }
    const options = q.options ?? [];
    const idx = Number(n);
    if (idx >= options.length) {
      fail(
        `Option number ${n} is out of range for question ${qi + 1} (${q.question}): options are numbered 0..${options.length - 1}`,
      );
    }
    const label = options[idx].label;
    answers[q.question] = q.multiSelect ? [label] : label;
  });
  return answers;
}

interface SessionSnapshot {
  sessionId: string;
  workingDirectory: string;
  /** `idle` / `generating` / `waiting for approval`. */
  status: string;
  pending: PendingPermission[];
  messages: Message[];
  /** Trailing messages to render; 0 renders no message text at all. */
  lines: number;
}

/**
 * Render the session snapshot shared by `status` and `wait` (they must be
 * byte-compatible so `msg=$(wave daemon wait <id>)` yields exactly what
 * `wave daemon status <id>` prints): the header, the `Status:` line, the pending
 * approval list (AskUserQuestion rendered in full, see renderAskUserQuestions)
 * and the last `lines` messages. `lines <= 0` renders no message text at all —
 * the status-line-only shape for monitors. Guards against 0 because
 * `Array.prototype.slice(-0)` means `slice(0)`, i.e. the WHOLE history.
 */
function renderSessionSnapshot(snapshot: SessionSnapshot): void {
  console.log(`Session: ${snapshot.sessionId}`);
  console.log(`Working directory: ${snapshot.workingDirectory}`);
  console.log(`Status: ${snapshot.status}`);

  if (snapshot.pending.length > 0) {
    console.log("");
    console.log("Pending approval requests:");
    for (const r of snapshot.pending) {
      if (r.context.toolName === ASK_USER_QUESTION_TOOL_NAME) {
        const questions = renderAskUserQuestions(r.context);
        if (questions) {
          console.log(`  ${r.requestId}  ${r.context.toolName}`);
          console.log(questions);
          continue;
        }
      }
      const params = summarizeToolInput(r.context);
      console.log(
        `  ${r.requestId}  ${r.context.toolName}${params ? `  ${params}` : ""}`,
      );
    }
  }

  const recent =
    snapshot.lines > 0 ? snapshot.messages.slice(-snapshot.lines) : [];
  if (recent.length > 0) {
    console.log("");
    console.log(`Recent messages (${recent.length}):`);
    for (const m of recent) {
      const text = getMessageContent(m).replace(/\s+/g, " ").trim();
      if (!text) continue; // tool-only messages carry no readable text
      console.log(`  [${m.role}] ${text}`);
    }
  }
}

/**
 * `wave daemon status <sessionId> [--lines N]`.
 *
 * `lines` is the number of trailing messages to render (default 1 — the last
 * message alone, so the default output stays bounded even when one message is a
 * multi-thousand-character report). `lines <= 0` renders no message text at all
 * (just the session header + `Status:` line) — the polling shape for monitors
 * that only watch the status. A one-shot snapshot that always returns
 * immediately; blocking on a state change is `daemonWaitCommand`.
 */
export async function daemonStatusCommand(
  socketPath: string,
  sessionId: string,
  lines = 1,
): Promise<void> {
  let client: SocketClient | undefined;
  try {
    client = await connectDaemonOrExit(socketPath);

    // Subscribe BEFORE initialize/restoreSession so the replayed loadingChange
    // snapshot is captured (spec: 依据重放的 loadingChange 快照显示状态); drop
    // other sessions' pushes so the snapshot reports THIS session (a foreign
    // turn's loadingChange used to flip this flag).
    let loading = false;
    const filter = sessionNotificationFilter();
    client.onNotification("loadingChange", (params, sessionId) => {
      if (!filter.accepts(sessionId)) return;
      loading = (params as { loading: boolean }).loading;
    });

    const init = await attachSession(client, sessionId, {
      onInitialized: filter.bind,
    });
    const initId = init.sessionId;

    // listPendingPermissions is the authoritative "waiting for approval" signal
    // (spec: 单凭消息无法区分等审批与执行中，须结合 listPendingPermissions).
    const pending = (await listPendingPermissions(client)).filter(
      (r) => r.sessionId === initId || r.sessionId === sessionId,
    );
    const messages = (await client.request(
      "getMessages",
      undefined,
      initId,
    )) as {
      messages: Message[];
    };

    const status =
      pending.length > 0
        ? "waiting for approval"
        : loading
          ? "generating"
          : "idle";
    renderSessionSnapshot({
      sessionId: initId,
      workingDirectory: init.workingDirectory,
      status,
      pending,
      messages: messages.messages,
      lines,
    });
  } catch (err) {
    fail(`wave daemon status failed: ${(err as Error).message}`);
  } finally {
    await client?.dispose();
  }
  process.exit(0);
}

// ── wait ───────────────────────────────────────────────────────

export interface WaitOptions {
  /** Recent messages to render on exit (default 1; 0 = status line only). */
  lines?: number;
  /** Require at least one observed busy phase before accepting idle. */
  fromBusy?: boolean;
  /** Seconds to wait before giving up; undefined waits forever. */
  timeout?: number;
}

/**
 * How often the wait re-asks the daemon registry (`listDaemonSessions`) and the
 * pending-approval list (`listPendingPermissions`) — the facts that cannot be
 * trusted to a push. Approvals push nothing at all (spec: 单凭消息无法区分等审批与执行中);
 * a destroyed session pushes only `loadingChange:false`, which is what a
 * finished turn looks like; and the loading flag itself is re-read from the
 * registry rather than taken from the push. This is "go ask the daemon about
 * the facts", not the "poll the status every N seconds" pattern the push-driven
 * wait exists to replace (spec: `wait` 的退出码是契约): a wake-up still comes
 * from our own session's `loadingChange`, and this tick is only the backstop for
 * pushes that never arrive. A local socket round-trip is cheap but busy-polling
 * it is still wrong — never faster than 1s. Mutable so tests can shorten it.
 */
export const waitPollInterval = { ms: 2_000 };

/**
 * `wave daemon wait <sessionId> [--lines N] [--from-busy] [--timeout <秒>]`.
 *
 * Block until the session settles, print the final snapshot — byte-compatible
 * with `wave daemon status <sessionId> --lines N`, so
 * `msg=$(wave daemon wait <id>)` captures the report itself — and exit:
 * `0` = idle, `3` = waiting for permission approval (returned immediately,
 * never waited out), `1` = error (unreachable daemon / unknown session /
 * `--timeout` elapsed). stdout carries the snapshot only; progress goes to
 * stderr.
 *
 * Idle is decided from the daemon registry, woken by pushes. The
 * `loadingChange` subscription (installed BEFORE initialize/restoreSession, so
 * the attach replay is not missed) is filtered to THIS session and used purely
 * as a wake-up: the loop then re-reads the authoritative `isLoading` from the
 * registry it already queries for the existence check — the daemon is never
 * polled for status on a timer. Reading the flag from the registry rather than
 * from the notification matters because a pushed `loadingChange` can be a
 * transient (an aborted turn re-dispatches a queued one a millisecond later) and,
 * since the daemon broadcasts to every client, it can even describe another
 * session (`sessionNotificationFilter`).
 *
 * Decision order is existence → pending (3) → idle (0) → timeout (1).
 * Existence comes first because a destroyed session's only announcement is
 * `loadingChange:false` (destroy aborts the turn), which is indistinguishable
 * from a finish: read as idle it reports a false "done" for a session that is
 * gone, and a waiter that does not act on it gets no further event at all and
 * hangs (which is what happened before this check existed).
 *
 * A session that gets RE-KEYED while we block on it is followed, not mourned:
 * `clearMessages` / `initializeFromSession` / a recovery-recreating
 * `updateConfig` move the daemon registry entry to a new sessionId and announce
 * it with `sessionIdChange` (envelope = the id we know, payload = the new one),
 * so the waiter rebinds its filter and its id and keeps watching the same
 * session — a re-key is not a destroy (spec: 换键不等于销毁).
 */
export async function daemonWaitCommand(
  socketPath: string,
  sessionId: string,
  options: WaitOptions = {},
): Promise<void> {
  const lines = options.lines ?? 1;
  const fromBusy = options.fromBusy ?? false;
  const timeoutMs =
    options.timeout !== undefined ? options.timeout * 1000 : undefined;

  let client: SocketClient | undefined;
  let exitCode = 0;
  try {
    const socket = await connectDaemonOrExit(socketPath);
    client = socket;

    let sawBusy = false;
    // Push-driven wake: the deferred is re-armed on every bump and the loop
    // re-reads the registry after every await, so no loadingChange can be
    // missed. Foreign sessions are filtered out so a crowded daemon cannot turn
    // their pushes into wake-ups (spec: 只认本会话的推送).
    let resolveWake: (() => void) | undefined;
    let wakePromise = new Promise<void>((resolve) => {
      resolveWake = resolve;
    });
    const bump = () => {
      const resolve = resolveWake;
      wakePromise = new Promise<void>((r) => {
        resolveWake = r;
      });
      resolve?.();
    };
    const filter = sessionNotificationFilter();
    socket.onNotification("loadingChange", (params, sid) => {
      if (!filter.accepts(sid)) return;
      // The payload is only a hint that OUR session changed: `--from-busy`
      // accepts it as one way to observe the busy phase, while the idle
      // decision below comes from the registry.
      if ((params as { loading: boolean }).loading) sawBusy = true;
      bump();
    });

    // A session can be RE-KEYED while we block on it — `clearMessages` (which
    // mints a fresh id) or `initializeFromSession` with another id moves the
    // daemon registry entry to a new sessionId; `updateConfig` does the same when
    // its recreate cannot restore the transcript. The re-key is announced (this
    // notification, envelope = the id we know, payload = the new one) and the
    // registry key moves in the same tick, so a waiter that keeps using the old id
    // both misses it in `listDaemonSessions` (⇒ false "no longer exists", exit 1,
    // for a session that is alive) and stops receiving its pushes. Follow the
    // rename instead: same session, new id — nothing about it was destroyed.
    // `watch.id` is the id this waiter tracks: empty until the attach below binds
    // it, then the live id, re-pointed by every rename we see.
    const watch = { id: "" };
    socket.onNotification("sessionIdChange", (params, sid) => {
      const next = (params as { sessionId?: string }).sessionId;
      // Envelope-less renames are fired while an agent is being CREATED (its
      // context has no id yet): they belong to the attach handshake below, whose
      // reply carries the final id, so there is nothing to follow here. A rename
      // seen before we know our id would mean the daemon re-keyed the session mid
      // handshake — the attach itself gives up on that (its `restoreSession` still
      // carries the pre-rename id), which is a separate, pre-existing gap.
      if (sid === undefined || !next || !watch.id) return;
      if (!filter.accepts(sid)) return; // another session's rename
      watch.id = next;
      filter.bind(next);
      bump();
    });

    const init = await attachSession(socket, sessionId, {
      onInitialized: (id) => {
        watch.id = id;
        filter.bind(id);
      },
    });

    // Read against the tracked session, retrying when a re-key lands while the
    // read is in flight. The daemon announces the rename and moves the registry
    // entry in one tick, but a request sent moments earlier under the OLD id is
    // answered only afterwards — and its answer then describes an id that no
    // longer exists: a miss for a session that is very much alive ("no longer
    // exists" / exit 1) or a "Session not found" from the settle read. An answer
    // that a re-key invalidated is not evidence, so ask again on the new id. The
    // loop only repeats when a rename notification actually arrived, so it cannot
    // spin without the daemon re-keying the session over and over.
    const read = async <T>(fn: (id: string) => Promise<T>): Promise<T> => {
      for (;;) {
        const id = watch.id;
        try {
          const result = await fn(id);
          if (watch.id !== id) continue;
          return result;
        } catch (err) {
          if (watch.id !== id) continue;
          throw err;
        }
      }
    };

    // listPendingPermissions is the authoritative "waiting for approval" signal
    // (spec: 单凭消息无法区分等审批与执行中，须结合 listPendingPermissions).
    const pendingForSession = (): Promise<PendingPermission[]> =>
      read(async (id) => {
        const all = await listPendingPermissions(socket);
        return all.filter(
          (r) =>
            r.sessionId === id ||
            r.sessionId === init.sessionId ||
            r.sessionId === sessionId,
        );
      });

    const settle = async (status: string, pending: PendingPermission[]) => {
      const result = (await read(
        (id) =>
          socket.request("getMessages", undefined, id) as Promise<{
            messages: Message[];
          }>,
      )) as {
        messages: Message[];
      };
      renderSessionSnapshot({
        sessionId: watch.id,
        workingDirectory: init.workingDirectory,
        status,
        pending,
        messages: result.messages ?? [],
        lines,
      });
    };

    const deadline =
      timeoutMs !== undefined ? Date.now() + timeoutMs : undefined;
    let announced = false;
    while (true) {
      // Session existence FIRST (spec: 阻塞等待会话空闲 场景 10). A session
      // destroyed by another client — `wave daemon destroy <id>` while this
      // daemon keeps running — announces itself only as `loadingChange:false`
      // (destroy aborts the turn, which clears the loading flag) plus a few
      // no-op state re-emits. That is not a usable signal: `loading:false` is
      // exactly what "the turn finished" looks like, so a waiter that does not
      // act on the wake is left with no further event and blocks forever —
      // which is what happened before this check existed. Ask the registry
      // instead: this query also carries the authoritative `isLoading`, which is
      // what the idle decision below uses. It rides the same low-frequency
      // fallback tick as the approval check — that tick is the backstop, while
      // the ordinary wake-up is our own session's `loadingChange`. The order
      // matters: the destroy's `loadingChange:false` describes a session whose
      // registry entry is about to disappear, so deciding idle first could
      // report a settled session that no longer exists — a false success is
      // worse than hanging.
      // A miss is never an unfollowed rename: the daemon writes
      // `sessionIdChange` and moves the registry entry in the same tick, and a
      // read answered under an id a rename superseded is retried rather than
      // trusted (`read` above). What is left is a session that really is gone.
      const hosted = await read((id) => findHostedSession(socket, id));
      if (!hosted) {
        fail(
          `wave daemon wait failed: Session ${sessionId} no longer exists (destroyed while waiting)`,
        );
      }
      // A busy reading from the registry is an observed busy phase too:
      // `--from-busy` must not depend on having caught a `loadingChange:true`
      // push (a turn that started before this waiter attached pushes none, and
      // the replay is only as fresh as the moment of the attach).
      if (hosted.isLoading) sawBusy = true;
      // Approvals beat idle, and the check runs BEFORE the idle decision — a
      // session frozen on an approval keeps `loading: true` (so it would never
      // settle) and one that just turned `loading: false` must not be mistaken
      // for finished before the pending list is consulted.
      const pending = await pendingForSession();
      if (pending.length > 0) {
        await settle("waiting for approval", pending);
        exitCode = 3;
        break;
      }
      // Idle comes from the registry, never from a single push: already idle at
      // call time settles immediately — never hanging beats winning the race.
      // --from-busy holds out for an observed busy phase first: right after an
      // async `send` the replayed snapshot can still be a stale loading:false
      // (the turn has not started yet).
      if (!hosted.isLoading && (!fromBusy || sawBusy)) {
        await settle("idle", []);
        break;
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        fail(
          `Timed out waiting for session ${sessionId} to become idle (waited ${options.timeout}s); it is still generating`,
        );
      }
      if (!announced) {
        announced = true;
        console.error(`Waiting for session ${watch.id} to become idle…`);
      }
      const tick = sleepCancellable(waitPollInterval.ms);
      const timer =
        deadline !== undefined
          ? sleepCancellable(Math.max(0, deadline - Date.now()))
          : undefined;
      await Promise.race([
        wakePromise,
        tick.promise,
        ...(timer ? [timer.promise] : []),
      ]);
      tick.cancel();
      timer?.cancel();
    }
  } catch (err) {
    fail(`wave daemon wait failed: ${(err as Error).message}`);
  } finally {
    await client?.dispose();
  }
  process.exit(exitCode);
}

// ── send ───────────────────────────────────────────────────────

export interface SendOptions {
  /** Seconds to wait for the reply; 0 (default) = async dispatch: inject the
   * message and exit immediately without waiting (fire-and-forget). */
  wait: number;
}

/**
 * Inject a message into a session and, when `--wait <N>` is given, wait for the
 * reply that corresponds to it and print the pure final reply text.
 *
 * Default (no --wait) is async dispatch: the command exits 0 as soon as the
 * message is delivered (the message lands in history on an idle session, or is
 * enqueued when the session is busy) — the sender never blocks on the reply,
 * progress is tracked via `status` (spec: send 默认异步派单).
 *
 * Completion detection (wait mode): `sendMessage` on an idle session resolves
 * only after the whole turn finishes (InteractionService awaits
 * sendAIMessage), while on a busy session it enqueues and returns immediately —
 * so stopping on a bare `loadingChange:false` would exit early on the PREVIOUS
 * turn's completion when queued behind a busy session. Instead, track the
 * message IDs: `ourUserMessage` is the user message added when OUR turn starts
 * (userMessageAdded), and the reply is the last assistantMessageAdded observed
 * after it. A stale loading:false can then never satisfy the wait condition
 * early (the reply has not been added yet).
 *
 * The tracked session id follows a re-key (`sessionIdChange`) for the same reason
 * `wait` does: the reply arrives on the NEW id, so a waiter still bound to the old
 * one would drop the pushes that complete it and report a false timeout, and its
 * `getMessages` would come back "Session not found".
 */
export async function daemonSendCommand(
  socketPath: string,
  sessionId: string,
  message: string,
  options: SendOptions = { wait: 0 },
): Promise<void> {
  // connectDaemonOrExit exits on failure — no client to dispose in that case.
  const client = await connectDaemonOrExit(socketPath);

  let loading = false;
  let sent = false;
  let ourUserMessageId: string | undefined;
  let replyMessageId: string | undefined;
  // Only THIS session's pushes may move the state below: the daemon broadcasts
  // every session's notifications to every client, so an unfiltered
  // `userMessageAdded` / `assistantMessageAdded` / `loadingChange` from a
  // concurrent session could report "sent" before our message landed and pair
  // the reply tracking with another conversation's messages
  // (see sessionNotificationFilter).
  const filter = sessionNotificationFilter();
  // `watch.id` is the session this send is attached to — empty until the attach
  // binds it, then the live id, re-pointed when the daemon re-keys the session
  // (see the matching handler in daemonWaitCommand): completion is detected from
  // THIS session's pushes, so a waiter left on the pre-rename id would drop them
  // and report a false `--wait` timeout for a turn that is still running.
  const watch = { id: "" };
  client.onNotification("sessionIdChange", (params, sessionId) => {
    const next = (params as { sessionId?: string }).sessionId;
    if (sessionId === undefined || !next || !watch.id) return;
    if (!filter.accepts(sessionId)) return;
    watch.id = next;
    filter.bind(next);
  });
  client.onNotification("userMessageAdded", (params, sessionId) => {
    if (!filter.accepts(sessionId)) return;
    if (!sent) return; // ignore messages added during attach
    ourUserMessageId = (params as { message: Message }).message.id;
  });
  client.onNotification("assistantMessageAdded", (params, sessionId) => {
    if (!filter.accepts(sessionId)) return;
    if (!sent || ourUserMessageId === undefined) return; // not our turn yet
    replyMessageId = (params as { message: Message }).message.id;
  });
  client.onNotification("loadingChange", (params, sessionId) => {
    if (!filter.accepts(sessionId)) return;
    loading = (params as { loading: boolean }).loading;
  });

  try {
    await attachSession(client, sessionId, {
      onInitialized: (id) => {
        watch.id = id;
        filter.bind(id);
      },
    });
    sent = true;
  } catch (err) {
    client.dispose();
    fail(`wave daemon send failed: ${(err as Error).message}`);
  }

  if (options.wait <= 0) {
    // Async dispatch mode (default, --wait 0): exit as soon as the message is
    // DELIVERED, not when the turn completes. The sendMessage RPC resolves only
    // after the whole turn on an idle session (InteractionService awaits
    // sendAIMessage) but returns right after enqueueing on a busy session — so
    // delivery is the earlier of our userMessageAdded notification (idle: the
    // message lands in history before the turn starts) and the RPC response
    // itself (busy: enqueued immediately). The daemon keeps running the turn
    // after this client disconnects (attach 语义) — progress is tracked via
    // `status` (spec: send 默认异步派单).
    const sendPromise = client.request(
      "sendMessage",
      { text: message },
      watch.id,
    );
    const userMessage = new Promise<"userMessageAdded">((resolve) => {
      client.onNotification("userMessageAdded", (params, sessionId) => {
        if (!filter.accepts(sessionId)) return;
        if (ourUserMessageId !== undefined) resolve("userMessageAdded");
      });
    });
    try {
      await Promise.race([sendPromise, userMessage]);
    } catch (err) {
      client.dispose();
      fail(`wave daemon send failed: ${(err as Error).message}`);
    }
    client.dispose();
    console.log(`Sent message to session: ${sessionId}`);
    process.exit(0);
  }

  try {
    await client.request("sendMessage", { text: message }, watch.id);
  } catch (err) {
    client.dispose();
    fail(`wave daemon send failed: ${(err as Error).message}`);
  }

  // Wait for the reply that corresponds to our message (--wait N mode). N is
  // the seconds bound of the wait; the loop never hangs indefinitely (spec:
  // --wait 兜底避免无限挂起).
  const started = Date.now();
  const timeoutMs = options.wait * 1000;
  while (!(loading === false && replyMessageId !== undefined)) {
    if (Date.now() - started > timeoutMs) {
      // Timeout backstop: the most likely cause is a session waiting on a
      // permission approval — point the user at respond (spec: 不无限期挂起).
      const pending = (await listPendingPermissions(client)).filter(
        (r) => r.sessionId === sessionId || r.sessionId === watch.id,
      );
      client.dispose();
      if (pending.length > 0) {
        fail(
          `Session is waiting for permission approval; handle it with \`wave daemon respond ${sessionId} ${pending[0].requestId}\` and retry`,
        );
      }
      fail(
        `Timed out waiting for a reply (${options.wait}s), no assistant reply received`,
      );
    }
    await sleep(200);
  }

  try {
    const result = (await client.request(
      "getMessages",
      undefined,
      watch.id,
    )) as {
      messages: Message[];
    };
    const reply = result.messages.find((m) => m.id === replyMessageId);
    // Pure final-reply text only; streaming deltas / subagent internals never
    // reach stdout (spec: send 输出纯净性).
    if (reply) {
      const content = getMessageContent(reply).replace(/\s+/g, " ").trim();
      if (content) {
        console.log(content);
      } else if (reply.blocks.some((b) => b.type === "reasoning")) {
        // Interrupted mid-generation (e.g. `wave daemon abort`): the reply was
        // finalized with reasoning but no text. Surface the interruption
        // instead of silently exiting 0 with no output (spec: 中断需明确提示).
        fail("Message aborted before producing a reply");
      }
    } else {
      fail("No reply received for the message");
    }
  } catch (err) {
    fail(`wave daemon send failed: ${(err as Error).message}`);
  } finally {
    client.dispose();
  }
  process.exit(0);
}

// ── respond ────────────────────────────────────────────────────

export interface RespondOptions {
  allow?: boolean;
  deny?: boolean;
  reason?: string;
  answer?: string;
  rule?: string;
  mode?: string;
}

export async function daemonRespondCommand(
  socketPath: string,
  sessionId: string,
  requestId: string,
  options: RespondOptions,
): Promise<void> {
  if (!!options.allow === !!options.deny) {
    fail("Specify either --allow or --deny");
  }
  let client: SocketClient | undefined;
  try {
    client = await connectDaemonOrExit(socketPath);

    // The server silently ignores permissionResponse for unknown requestIds —
    // validate first so the user is never misled into thinking approval landed.
    const pending = await listPendingPermissions(client);
    const req = pending.find((r) => r.requestId === requestId);
    if (!req) {
      fail("Request not found or already handled");
    }
    if (req.sessionId && req.sessionId !== sessionId) {
      // Cross-check before notifying; never touch another session's request.
      fail("Session not found or not hosted by this daemon");
    }

    let decision: PermissionDecision;
    if (options.deny) {
      decision = { behavior: "deny", message: options.reason };
    } else {
      // Per-tool auto-completion, mirroring the desktop ConfirmationDialog
      // semantics (spec: 决策并非单一 allow/deny，须按工具智能补全).
      const toolName = req.context.toolName;
      if (toolName === ENTER_PLAN_MODE_TOOL_NAME) {
        decision = { behavior: "allow", newPermissionMode: "plan" };
      } else if (toolName === EXIT_PLAN_MODE_TOOL_NAME) {
        decision = { behavior: "allow", newPermissionMode: "default" };
      } else if (toolName === ASK_USER_QUESTION_TOOL_NAME) {
        if (!options.answer) {
          fail(
            'AskUserQuestion requests require --answer: a JSON object of {question: answer}, or option numbers per question (e.g. "0" or "1,0", see the numbering in `wave daemon status`)',
          );
        }
        const answers = parseAskUserQuestionAnswer(options.answer, req.context);
        decision = { behavior: "allow", message: JSON.stringify(answers) };
      } else {
        decision = { behavior: "allow" };
      }

      if (options.rule) decision.newPermissionRule = options.rule;
      if (options.mode) {
        if (!PERMISSION_MODES.includes(options.mode as PermissionMode)) {
          fail(
            `Invalid permission mode: ${options.mode} (options: ${PERMISSION_MODES.join(", ")})`,
          );
        }
        decision.newPermissionMode = options.mode as PermissionMode;
      }
    }

    // Mirror desktop stdioAgent.sendPermissionResponse: envelope sessionId
    // present, decision built from the pending request's tool.
    client.notify("permissionResponse", { requestId, decision }, sessionId);
    console.log(`Handled approval request: ${requestId}`);
  } catch (err) {
    fail(`wave daemon respond failed: ${(err as Error).message}`);
  } finally {
    await client?.dispose();
  }
  process.exit(0);
}

// ── abort ─────────────────────────────────────────────────────

export async function daemonAbortCommand(
  socketPath: string,
  sessionId: string,
): Promise<void> {
  let client: SocketClient | undefined;
  try {
    client = await connectDaemonOrExit(socketPath);
    const init = await attachSession(client, sessionId);
    // abortMessage is idempotent: a no-op on idle sessions, interrupts
    // in-flight generation (incl. subagents / bash / slash / queued messages)
    // otherwise (spec: 中断幂等，无需先确认是否正在生成).
    await client.request("abortMessage", undefined, init.sessionId);
    console.log(`Aborted session: ${sessionId}`);
  } catch (err) {
    fail(`wave daemon abort failed: ${(err as Error).message}`);
  } finally {
    await client?.dispose();
  }
  process.exit(0);
}

// ── destroy ────────────────────────────────────────────────────

export interface DestroyOptions {
  /** Also remove the session's git worktree before destroying (protocol removeWorktree). */
  removeWorktree?: boolean;
}

/** Run one git command and return trimmed stdout (rejects on git failure). */
function runGit(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

/**
 * Resolve the worktree hosting `workingDirectory` for removal, mirroring the
 * values protocol createWorktree returns: worktree path via
 * `git rev-parse --show-toplevel`, branch via `git branch --show-current`, and
 * repoRoot = the MAIN repo root (first entry of `git worktree list` — where
 * git worktree/branch operations run from). Refuses to remove the main working
 * tree: a plain session is not a worktree, and the protocol's path-containment
 * check would pass trivially while removeWorktree's fs.rmSync fallback could
 * delete the whole repository.
 */
async function resolveWorktreeForRemoval(workingDirectory: string): Promise<{
  path: string;
  branch: string;
  repoRoot: string;
  hookBased: boolean;
}> {
  let worktreePath: string;
  let branch: string;
  try {
    const [toplevel, current] = await Promise.all([
      runGit(workingDirectory, ["rev-parse", "--show-toplevel"]),
      runGit(workingDirectory, ["branch", "--show-current"]),
    ]);
    worktreePath = toplevel;
    branch = current;
  } catch {
    throw new Error(
      `Cannot remove worktree: ${workingDirectory} is not inside a git repository`,
    );
  }
  const repoRoot = getGitMainRepoRoot(workingDirectory);
  if (path.resolve(worktreePath) === path.resolve(repoRoot)) {
    throw new Error(
      `Refusing to remove the main working tree: ${repoRoot} (not a linked worktree)`,
    );
  }
  // Hook-based worktrees (created via a WorktreeCreate hook) are removed by the
  // WorktreeRemove hook — mirror createWorktree's own hookBased decision so
  // removal never runs `git worktree remove` on a hook-managed worktree.
  const config = loadMergedWaveConfig(repoRoot);
  const hookBased = hasWorktreeCreateHook(config?.hooks);
  return { path: worktreePath, branch, repoRoot, hookBased };
}

/**
 * Destroy a hosted session (protocol destroy, idempotent — a session not in
 * the daemon's in-memory registry is a harmless no-op). Unlike status / send /
 * abort there is no attach step: destroy is a pure registry operation keyed by
 * the envelope sessionId, so unknown sessions succeed without touching disk.
 * With --remove-worktree the session's git worktree is resolved from its
 * workingDirectory (getSessionInfo) and removed via protocol removeWorktree
 * first, then the session is destroyed.
 */
export async function daemonDestroyCommand(
  socketPath: string,
  sessionId: string,
  options: DestroyOptions = {},
): Promise<void> {
  let client: SocketClient | undefined;
  try {
    client = await connectDaemonOrExit(socketPath);
    if (options.removeWorktree) {
      const info = (await client.request(
        "getSessionInfo",
        undefined,
        sessionId,
      )) as { workingDirectory: string };
      const wt = await resolveWorktreeForRemoval(info.workingDirectory);
      await client.request("removeWorktree", {
        path: wt.path,
        branch: wt.branch,
        repoRoot: wt.repoRoot,
        hookBased: wt.hookBased,
      });
      console.log(`Removed worktree: ${wt.path} (branch: ${wt.branch})`);
    }
    await client.request("destroy", undefined, sessionId);
    console.log(`Destroyed session: ${sessionId}`);
  } catch (err) {
    fail(`wave daemon destroy failed: ${(err as Error).message}`);
  } finally {
    await client?.dispose();
  }
  process.exit(0);
}

// ── stop / restart ─────────────────────────────────────────────

/** How long stop/restart wait for a running daemon to exit (mutable so tests can shorten it). */
export const daemonStopTimeout = { ms: 10_000 };
const DAEMON_STOP_POLL_INTERVAL_MS = 200;

/** Connect to the daemon socket without starting one; undefined when it is not running. */
async function tryConnectDaemon(
  socketPath: string,
): Promise<SocketClient | undefined> {
  try {
    return await connectDaemon(socketPath);
  } catch {
    return undefined;
  }
}

/** Poll until the daemon socket stops accepting connections (the daemon exited). */
async function waitForDaemonExit(socketPath: string): Promise<void> {
  const deadline = Date.now() + daemonStopTimeout.ms;
  while (Date.now() < deadline) {
    const client = await tryConnectDaemon(socketPath);
    if (!client) return;
    client.dispose();
    await sleep(DAEMON_STOP_POLL_INTERVAL_MS);
  }
  throw new Error(
    `daemon did not exit within ${daemonStopTimeout.ms}ms (socket still accepting connections)`,
  );
}

/**
 * Gracefully stop a running daemon: send the `shutdown` RPC (the daemon
 * destroys every session — each agent saves its transcript — then removes its
 * socket file and exits) and wait for the socket to disappear. Never starts a
 * daemon. Returns whether one was running (false = idempotent no-op).
 * Throws when a running daemon fails to exit in time.
 */
async function stopDaemon(socketPath: string): Promise<boolean> {
  const client = await tryConnectDaemon(socketPath);
  if (!client) return false;
  try {
    // The daemon may drop the socket before responding to the RPC — the wait
    // below is the source of truth, so any request error is fine.
    await client.request("shutdown").catch(() => {});
  } finally {
    client.dispose();
  }
  await waitForDaemonExit(socketPath);
  return true;
}

/**
 * Gracefully stop the daemon (spec: daemon-command.md stop/restart). Sends the
 * `shutdown` RPC so sessions are destroyed and transcripts flushed before the
 * process exits — not a pkill. Idempotent: with no daemon running it prints
 * "Daemon is not running" and exits 0 without starting one.
 */
export async function daemonStopCommand(socketPath: string): Promise<void> {
  let stopped = false;
  try {
    stopped = await stopDaemon(socketPath);
  } catch (err) {
    fail(`wave daemon stop failed: ${(err as Error).message}`);
  }
  console.log(stopped ? "Daemon stopped" : "Daemon is not running");
  process.exit(0);
}

/**
 * Restart the daemon (spec: daemon-command.md stop/restart — the main scenario
 * is restarting after a CLI upgrade so the fresh daemon runs the new code).
 * A running daemon is gracefully stopped first (shutdown RPC + wait), then a
 * fresh daemon is started on demand from the current CLI; when none is
 * running this just starts one. Exits 1 with a clear error if the daemon
 * cannot be stopped or the fresh one does not come up.
 */
export async function daemonRestartCommand(socketPath: string): Promise<void> {
  let wasRunning = false;
  try {
    wasRunning = await stopDaemon(socketPath);
  } catch (err) {
    fail(`wave daemon restart failed: ${(err as Error).message}`);
  }
  // connectDaemonOrExit starts a daemon when the socket is absent and retries
  // until it comes up (exit 1 with the spec'd error on timeout).
  const client = await connectDaemonOrExit(socketPath);
  client.dispose();
  console.log(wasRunning ? "Daemon restarted" : "Daemon started");
  process.exit(0);
}
