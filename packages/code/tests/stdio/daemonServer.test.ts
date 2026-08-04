import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { createInterface } from "readline";
import { PassThrough } from "stream";
import * as net from "net";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Agent } from "wave-agent-sdk";

// Mock the Agent SDK
vi.mock("wave-agent-sdk");

// Mock process.stderr.write to suppress noise
const stderrWriteSpy = vi
  .spyOn(process.stderr, "write")
  .mockImplementation(() => true);

// Idle auto-exit calls process.exit(0); keep the test process alive.
const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
  return undefined as never;
});

import { DaemonServer } from "../../src/stdio/daemonServer.js";
import type { Message } from "wave-agent-sdk";

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
  } as unknown as Agent;
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

  b.send({
    method: "permissionResponse",
    params: { requestId: req.requestId, decision: { behavior: "allow" } },
  });
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
    `另一个 wave daemon 已在 ${socketPath} 监听`,
  );
});

// ── Idle auto-exit (spec: 远程 daemon 空闲自动退出) ─────────────────

test("daemon with no sessions and no clients auto-exits after the grace period", async () => {
  const localPath = socketPath + "-idle";
  const s = new DaemonServer({ socketPath: localPath, graceMs: 50 });
  await s.start();
  await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
  await s.stop();
});

test("daemon stays alive while a client is connected, even when idle", async () => {
  const localPath = socketPath + "-connected";
  const s = new DaemonServer({ socketPath: localPath, graceMs: 50 });
  await s.start();
  const client = connectClient(localPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(exitSpy).not.toHaveBeenCalled();
  client.close();
  await s.stop();
});

test("daemon does not exit while a session is busy with no clients connected", async () => {
  const localPath = socketPath + "-busy";
  const agent = createMockAgent({ isLoading: true });
  vi.mocked(Agent.create).mockResolvedValue(agent);
  const s = new DaemonServer({ socketPath: localPath, graceMs: 50 });
  await s.start();
  const client = connectClient(localPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(exitSpy).not.toHaveBeenCalled();
  await s.stop();
});

test("daemon exits once a busy session settles; shutdown destroys agents", async () => {
  const localPath = socketPath + "-settle";
  const agent = createMockAgent({ isLoading: true });
  vi.mocked(Agent.create).mockResolvedValue(agent);
  const s = new DaemonServer({ socketPath: localPath, graceMs: 50 });
  await s.start();
  const client = connectClient(localPath);
  await client.send({ id: 1, method: "initialize", params: {} });
  client.close();
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(exitSpy).not.toHaveBeenCalled();

  // Session settles: the SDK flips its loading state, then fires the
  // notification that the bridge forwards (re-evaluating the idle check).
  (agent as unknown as { isLoading: boolean }).isLoading = false;
  const options = vi.mocked(Agent.create).mock.calls[0][0];
  options.callbacks!.onLoadingChange!(false);

  await vi.waitFor(() => expect(exitSpy).toHaveBeenCalledWith(0));
  expect(agent.destroy).toHaveBeenCalled();
  await s.stop();
});

test("reconnecting within the grace period cancels the idle exit", async () => {
  const localPath = socketPath + "-reconnect";
  const s = new DaemonServer({ socketPath: localPath, graceMs: 100 });
  await s.start();
  const a = connectClient(localPath);
  const msgs = await a.send({ id: 1, method: "initialize", params: {} });
  const initResp = msgs[0] as { result: { sessionId: string } };
  const sessionId = initResp.result.sessionId;
  a.close();
  // The daemon is now idle with no clients — but re-attach before the grace
  // window elapses cancels the countdown.
  await new Promise((resolve) => setTimeout(resolve, 30));
  const b = connectClient(localPath);
  await b.send({ id: 2, method: "getSessionInfo", params: {}, sessionId });
  await new Promise((resolve) => setTimeout(resolve, 150));
  expect(exitSpy).not.toHaveBeenCalled();
  b.close();
  await s.stop();
});
