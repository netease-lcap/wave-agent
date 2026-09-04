import { test as vitestTest, expect, vi, beforeEach, afterEach } from "vitest";
import { createInterface } from "readline";
import { PassThrough } from "stream";
import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Agent, loadUserConfigEnv } from "wave-agent-sdk";

// Unix-domain sockets are unreliable on Windows: libuv rejects binding a
// non-"\\.\pipe\..." path with EACCES, so every socket-based test fails there.
// The daemon protocol logic is platform-agnostic and already covered by the
// blocking Linux CI; the Windows job only checks platform-specific paths.
const test = process.platform === "win32" ? vitestTest.skip : vitestTest;

// Mock the Agent SDK
vi.mock("wave-agent-sdk");

// Mock process.stderr.write to suppress noise
const stderrWriteSpy = vi
  .spyOn(process.stderr, "write")
  .mockImplementation(() => true);

// Keep the test process alive if a daemon shutdown path ever calls process.exit(0).
const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
  return undefined as never;
});

import { DaemonServer } from "../../src/stdio/daemonServer.js";
import type { Message } from "wave-agent-sdk";

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
  return agent as unknown as Agent;
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

test("initialize request over the socket returns the session response", async () => {
  const client = connectClient(socketPath);
  const msgs = await client.send({
    id: 1,
    method: "initialize",
    params: { workdir: "/test" },
  });

  expect(msgs[0]).toEqual({
    id: 1,
    result: {
      sessionId: "test-session-id",
      workingDirectory: "/test/workdir",
      permissionMode: "default",
      latestTotalTokens: 0,
    },
  });
  client.close();
});

test("multiple connections share the same AgentBridge (in-memory sessions)", async () => {
  const a = connectClient(socketPath);
  const b = connectClient(socketPath);

  const initMsgs = await a.send({ id: 1, method: "initialize", params: {} });
  const initResp = initMsgs[0] as { result: { sessionId: string } };
  const sessionId = initResp.result.sessionId;

  // Second connection reaches the same in-memory bridge: getSessionInfo
  // resolves for a session created on the first connection.
  const msgs = await b.send({
    id: 2,
    method: "getSessionInfo",
    params: {},
    sessionId,
  });
  const result = msgs[0] as { id: number; result: { sessionId: string } };
  expect(result.id).toBe(2);
  expect(result.result.sessionId).toBe(sessionId);

  a.close();
  b.close();
});

test("daemon survives a client disconnect (detach keeps sessions alive)", async () => {
  const a = connectClient(socketPath);
  const initMsgs = await a.send({ id: 1, method: "initialize", params: {} });
  const initResp = initMsgs[0] as { result: { sessionId: string } };
  const sessionId = initResp.result.sessionId;
  a.close();
  // Give the close event a tick to propagate.
  await new Promise((resolve) => setTimeout(resolve, 20));

  const b = connectClient(socketPath);
  const msgs = await b.send({
    id: 2,
    method: "getSessionInfo",
    params: {},
    sessionId,
  });
  const result = msgs[0] as { id: number; result: { sessionId: string } };
  expect(result.result.sessionId).toBe(sessionId);
  b.close();
});

test("pending permission survives disconnect; new connection lists and resolves it", async () => {
  const a = connectClient(socketPath);
  const initMsgs = await a.send({ id: 1, method: "initialize", params: {} });
  const initResp = initMsgs[0] as { result: { sessionId: string } };
  const sessionId = initResp.result.sessionId;

  // Trigger canUseTool (approval stays pending in the daemon process).
  const options = vi.mocked(Agent.create).mock.calls[0][0];
  const permissionPromise = options.canUseTool!({
    toolName: "Bash",
    permissionMode: "default",
    toolInput: { command: "ls" },
  });
  await vi.waitFor(() => {
    const notif = a.lines
      .map((l) => JSON.parse(l))
      .find((m) => m.method === "permissionRequest");
    expect(notif).toBeDefined();
  });

  // Desktop quits; daemon and the pending approval survive.
  a.close();
  await new Promise((resolve) => setTimeout(resolve, 20));

  // Re-attached client pulls the snapshot and answers the approval.
  const b = connectClient(socketPath);
  const listMsgs = await b.send({
    id: 2,
    method: "listPendingPermissions",
    params: {},
  });
  const listResp = listMsgs[0] as {
    result: {
      requests: Array<{
        requestId: string;
        sessionId: string;
        context: { toolName: string };
      }>;
    };
  };
  expect(listResp.result.requests).toHaveLength(1);
  const req = listResp.result.requests[0];
  expect(req.sessionId).toBe(sessionId);
  expect(req.context.toolName).toBe("Bash");

  // Notification (no id) — the daemon sends no response, so write it raw
  // instead of going through send() (whose waitFor would time out).
  b.socket.write(
    JSON.stringify({
      method: "permissionResponse",
      params: { requestId: req.requestId, decision: { behavior: "allow" } },
    }) + "\n",
  );
  await expect(permissionPromise).resolves.toEqual({ behavior: "allow" });
  b.close();
});

test("stop() closes the listener; new connections are refused", async () => {
  const localPath = socketPath + "-local";
  const localServer = new DaemonServer({ socketPath: localPath });
  await localServer.start();
  await localServer.stop();

  const socket = net.connect(localPath);
  await expect(
    new Promise<void>((resolve, reject) => {
      socket.once("connect", resolve);
      socket.once("error", reject);
    }),
  ).rejects.toBeDefined();
  socket.destroy();
});

test("start() unlinks a non-socket stale file at the socket path", async () => {
  const stalePath = socketPath + "-non-socket";
  fs.writeFileSync(stalePath, "not a socket");
  const s = new DaemonServer({ socketPath: stalePath });
  await s.start();
  const client = connectClient(stalePath);
  const msgs = await client.send({ id: 1, method: "initialize", params: {} });
  expect(msgs[0]).toMatchObject({ id: 1 });
  client.close();
  await s.stop();
  try {
    fs.unlinkSync(stalePath);
  } catch {
    // already gone
  }
});

test("start() rejects when a live daemon already holds the socket", async () => {
  const second = new DaemonServer({ socketPath });
  await expect(second.start()).rejects.toThrow(
    `Another wave daemon is already listening on ${socketPath}`,
  );
});

// ── Resident daemon (spec: daemon 常驻，空闲不退出) ─────────────

test("daemon with no sessions and no clients stays alive (no idle auto-exit)", async () => {
  const localPath = socketPath + "-resident-empty";
  const s = new DaemonServer({ socketPath: localPath });
  await s.start();
  // A zero-session daemon used to auto-exit after the 60s grace period; it
  // must now stay up until explicitly stopped or killed.
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(exitSpy).not.toHaveBeenCalled();
  // The socket still accepts clients — the same process keeps serving.
  const client = connectClient(localPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();
  await s.stop();
});

test("daemon stays resident after clients detach and the session settles", async () => {
  const localPath = socketPath + "-resident-idle";
  const s = new DaemonServer({ socketPath: localPath });
  await s.start();
  const a = connectClient(localPath);
  const initMsgs = await a.send({ id: 1, method: "initialize", params: {} });
  const initResp = initMsgs[0] as { result: { sessionId: string } };
  const sessionId = initResp.result.sessionId;
  a.close();
  // Fully idle (session settled) with no clients used to arm the 60s idle
  // exit; the daemon must keep running and keep the session in memory.
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(exitSpy).not.toHaveBeenCalled();
  const b = connectClient(localPath);
  const msgs = await b.send({
    id: 2,
    method: "getSessionInfo",
    params: {},
    sessionId,
  });
  const result = msgs[0] as { id: number; result: { sessionId: string } };
  expect(result.result.sessionId).toBe(sessionId);
  b.close();
  await s.stop();
});

// ── Graceful shutdown RPC (spec: wave daemon stop/restart) ─────

test("shutdown RPC destroys sessions, removes the socket and exits", async () => {
  const localPath = socketPath + "-shutdown";
  const agent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(agent);
  const s = new DaemonServer({ socketPath: localPath });
  await s.start();
  const client = connectClient(localPath);
  await client.send({ id: 1, method: "initialize", params: {} });

  // Ask the daemon to shut down gracefully. It drops the connection without
  // answering (it is exiting), so fire the request raw and wait for the exit.
  client.socket.write(JSON.stringify({ id: 2, method: "shutdown" }) + "\n");
  await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
  // Every hosted session was destroyed first (transcript flush on destroy).
  expect(agent.destroy).toHaveBeenCalled();
  // The listener is closed and the socket file removed — nothing accepts now.
  expect(fs.existsSync(localPath)).toBe(false);
  await expect(
    new Promise<void>((resolve, reject) => {
      const socket = net.connect(localPath);
      socket.once("connect", resolve);
      socket.once("error", reject);
    }),
  ).rejects.toBeDefined();
});
