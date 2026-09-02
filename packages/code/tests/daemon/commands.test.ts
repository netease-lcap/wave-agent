/**
 * `wave daemon` client subcommands (list / status / send / respond / abort) —
 * end-to-end against a real DaemonServer: the commands' SocketClient connects
 * to the unix socket, initialize+restoreSession re-attach to live sessions in
 * the daemon's in-memory registry, respond resolves in-process permission
 * promises and abort forwards to the agent's abortMessage.
 *
 * The SDK is mocked with a factory (NOT auto-mock) so the real
 * getMessageContent / tool-name constants used by commands.ts stay intact while
 * Agent.create + loadUserConfigEnv are stubbed.
 */

import { test as vitestTest, expect, vi, beforeEach, afterEach } from "vitest";
import { createInterface } from "readline";
import { PassThrough } from "stream";
import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  Agent,
  hasWorktreeCreateHook,
  loadUserConfigEnv,
  type AgentCallbacks,
  type Message,
  type PermissionDecision,
} from "wave-agent-sdk";

// Unix-domain sockets are unreliable on Windows (libuv rejects non-"\\.\pipe\"
// paths with EACCES); the daemon protocol logic is covered on Linux CI.
const test = process.platform === "win32" ? vitestTest.skip : vitestTest;

// Factory mock: keep the real SDK utils/constants, stub only the entry points.
vi.mock("wave-agent-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("wave-agent-sdk")>();
  return {
    ...actual,
    Agent: { create: vi.fn() },
    loadUserConfigEnv: vi.fn(() => ({})),
    getGitMainRepoRoot: vi.fn(() => "/repo/main"),
    hasWorktreeCreateHook: vi.fn(() => false),
    loadMergedWaveConfig: vi.fn(() => ({})),
    validateWorktreeRemovalPath: vi.fn(),
  };
});

// Daemon commands auto-start a daemon on connect failure (spec: 按需即用);
// stub spawn so tests never launch a real `wave --daemon` child process.
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(), execFile: vi.fn() };
});

// destroy --remove-worktree runs git lookups through execFile; these
// module-level variables drive the mock per-test (set inside each test).
let gitTopLevel = "";
let gitBranch = "";
let gitLookupError: Error | null = null;
const execFileMock = vi.mocked(execFile) as unknown as ReturnType<typeof vi.fn>;
execFileMock.mockImplementation(
  (
    cmd: string,
    args: readonly string[] | null | undefined,
    _opts: unknown,
    cb: ((err: Error | null, stdout: string) => void) | null | undefined,
  ) => {
    if (!cb) return;
    if (gitLookupError) {
      cb(gitLookupError, "");
      return;
    }
    if (cmd === "git" && args?.[0] === "rev-parse") {
      cb(null, gitTopLevel + "\n");
      return;
    }
    if (cmd === "git" && args?.[0] === "branch") {
      cb(null, gitBranch + "\n");
      return;
    }
    cb(null, "");
  },
);

vi.mock("../../src/utils/worktree.js", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

// vitest.config onConsoleLog throws on any stderr console output — commands use
// console.error for diagnostics, so capture it (and raw writes) here.
const stderrWriteSpy = vi
  .spyOn(process.stderr, "write")
  .mockImplementation(() => true);
const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

/** Every command terminates via process.exit; throwing keeps the flow terminal
 * (a no-op exit would let the command "continue" past the fail and pollute
 * assertions with double execution). */
class ExitSignal extends Error {
  constructor(public readonly code: number) {
    super(`process.exit(${code})`);
    this.name = "ExitSignal";
  }
}
const exitSpy = vi
  .spyOn(process, "exit")
  .mockImplementation((code?: string | number | null) => {
    throw new ExitSignal(Number(code ?? 0));
  });

import { DaemonServer } from "../../src/stdio/daemonServer.js";
import {
  daemonCreateCommand,
  daemonDestroyCommand,
  daemonListCommand,
  daemonStatusCommand,
  daemonSendCommand,
  daemonRespondCommand,
  daemonAbortCommand,
  daemonStartTimeout,
} from "../../src/daemon/commands.js";
import { createWorktree, removeWorktree } from "../../src/utils/worktree.js";

/** When set, the spawn mock starts a real daemon here so the retry succeeds. */
let autoStartSocket: string | undefined;
let autoStartServer: DaemonServer | undefined;
// Simulate the detached `wave --daemon` child the commands spawn: start a real
// DaemonServer at autoStartSocket (success path); without one the daemon never
// comes up (failure path).
vi.mocked(spawn).mockImplementation(() => {
  if (autoStartSocket) {
    const s = new DaemonServer({ socketPath: autoStartSocket });
    void s.start().then(() => {
      autoStartServer = s;
    });
  }
  return { unref: () => {} } as unknown as ChildProcess;
});

function userMsg(id: string, content: string): Message {
  return {
    id,
    role: "user",
    blocks: [{ type: "text", content }],
    timestamp: "t",
  };
}

function assistantMsg(id: string, content: string): Message {
  return {
    id,
    role: "assistant",
    blocks: [{ type: "text", content }],
    timestamp: "t",
  };
}

function createMockAgent(overrides: Record<string, unknown> = {}) {
  const messages: Message[] = [];
  const agent = {
    sessionId: "test-session-id",
    workingDirectory: "/test/workdir",
    latestTotalTokens: 0,
    getMaxInputTokens: vi.fn().mockReturnValue(200000),
    messages,
    displayMessages: messages,
    destroy: vi.fn().mockResolvedValue(undefined),
    restoreSession: vi.fn(),
    sendMessage: vi.fn(),
    bang: vi.fn(),
    abortMessage: vi.fn(),
    clearMessages: vi.fn(),
    truncateHistory: vi.fn(),
    removeQueuedMessage: vi.fn(),
    getFullMessageThread: vi
      .fn()
      .mockResolvedValue({ messages, sessionIds: ["test-session-id"] }),
    getPermissionMode: vi.fn().mockReturnValue("default"),
    setPermissionMode: vi.fn(),
    getMcpServers: vi.fn().mockReturnValue([]),
    connectMcpServer: vi.fn().mockResolvedValue(true),
    disconnectMcpServer: vi.fn().mockResolvedValue(true),
    getSlashCommands: vi.fn().mockReturnValue([]),
    getAvailableToolNames: vi.fn().mockReturnValue(["Bash"]),
    isLoading: false,
    hasPendingMessages: false,
    hasRunningBackgroundWork: false,
    ...overrides,
  };
  // displayMessages (full UI stream) tracks messages unless overridden.
  if (!("displayMessages" in overrides)) {
    agent.displayMessages = agent.messages;
  }
  return agent as unknown as import("wave-agent-sdk").Agent;
}

/** Connect a JSON-RPC client socket to the daemon; resolves once a response arrives. */
function connectClient(socketPath: string) {
  const socket = net.connect(socketPath);
  const input = new PassThrough();
  socket.pipe(input);
  const rl = createInterface({ input });
  const lines: string[] = [];
  rl.on("line", (line: string) => {
    if (line.trim()) lines.push(line);
  });

  const ready = new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });

  return {
    socket,
    lines,
    async send(obj: unknown): Promise<unknown[]> {
      await ready;
      const before = lines.length;
      socket.write(JSON.stringify(obj) + "\n");
      await vi.waitFor(() => {
        expect(lines.length).toBeGreaterThan(before);
      });
      return lines.slice(before).map((l) => JSON.parse(l));
    },
    close(): void {
      socket.destroy();
    },
  };
}

/** Create a session via a raw client and trigger a pending permission request. */
async function createPendingRequest(
  toolName: string,
  toolInput: Record<string, unknown> = {},
): Promise<{ permissionPromise: Promise<PermissionDecision> }> {
  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  const options = vi.mocked(Agent.create).mock.calls[0][0];
  const permissionPromise = options.canUseTool!({
    toolName,
    permissionMode: "default",
    toolInput,
  }) as Promise<PermissionDecision>;
  await vi.waitFor(() => {
    expect(
      client.lines.some((l) => JSON.parse(l).method === "permissionRequest"),
    ).toBe(true);
  });
  client.close();
  return { permissionPromise };
}

const stdoutLines = () => logSpy.mock.calls.map((c) => c.join(" "));
const stderrText = () => errorSpy.mock.calls.map((c) => c.join(" ")).join("");

let server: DaemonServer;
let socketPath: string;

beforeEach(async () => {
  vi.clearAllMocks();
  gitTopLevel = "";
  gitBranch = "";
  gitLookupError = null;
  vi.mocked(loadUserConfigEnv).mockReturnValue({});
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());
  socketPath = path.join(
    os.tmpdir(),
    `wave-daemon-test-${process.pid}-${Date.now()}.sock`,
  );
  server = new DaemonServer({ socketPath });
  await server.start();
});

afterEach(async () => {
  stderrWriteSpy.mockRestore();
  daemonStartTimeout.ms = 10_000;
  await autoStartServer?.stop();
  autoStartServer = undefined;
  autoStartSocket = undefined;
  await server.stop();
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // already gone
  }
});

// ── list ───────────────────────────────────────────────────────

test("list: empty daemon prints No sessions and exits 0 (idle exit is not an error)", async () => {
  await expect(daemonListCommand(socketPath)).rejects.toThrow("exit(0)");
  expect(logSpy).toHaveBeenCalledWith("No sessions");
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("list: prints a padded table of hosted sessions (in-memory registry)", async () => {
  const busy = createMockAgent({
    sessionId: "session-busy",
    workingDirectory: "/repo/a",
    isLoading: true,
  });
  busy.messages.push(userMsg("u1", "你好"));
  const idle = createMockAgent({
    sessionId: "session-idle",
    workingDirectory: "/repo/b",
  });
  idle.messages.push(userMsg("u2", "x"), assistantMsg("a2", "y"));
  const agents = [busy, idle];
  let i = 0;
  vi.mocked(Agent.create).mockImplementation(async () => agents[i++]);

  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  await client.send({ id: 2, method: "initialize", params: {} });
  client.close();

  await expect(daemonListCommand(socketPath)).rejects.toThrow("exit(0)");
  const out = stdoutLines();
  expect(out[0]).toContain("Session");
  expect(out[0]).toContain("Working directory");
  expect(out.join("\n")).toContain("session-busy");
  expect(out.join("\n")).toContain("generating");
  expect(out.join("\n")).toContain("/repo/a");
  expect(out.join("\n")).toContain("session-idle");
  expect(out.join("\n")).toContain("idle");
  expect(out.join("\n")).toContain("/repo/b");
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("list: auto-starts a daemon on demand and retries when the socket is missing", async () => {
  const missing = path.join(
    os.tmpdir(),
    `wave-daemon-autostart-${process.pid}-${Date.now()}.sock`,
  );
  autoStartSocket = missing;
  await expect(daemonListCommand(missing)).rejects.toThrow("exit(0)");
  expect(spawn).toHaveBeenCalledWith(
    process.execPath,
    [process.argv[1], "--daemon", missing],
    expect.objectContaining({ detached: true }),
  );
  // The on-demand daemon is now live — an empty registry is not an error.
  expect(stdoutLines()).toEqual(["No sessions"]);
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("list: daemon that never comes up after auto-start exits 1 with the spec'd hint", async () => {
  const missing = path.join(
    os.tmpdir(),
    `wave-daemon-missing-${process.pid}-${Date.now()}.sock`,
  );
  daemonStartTimeout.ms = 200;
  await expect(daemonListCommand(missing)).rejects.toThrow("exit(1)");
  expect(spawn).toHaveBeenCalledWith(
    process.execPath,
    [process.argv[1], "--daemon", missing],
    expect.objectContaining({ detached: true }),
  );
  expect(stderrText()).toContain(`Cannot connect to daemon socket ${missing}`);
  expect(stderrText()).toContain("started a daemon but it did not come up");
  expect(stderrText()).toContain("(ENOENT)");
  expect(exitSpy).toHaveBeenCalledWith(1);
});

// ── create ─────────────────────────────────────────────────────

test("create: prints the new sessionId, uses defaults, and hosts the session", async () => {
  await expect(daemonCreateCommand(socketPath)).rejects.toThrow("exit(0)");
  expect(stdoutLines()).toEqual(["test-session-id"]);
  const options = vi.mocked(Agent.create).mock.calls[0][0];
  expect(options.workdir).toBe(process.cwd());
  expect(options.permissionMode).toBe("bypassPermissions");
  expect(exitSpy).toHaveBeenCalledWith(0);

  // The new session is hosted in the daemon's registry.
  const client = connectClient(socketPath);
  const msgs = await client.send({
    id: 9,
    method: "listDaemonSessions",
    params: {},
  });
  const result = msgs[0] as { result: { sessions: unknown[] } };
  expect(result.result.sessions).toHaveLength(1);
  client.close();
});

test("create: --workdir / --permission-mode / --model are forwarded", async () => {
  await expect(
    daemonCreateCommand(socketPath, {
      workdir: "/tmp/wave-create-test",
      permissionMode: "acceptEdits",
      model: "gpt-test",
    }),
  ).rejects.toThrow("exit(0)");
  const options = vi.mocked(Agent.create).mock.calls[0][0];
  expect(options.workdir).toBe("/tmp/wave-create-test");
  expect(options.permissionMode).toBe("acceptEdits");
  expect(options.model).toBe("gpt-test");
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("create: invalid --permission-mode fails without connecting or creating", async () => {
  await expect(
    daemonCreateCommand(socketPath, { permissionMode: "bogus" }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(
    "Invalid permission mode: bogus (options: default, bypassPermissions, acceptEdits, plan, dontAsk)",
  );
  expect(vi.mocked(Agent.create)).not.toHaveBeenCalled();
  expect(exitSpy).toHaveBeenCalledWith(1);
});

// ── status ─────────────────────────────────────────────────────

test("status: busy session prints session/workdir/status + recent messages, stays hosted", async () => {
  const agent = createMockAgent({ isLoading: true });
  agent.messages.push(userMsg("u1", "你好"), assistantMsg("a1", "正在处理…"));
  vi.mocked(Agent.create).mockResolvedValue(agent);

  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonStatusCommand(socketPath, "test-session-id"),
  ).rejects.toThrow("exit(0)");
  const out = stdoutLines();
  expect(out).toContain("Session: test-session-id");
  expect(out).toContain("Working directory: /test/workdir");
  expect(out).toContain("Status: generating");
  expect(out).toContain("Recent messages (2):");
  expect(out.join("\n")).toContain("[user] 你好");
  expect(out.join("\n")).toContain("[assistant] 正在处理…");
  expect(exitSpy).toHaveBeenCalledWith(0);

  // Attach is transient — the daemon still hosts the session afterwards.
  const b = connectClient(socketPath);
  const msgs = await b.send({
    id: 9,
    method: "listDaemonSessions",
    params: {},
  });
  const result = msgs[0] as { result: { sessions: unknown[] } };
  expect(result.result.sessions).toHaveLength(1);
  b.close();
});

test("status: idle session shows idle", async () => {
  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonStatusCommand(socketPath, "test-session-id"),
  ).rejects.toThrow("exit(0)");
  expect(stdoutLines()).toContain("Status: idle");
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("status: pending approval shows waiting for approval + the request list", async () => {
  await createPendingRequest("Bash", { command: "ls -la" });

  await expect(
    daemonStatusCommand(socketPath, "test-session-id"),
  ).rejects.toThrow("exit(0)");
  const out = stdoutLines();
  expect(out).toContain("Status: waiting for approval");
  expect(out).toContain("Pending approval requests:");
  expect(
    out.some(
      (l) => l.includes("perm_1") && l.includes("Bash") && l.includes("ls -la"),
    ),
  ).toBe(true);
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("status: AskUserQuestion pending renders every question + numbered option in full, not a truncated JSON summary", async () => {
  await createPendingRequest("AskUserQuestion", {
    questions: [
      {
        question: "删除会话后转录内容如何处理？",
        header: "删除会话",
        options: [
          { label: "保留现状（推荐）", description: "jsonl 与目录共存" },
          { label: "一并清理", description: "删除 jsonl 并清理痕迹" },
        ],
      },
      {
        question: "历史对话弹窗列出哪些会话？",
        header: "恢复范围",
        options: [{ label: "全部项目" }, { label: "仅当前项目" }],
      },
    ],
  });

  await expect(
    daemonStatusCommand(socketPath, "test-session-id"),
  ).rejects.toThrow("exit(0)");
  const block = stdoutLines().join("\n");
  expect(block).toContain("Status: waiting for approval");
  expect(block).toContain("perm_1  AskUserQuestion");
  expect(block).toContain("Q1 [删除会话] 删除会话后转录内容如何处理？");
  expect(block).toContain("0. 保留现状（推荐） — jsonl 与目录共存");
  expect(block).toContain("1. 一并清理 — 删除 jsonl 并清理痕迹");
  expect(block).toContain("Q2 [恢复范围] 历史对话弹窗列出哪些会话？");
  expect(block).toContain("0. 全部项目");
  expect(block).toContain("1. 仅当前项目");
  // Rendered as readable lines, never as the single-line truncated JSON blob.
  expect(block).not.toContain('"questions":');
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("status: malformed AskUserQuestion input falls back to the single-line summary", async () => {
  await createPendingRequest("AskUserQuestion", {
    question: "没有 questions 数组的旧形态",
  });

  await expect(
    daemonStatusCommand(socketPath, "test-session-id"),
  ).rejects.toThrow("exit(0)");
  const out = stdoutLines();
  expect(out).toContain("Status: waiting for approval");
  expect(
    out.some((l) => l.includes("perm_1") && l.includes("AskUserQuestion")),
  ).toBe(true);
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("status: nonexistent session fails, destroys the junk fresh session, registry stays clean", async () => {
  const junk = createMockAgent({
    sessionId: "fresh",
    restoreSession: vi
      .fn()
      .mockRejectedValue(new Error("Session not found: ghost")),
  });
  vi.mocked(Agent.create).mockResolvedValue(junk);

  await expect(daemonStatusCommand(socketPath, "ghost")).rejects.toThrow(
    "exit(1)",
  );
  expect(stderrText()).toContain(
    "Session not found or not hosted by this daemon: ghost",
  );
  expect(exitSpy).toHaveBeenCalledWith(1);
  expect(junk.destroy).toHaveBeenCalled();

  const client = connectClient(socketPath);
  const msgs = await client.send({
    id: 9,
    method: "listDaemonSessions",
    params: {},
  });
  const result = msgs[0] as { result: { sessions: unknown[] } };
  expect(result.result.sessions).toEqual([]);
  client.close();
});

// ── send ───────────────────────────────────────────────────────

test("send: prints the pure final reply text and exits 0 (idle session)", async () => {
  let agent!: ReturnType<typeof createMockAgent>;
  let callbacks!: AgentCallbacks;
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    callbacks = options.callbacks!;
    agent = createMockAgent();
    agent.sendMessage = vi.fn(async () => {
      agent.messages.push(userMsg("u1", "继续"));
      agent.messages.push(assistantMsg("a1", "好的，我继续。"));
      callbacks.onUserMessageAdded?.({ content: "继续" });
      callbacks.onAssistantMessageAdded?.("a1");
      callbacks.onLoadingChange?.(false);
    });
    return agent;
  });

  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonSendCommand(socketPath, "test-session-id", "继续", { timeout: 5 }),
  ).rejects.toThrow("exit(0)");
  expect(stdoutLines()).toEqual(["好的，我继续。"]);
  expect(exitSpy).toHaveBeenCalledWith(0);
  expect(agent.sendMessage).toHaveBeenCalledWith("继续", undefined);

  // send is transient — the session stays hosted.
  const b = connectClient(socketPath);
  const msgs = await b.send({
    id: 9,
    method: "listDaemonSessions",
    params: {},
  });
  const result = msgs[0] as { result: { sessions: unknown[] } };
  expect(result.result.sessions).toHaveLength(1);
  b.close();
});

test("send: a stale loading:false from the previous turn must not end the wait", async () => {
  let agent!: ReturnType<typeof createMockAgent>;
  let callbacks!: AgentCallbacks;
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    callbacks = options.callbacks!;
    agent = createMockAgent({ isLoading: true });
    agent.sendMessage = vi.fn(async () => {
      // The PREVIOUS turn completes right after our message is enqueued — a
      // loading:false arrives before OUR reply exists. The wait must continue.
      callbacks.onLoadingChange?.(false);
      setTimeout(() => {
        agent.messages.push(userMsg("u1", "继续"));
        agent.messages.push(
          assistantMsg("a1", "好，等前一个任务结束我就开始。"),
        );
        callbacks.onUserMessageAdded?.({ content: "继续" });
        callbacks.onAssistantMessageAdded?.("a1");
        callbacks.onLoadingChange?.(false);
      }, 50);
    });
    return agent;
  });

  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonSendCommand(socketPath, "test-session-id", "继续", { timeout: 5 }),
  ).rejects.toThrow("exit(0)");
  expect(stdoutLines()).toEqual(["好，等前一个任务结束我就开始。"]);
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("send: times out and points at respond when a permission approval is pending", async () => {
  await createPendingRequest("Bash", { command: "ls" });

  await expect(
    daemonSendCommand(socketPath, "test-session-id", "继续", { timeout: 0.2 }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(
    "Session is waiting for permission approval; handle it with `wave daemon respond test-session-id perm_1` and retry",
  );
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("send: times out with the generic message when nothing is pending", async () => {
  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonSendCommand(socketPath, "test-session-id", "继续", { timeout: 0.2 }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(
    "Timed out waiting for a reply (0.2s), no assistant reply received",
  );
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("send: an interrupted reply (reasoning only, no text) exits 1 with an interruption hint", async () => {
  let agent!: ReturnType<typeof createMockAgent>;
  let callbacks!: AgentCallbacks;
  vi.mocked(Agent.create).mockImplementation(async (options) => {
    callbacks = options.callbacks!;
    agent = createMockAgent();
    agent.sendMessage = vi.fn(async () => {
      agent.messages.push(userMsg("u1", "继续"));
      // Aborted mid-generation: the final reply carries only reasoning.
      agent.messages.push({
        id: "a1",
        role: "assistant",
        blocks: [{ type: "reasoning", content: "思考了一半…" }],
        timestamp: "t",
      });
      callbacks.onUserMessageAdded?.({ content: "继续" });
      callbacks.onAssistantMessageAdded?.("a1");
      callbacks.onLoadingChange?.(false);
    });
    return agent;
  });

  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonSendCommand(socketPath, "test-session-id", "继续", { timeout: 5 }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain("Message aborted before producing a reply");
  expect(stdoutLines()).toEqual([]);
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("send: nonexistent session fails without injecting a message", async () => {
  const junk = createMockAgent({
    sessionId: "fresh",
    restoreSession: vi
      .fn()
      .mockRejectedValue(new Error("Session not found: ghost")),
  });
  vi.mocked(Agent.create).mockResolvedValue(junk);

  await expect(daemonSendCommand(socketPath, "ghost", "hi")).rejects.toThrow(
    "exit(1)",
  );
  expect(stderrText()).toContain(
    "Session not found or not hosted by this daemon: ghost",
  );
  expect(exitSpy).toHaveBeenCalledWith(1);
  expect(junk.sendMessage).not.toHaveBeenCalled();
});

// ── respond ────────────────────────────────────────────────────

test("respond: --allow resolves a Bash request with behavior allow", async () => {
  const { permissionPromise } = await createPendingRequest("Bash", {
    command: "ls",
  });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
    }),
  ).rejects.toThrow("exit(0)");
  expect(logSpy).toHaveBeenCalledWith("Handled approval request: perm_1");
  await expect(permissionPromise).resolves.toEqual({ behavior: "allow" });
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("respond: --deny with --reason resolves with deny + message", async () => {
  const { permissionPromise } = await createPendingRequest("Bash", {
    command: "rm -rf /",
  });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      deny: true,
      reason: "危险操作",
    }),
  ).rejects.toThrow("exit(0)");
  await expect(permissionPromise).resolves.toEqual({
    behavior: "deny",
    message: "危险操作",
  });
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("respond: --allow on EnterPlanMode auto-completes newPermissionMode plan", async () => {
  const { permissionPromise } = await createPendingRequest("EnterPlanMode");

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
    }),
  ).rejects.toThrow("exit(0)");
  await expect(permissionPromise).resolves.toEqual({
    behavior: "allow",
    newPermissionMode: "plan",
  });
});

test("respond: --allow on ExitPlanMode auto-completes newPermissionMode default", async () => {
  const { permissionPromise } = await createPendingRequest("ExitPlanMode");

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
    }),
  ).rejects.toThrow("exit(0)");
  await expect(permissionPromise).resolves.toEqual({
    behavior: "allow",
    newPermissionMode: "default",
  });
});

test("respond: --answer provides the AskUserQuestion answers as JSON message", async () => {
  const { permissionPromise } = await createPendingRequest("AskUserQuestion", {
    question: "继续吗",
  });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
      answer: '{"继续吗":"继续"}',
    }),
  ).rejects.toThrow("exit(0)");
  await expect(permissionPromise).resolves.toEqual({
    behavior: "allow",
    message: '{"继续吗":"继续"}',
  });
});

test("respond: AskUserQuestion without --answer fails", async () => {
  await createPendingRequest("AskUserQuestion", { question: "继续吗" });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
    }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(
    "AskUserQuestion requests require --answer: a JSON object of {question: answer}, or option numbers per question",
  );
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("respond: AskUserQuestion with an unparseable --answer fails", async () => {
  await createPendingRequest("AskUserQuestion", { question: "继续吗" });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
      answer: "not-json",
    }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(
    'Cannot parse --answer "not-json": not a JSON object of {question: answer} and the pending request has no questions to answer by number',
  );
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("respond: --answer with comma-separated option numbers maps to the question option labels", async () => {
  const { permissionPromise } = await createPendingRequest("AskUserQuestion", {
    questions: [
      {
        question: "Q1 继续处理吗？",
        header: "继续",
        options: [{ label: "保留现状" }, { label: "一并清理" }],
      },
      {
        question: "Q2 范围多大？",
        header: "范围",
        options: [
          { label: "仅当前项目" },
          { label: "全部项目" },
          { label: "其他" },
        ],
      },
    ],
  });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
      answer: "1,0",
    }),
  ).rejects.toThrow("exit(0)");
  // The i-th number answers the i-th question (0-based options, matching the
  // numbering `wave daemon status` renders): 1 -> 一并清理, 0 -> 仅当前项目.
  await expect(permissionPromise).resolves.toEqual({
    behavior: "allow",
    message: JSON.stringify({
      "Q1 继续处理吗？": "一并清理",
      "Q2 范围多大？": "仅当前项目",
    }),
  });
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("respond: --answer by option number on a multiSelect question submits a label array like the dialog", async () => {
  const { permissionPromise } = await createPendingRequest("AskUserQuestion", {
    questions: [
      {
        question: "开启哪些功能？",
        header: "功能",
        multiSelect: true,
        options: [{ label: "钩子" }, { label: "技能" }],
      },
    ],
  });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
      answer: "1",
    }),
  ).rejects.toThrow("exit(0)");
  await expect(permissionPromise).resolves.toEqual({
    behavior: "allow",
    message: JSON.stringify({ "开启哪些功能？": ["技能"] }),
  });
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("respond: --answer option numbers must match the question count", async () => {
  await createPendingRequest("AskUserQuestion", {
    questions: [
      {
        question: "Q1 继续吗？",
        header: "继续",
        options: [{ label: "是" }, { label: "否" }],
      },
    ],
  });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
      answer: "0,1",
    }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(
    "--answer must give one option number per question (1 question",
  );
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("respond: --answer option number out of range fails with the valid range", async () => {
  await createPendingRequest("AskUserQuestion", {
    questions: [
      {
        question: "Q1 继续吗？",
        header: "继续",
        options: [{ label: "是" }, { label: "否" }],
      },
    ],
  });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
      answer: "5",
    }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(
    "Option number 5 is out of range for question 1 (Q1 继续吗？): options are numbered 0..1",
  );
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("respond: --answer with a non-numeric option number fails", async () => {
  await createPendingRequest("AskUserQuestion", {
    questions: [
      {
        question: "Q1 继续吗？",
        header: "继续",
        options: [{ label: "是" }, { label: "否" }],
      },
    ],
  });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
      answer: "yes",
    }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(
    '--answer contains a non-numeric option number "yes" for question 1 (Q1 继续吗？)',
  );
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("respond: --rule persists an allowed rule on the decision", async () => {
  const { permissionPromise } = await createPendingRequest("Bash", {
    command: "ls",
  });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
      rule: "Bash(ls)",
    }),
  ).rejects.toThrow("exit(0)");
  await expect(permissionPromise).resolves.toEqual({
    behavior: "allow",
    newPermissionRule: "Bash(ls)",
  });
});

test("respond: --mode switches the session's permission mode", async () => {
  const { permissionPromise } = await createPendingRequest("Bash", {
    command: "ls",
  });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
      mode: "acceptEdits",
    }),
  ).rejects.toThrow("exit(0)");
  await expect(permissionPromise).resolves.toEqual({
    behavior: "allow",
    newPermissionMode: "acceptEdits",
  });
});

test("respond: invalid --mode fails with the accepted modes listed", async () => {
  await createPendingRequest("Bash", { command: "ls" });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
      mode: "bogus",
    }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(
    "Invalid permission mode: bogus (options: default, bypassPermissions, acceptEdits, plan, dontAsk)",
  );
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("respond: unknown requestId fails — the server would silently ignore it", async () => {
  await createPendingRequest("Bash", { command: "ls" });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_999", {
      allow: true,
    }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain("Request not found or already handled");
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("respond: another session's request is refused and left untouched", async () => {
  const agents = [
    createMockAgent({ sessionId: "s1" }),
    createMockAgent({ sessionId: "s2" }),
  ];
  let i = 0;
  vi.mocked(Agent.create).mockImplementation(async () => agents[i++]);

  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  await client.send({ id: 2, method: "initialize", params: {} });
  const options = vi.mocked(Agent.create).mock.calls[0][0]!;
  const permissionPromise = options.canUseTool!({
    toolName: "Bash",
    permissionMode: "default",
    toolInput: { command: "ls" },
  }) as Promise<PermissionDecision>;
  await vi.waitFor(() => {
    expect(
      client.lines.some((l) => JSON.parse(l).method === "permissionRequest"),
    ).toBe(true);
  });
  client.close();

  await expect(
    daemonRespondCommand(socketPath, "s2", "perm_1", { allow: true }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(
    "Session not found or not hosted by this daemon",
  );
  expect(exitSpy).toHaveBeenCalledWith(1);

  // The s1 request was never answered.
  let resolved = false;
  permissionPromise.then(() => {
    resolved = true;
  });
  await new Promise((r) => setTimeout(r, 50));
  expect(resolved).toBe(false);
});

test("respond: requires exactly one of --allow / --deny", async () => {
  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {}),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain("Specify either --allow or --deny");
  expect(exitSpy).toHaveBeenCalledWith(1);
});

// ── abort ─────────────────────────────────────────────────────

test("abort: forwards abortMessage on a generating session, prints confirmation and exits 0", async () => {
  const agent = createMockAgent({ isLoading: true });
  vi.mocked(Agent.create).mockResolvedValue(agent);

  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonAbortCommand(socketPath, "test-session-id"),
  ).rejects.toThrow("exit(0)");
  expect(agent.abortMessage).toHaveBeenCalled();
  expect(logSpy).toHaveBeenCalledWith("Aborted session: test-session-id");
  expect(exitSpy).toHaveBeenCalledWith(0);

  // Abort is a transient attach — the session stays hosted.
  const b = connectClient(socketPath);
  const msgs = await b.send({
    id: 9,
    method: "listDaemonSessions",
    params: {},
  });
  const result = msgs[0] as { result: { sessions: unknown[] } };
  expect(result.result.sessions).toHaveLength(1);
  b.close();
});

test("abort: idle session is an idempotent no-op that still exits 0", async () => {
  const agent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(agent);

  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonAbortCommand(socketPath, "test-session-id"),
  ).rejects.toThrow("exit(0)");
  expect(agent.abortMessage).toHaveBeenCalled();
  expect(logSpy).toHaveBeenCalledWith("Aborted session: test-session-id");
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("abort: nonexistent session fails, destroys the junk fresh session, no abort sent", async () => {
  const junk = createMockAgent({
    sessionId: "fresh",
    restoreSession: vi
      .fn()
      .mockRejectedValue(new Error("Session not found: ghost")),
  });
  vi.mocked(Agent.create).mockResolvedValue(junk);

  await expect(daemonAbortCommand(socketPath, "ghost")).rejects.toThrow(
    "exit(1)",
  );
  expect(stderrText()).toContain(
    "Session not found or not hosted by this daemon: ghost",
  );
  expect(exitSpy).toHaveBeenCalledWith(1);
  expect(junk.destroy).toHaveBeenCalled();
  expect(junk.abortMessage).not.toHaveBeenCalled();
});

// ── destroy ────────────────────────────────────────────────────

test("destroy: removes a hosted session from the registry", async () => {
  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonDestroyCommand(socketPath, "test-session-id"),
  ).rejects.toThrow("exit(0)");
  expect(logSpy).toHaveBeenCalledWith("Destroyed session: test-session-id");
  expect(exitSpy).toHaveBeenCalledWith(0);

  // The registry is now empty — the session is gone.
  const b = connectClient(socketPath);
  const msgs = await b.send({
    id: 9,
    method: "listDaemonSessions",
    params: {},
  });
  const result = msgs[0] as { result: { sessions: unknown[] } };
  expect(result.result.sessions).toEqual([]);
  b.close();
});

test("destroy: unknown session is an idempotent no-op that still exits 0", async () => {
  await expect(daemonDestroyCommand(socketPath, "ghost")).rejects.toThrow(
    "exit(0)",
  );
  expect(logSpy).toHaveBeenCalledWith("Destroyed session: ghost");
  expect(exitSpy).toHaveBeenCalledWith(0);
  expect(vi.mocked(Agent.create)).not.toHaveBeenCalled();
});

// ── create --worktree ──────────────────────────────────────────

test("create: --worktree creates a worktree first, then the session inside it", async () => {
  vi.mocked(createWorktree).mockResolvedValue({
    name: "feature-x",
    path: "/repo/main/.wave/worktrees/feature-x",
    branch: "feature-x",
    repoRoot: "/repo/main",
    hasUncommittedChanges: false,
    hasNewCommits: false,
    isNew: true,
    hookBased: false,
  });
  await expect(
    daemonCreateCommand(socketPath, { worktree: "feature-x" }),
  ).rejects.toThrow("exit(0)");
  // sessionId first (script-compatible), worktree info second.
  expect(stdoutLines()).toEqual([
    "test-session-id",
    "Worktree: /repo/main/.wave/worktrees/feature-x (branch: feature-x)",
  ]);
  expect(vi.mocked(createWorktree)).toHaveBeenCalledWith(
    "feature-x",
    process.cwd(),
    { baseBranch: undefined },
  );
  const options = vi.mocked(Agent.create).mock.calls[0][0];
  expect(options.workdir).toBe("/repo/main/.wave/worktrees/feature-x");
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("create: bare --worktree auto-generates the worktree name", async () => {
  vi.mocked(createWorktree).mockResolvedValue({
    name: "generated-name",
    path: "/repo/main/.wave/worktrees/generated-name",
    branch: "generated-name",
    repoRoot: "/repo/main",
    hasUncommittedChanges: false,
    hasNewCommits: false,
    isNew: true,
    hookBased: false,
  });
  await expect(
    daemonCreateCommand(socketPath, { worktree: "" }),
  ).rejects.toThrow("exit(0)");
  // The daemon normalizes the empty name to a generated one.
  expect(vi.mocked(createWorktree)).toHaveBeenCalledWith(
    expect.any(String),
    process.cwd(),
    { baseBranch: undefined },
  );
  expect(vi.mocked(createWorktree).mock.calls[0][0]).not.toBe("");
  expect(stdoutLines()[0]).toBe("test-session-id");
  expect(exitSpy).toHaveBeenCalledWith(0);
});

// ── destroy --remove-worktree ──────────────────────────────────

test("destroy: --remove-worktree resolves the worktree via git and removes it before destroying", async () => {
  gitTopLevel = "/repo/main/.wave/worktrees/feature-x";
  gitBranch = "feature-x";
  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonDestroyCommand(socketPath, "test-session-id", {
      removeWorktree: true,
    }),
  ).rejects.toThrow("exit(0)");
  // git lookups ran against the session's workingDirectory.
  expect(execFile).toHaveBeenCalledWith(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd: "/test/workdir" },
    expect.any(Function),
  );
  expect(execFile).toHaveBeenCalledWith(
    "git",
    ["branch", "--show-current"],
    { cwd: "/test/workdir" },
    expect.any(Function),
  );
  // The daemon's removeWorktree ran with the resolved values (bridge fills the
  // remaining WorktreeSession fields).
  expect(vi.mocked(removeWorktree)).toHaveBeenCalledWith({
    name: "",
    path: "/repo/main/.wave/worktrees/feature-x",
    branch: "feature-x",
    repoRoot: "/repo/main",
    hasUncommittedChanges: false,
    hasNewCommits: false,
    isNew: false,
    hookBased: false,
  });
  expect(stdoutLines()).toEqual([
    "Removed worktree: /repo/main/.wave/worktrees/feature-x (branch: feature-x)",
    "Destroyed session: test-session-id",
  ]);
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("destroy: --remove-worktree refuses to remove the main working tree", async () => {
  // rev-parse resolves to the main repo root itself (a plain session).
  gitTopLevel = "/repo/main";
  gitBranch = "main";
  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonDestroyCommand(socketPath, "test-session-id", {
      removeWorktree: true,
    }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(
    "wave daemon destroy failed: Refusing to remove the main working tree: /repo/main (not a linked worktree)",
  );
  expect(vi.mocked(removeWorktree)).not.toHaveBeenCalled();
  expect(exitSpy).toHaveBeenCalledWith(1);

  // The session is still hosted — nothing was removed or destroyed.
  const b = connectClient(socketPath);
  const msgs = await b.send({
    id: 9,
    method: "listDaemonSessions",
    params: {},
  });
  const result = msgs[0] as { result: { sessions: unknown[] } };
  expect(result.result.sessions).toHaveLength(1);
  b.close();
});

test("destroy: --remove-worktree forwards hookBased when the repo uses a WorktreeCreate hook", async () => {
  gitTopLevel = "/repo/main/.wave/worktrees/feature-x";
  gitBranch = "feature-x";
  vi.mocked(hasWorktreeCreateHook).mockReturnValue(true);
  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonDestroyCommand(socketPath, "test-session-id", {
      removeWorktree: true,
    }),
  ).rejects.toThrow("exit(0)");
  expect(vi.mocked(removeWorktree)).toHaveBeenCalledWith(
    expect.objectContaining({ hookBased: true }),
  );
  expect(stdoutLines()).toContain(
    "Removed worktree: /repo/main/.wave/worktrees/feature-x (branch: feature-x)",
  );
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("destroy: --remove-worktree on a non-git working directory fails with a clear message", async () => {
  gitLookupError = new Error(
    "fatal: not a git repository (or any of the parent directories): .git",
  );
  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonDestroyCommand(socketPath, "test-session-id", {
      removeWorktree: true,
    }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(
    "wave daemon destroy failed: Cannot remove worktree: /test/workdir is not inside a git repository",
  );
  expect(vi.mocked(removeWorktree)).not.toHaveBeenCalled();
  expect(exitSpy).toHaveBeenCalledWith(1);
});
