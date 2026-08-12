/**
 * `wave daemon` client subcommands (list / status / send / respond) — end-to-end
 * against a real DaemonServer: the commands' SocketClient connects to the unix
 * socket, initialize+restoreSession re-attach to live sessions in the daemon's
 * in-memory registry, and respond resolves in-process permission promises.
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
import {
  Agent,
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
  };
});

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
  daemonListCommand,
  daemonStatusCommand,
  daemonSendCommand,
  daemonRespondCommand,
} from "../../src/daemon/commands.js";

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
  return {
    sessionId: "test-session-id",
    workingDirectory: "/test/workdir",
    latestTotalTokens: 0,
    messages,
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
  } as unknown as import("wave-agent-sdk").Agent;
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
  await server.stop();
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // already gone
  }
});

// ── list ───────────────────────────────────────────────────────

test("list: empty daemon prints 无会话 and exits 0 (idle exit is not an error)", async () => {
  await expect(daemonListCommand(socketPath)).rejects.toThrow("exit(0)");
  expect(logSpy).toHaveBeenCalledWith("无会话");
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
  expect(out[0]).toContain("会话");
  expect(out[0]).toContain("工作目录");
  expect(out.join("\n")).toContain("session-busy");
  expect(out.join("\n")).toContain("生成中");
  expect(out.join("\n")).toContain("/repo/a");
  expect(out.join("\n")).toContain("session-idle");
  expect(out.join("\n")).toContain("空闲");
  expect(out.join("\n")).toContain("/repo/b");
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("list: daemon not running exits 1 with the spec'd hint", async () => {
  const missing = path.join(
    os.tmpdir(),
    `wave-daemon-missing-${process.pid}-${Date.now()}.sock`,
  );
  await expect(daemonListCommand(missing)).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain(`无法连接 daemon socket ${missing}`);
  expect(stderrText()).toContain(
    "daemon 未运行？（daemon 空闲 60 秒自动退出）",
  );
  expect(stderrText()).toContain("(ENOENT)");
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
  expect(out).toContain("会话: test-session-id");
  expect(out).toContain("工作目录: /test/workdir");
  expect(out).toContain("状态: 生成中");
  expect(out).toContain("最近消息 (2):");
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

test("status: idle session shows 空闲", async () => {
  const client = connectClient(socketPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();

  await expect(
    daemonStatusCommand(socketPath, "test-session-id"),
  ).rejects.toThrow("exit(0)");
  expect(stdoutLines()).toContain("状态: 空闲");
  expect(exitSpy).toHaveBeenCalledWith(0);
});

test("status: pending approval shows 等待审批 + the request list", async () => {
  await createPendingRequest("Bash", { command: "ls -la" });

  await expect(
    daemonStatusCommand(socketPath, "test-session-id"),
  ).rejects.toThrow("exit(0)");
  const out = stdoutLines();
  expect(out).toContain("状态: 等待审批");
  expect(out).toContain("待审批请求:");
  expect(
    out.some(
      (l) => l.includes("perm_1") && l.includes("Bash") && l.includes("ls -la"),
    ),
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
  expect(stderrText()).toContain("会话不存在或未被该 daemon 托管：ghost");
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
    "会话等待权限审批，请通过 `wave daemon respond test-session-id perm_1` 处理后重试",
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
  expect(stderrText()).toContain("等待回复超时（0.2 秒），未收到助手回复");
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
  expect(stderrText()).toContain("会话不存在或未被该 daemon 托管：ghost");
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
  expect(logSpy).toHaveBeenCalledWith("已处理审批请求：perm_1");
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
    "AskUserQuestion 请求需要 --answer 提供答案 JSON",
  );
  expect(exitSpy).toHaveBeenCalledWith(1);
});

test("respond: AskUserQuestion with invalid JSON --answer fails", async () => {
  await createPendingRequest("AskUserQuestion", { question: "继续吗" });

  await expect(
    daemonRespondCommand(socketPath, "test-session-id", "perm_1", {
      allow: true,
      answer: "not-json",
    }),
  ).rejects.toThrow("exit(1)");
  expect(stderrText()).toContain("--answer 不是合法的 JSON");
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
    "无效的权限模式：bogus（可选：default、bypassPermissions、acceptEdits、plan、dontAsk）",
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
  expect(stderrText()).toContain("该请求不存在或已处理");
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
  expect(stderrText()).toContain("会话不存在或未被该 daemon 托管");
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
  expect(stderrText()).toContain("请指定 --allow 或 --deny（二选一）");
  expect(exitSpy).toHaveBeenCalledWith(1);
});
