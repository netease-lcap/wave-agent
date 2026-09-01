/**
 * `wave daemon` client subcommands — talk to the wave daemon's unix socket
 * (JSON-RPC over newline-delimited JSON) to create/destroy sessions, list
 * hosted sessions, inspect progress, inject messages, respond to pending
 * permission requests and abort in-flight message generation. When the daemon
 * is not running, any subcommand starts one on demand (detached --daemon
 * spawn, the local equivalent of the remote nohup launcher) and retries the
 * connection — the daemon needs no permanent host, it is used on demand.
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
 * Attach to a session; returns the initialized sessionId + working directory.
 * Exits (nonzero) with the spec'd error when the session exists neither in the
 * daemon registry nor on disk, destroying the fresh session that `initialize`
 * silently created.
 */
async function attachSession(
  client: SocketClient,
  sessionId: string,
): Promise<{ sessionId: string; workingDirectory: string }> {
  const init = (await client.request("initialize", {
    workdir: process.cwd(),
    restoreSessionId: sessionId,
  })) as { sessionId: string; workingDirectory: string };
  const initId = init.sessionId;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

export async function daemonStatusCommand(
  socketPath: string,
  sessionId: string,
  lines = 20,
): Promise<void> {
  let client: SocketClient | undefined;
  try {
    client = await connectDaemonOrExit(socketPath);

    // Subscribe BEFORE initialize/restoreSession so the replayed loadingChange
    // snapshot is captured (spec: 依据重放的 loadingChange 快照显示状态).
    let loading = false;
    client.onNotification("loadingChange", (params) => {
      loading = (params as { loading: boolean }).loading;
    });

    const init = await attachSession(client, sessionId);
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
    console.log(`Session: ${initId}`);
    console.log(`Working directory: ${init.workingDirectory}`);
    console.log(`Status: ${status}`);

    if (pending.length > 0) {
      console.log("");
      console.log("Pending approval requests:");
      for (const r of pending) {
        const params = summarizeToolInput(r.context);
        console.log(
          `  ${r.requestId}  ${r.context.toolName}${params ? `  ${params}` : ""}`,
        );
      }
    }

    const recent = messages.messages.slice(-lines);
    if (recent.length > 0) {
      console.log("");
      console.log(`Recent messages (${recent.length}):`);
      for (const m of recent) {
        const text = getMessageContent(m).replace(/\s+/g, " ").trim();
        if (!text) continue; // tool-only messages carry no readable text
        console.log(`  [${m.role}] ${text}`);
      }
    }
  } catch (err) {
    fail(`wave daemon status failed: ${(err as Error).message}`);
  } finally {
    await client?.dispose();
  }
  process.exit(0);
}

// ── send ───────────────────────────────────────────────────────

export interface SendOptions {
  timeout: number; // seconds; 0 = no limit (default 600)
}

/**
 * Send a message and wait for the reply that corresponds to it.
 *
 * Completion detection: `sendMessage` on an idle session resolves only after
 * the whole turn finishes (InteractionService awaits sendAIMessage), while on a
 * busy session it enqueues and returns immediately — so stopping on a bare
 * `loadingChange:false` would exit early on the PREVIOUS turn's completion when
 * queued behind a busy session. Instead, track the message IDs: `ourUserMessage`
 * is the user message added when OUR turn starts (userMessageAdded), and the
 * reply is the last assistantMessageAdded observed after it. A stale
 * loading:false can then never satisfy the wait condition early (the reply has
 * not been added yet).
 */
export async function daemonSendCommand(
  socketPath: string,
  sessionId: string,
  message: string,
  options: SendOptions = { timeout: 600 },
): Promise<void> {
  // connectDaemonOrExit exits on failure — no client to dispose in that case.
  const client = await connectDaemonOrExit(socketPath);

  let loading = false;
  let sent = false;
  let ourUserMessageId: string | undefined;
  let replyMessageId: string | undefined;
  client.onNotification("userMessageAdded", (params) => {
    if (!sent) return; // ignore messages added during attach
    ourUserMessageId = (params as { message: Message }).message.id;
  });
  client.onNotification("assistantMessageAdded", (params) => {
    if (!sent || ourUserMessageId === undefined) return; // not our turn yet
    replyMessageId = (params as { message: Message }).message.id;
  });
  client.onNotification("loadingChange", (params) => {
    loading = (params as { loading: boolean }).loading;
  });

  let initId: string;
  try {
    initId = (await attachSession(client, sessionId)).sessionId;
    sent = true;
    await client.request("sendMessage", { text: message }, initId);
  } catch (err) {
    client.dispose();
    fail(`wave daemon send failed: ${(err as Error).message}`);
  }

  // Wait for the reply that corresponds to our message.
  const started = Date.now();
  const timeoutMs = options.timeout === 0 ? Infinity : options.timeout * 1000;
  while (!(loading === false && replyMessageId !== undefined)) {
    if (Date.now() - started > timeoutMs) {
      // Timeout backstop: the most likely cause is a session waiting on a
      // permission approval — point the user at respond (spec: 不无限期挂起).
      const pending = (await listPendingPermissions(client)).filter(
        (r) => r.sessionId === sessionId || r.sessionId === initId,
      );
      client.dispose();
      if (pending.length > 0) {
        fail(
          `Session is waiting for permission approval; handle it with \`wave daemon respond ${sessionId} ${pending[0].requestId}\` and retry`,
        );
      }
      fail(
        options.timeout === 0
          ? "Timed out waiting for a reply"
          : `Timed out waiting for a reply (${options.timeout}s), no assistant reply received`,
      );
    }
    await sleep(200);
  }

  try {
    const result = (await client.request("getMessages", undefined, initId)) as {
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
            "AskUserQuestion requests require --answer with the answer JSON",
          );
        }
        let answers: unknown;
        try {
          answers = JSON.parse(options.answer);
        } catch {
          fail("--answer is not valid JSON");
        }
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
