/**
 * `wave daemon` client subcommands — talk to the wave daemon's unix socket
 * (JSON-RPC over newline-delimited JSON) to list hosted sessions, inspect
 * progress, inject messages and respond to pending permission requests.
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

import net from "node:net";
import os from "node:os";
import path from "node:path";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  ENTER_PLAN_MODE_TOOL_NAME,
  EXIT_PLAN_MODE_TOOL_NAME,
  getMessageContent,
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

/** Connect or fail fast with the spec'd error; daemon idle-exits after 60s. */
async function connectDaemonOrExit(socketPath: string): Promise<SocketClient> {
  try {
    return await connectDaemon(socketPath);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    console.error(
      `Cannot connect to daemon socket ${socketPath}: is the daemon running? (it auto-exits after 60s idle)` +
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
      if (content) console.log(content);
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
