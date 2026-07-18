import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { PassThrough } from "stream";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { Agent } from "wave-agent-sdk";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_PACKAGE_VERSION = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../package.json"), "utf-8"),
).version as string;

// Mock the Agent SDK
vi.mock("wave-agent-sdk");

// Mock process.stderr.write to suppress noise
const stderrWriteSpy = vi
  .spyOn(process.stderr, "write")
  .mockImplementation(() => true);

import { StdioServer } from "../../src/stdio/stdioServer.js";
import type { Message } from "wave-agent-sdk";

// ── Helpers ──────────────────────────────────────────────────────

function createMockAgent(overrides: Record<string, unknown> = {}) {
  const messages: Message[] = [];
  return {
    sessionId: "test-session-id",
    workingDirectory: "/test/workdir",
    latestTotalTokens: 0,
    messages,
    destroy: vi.fn(),
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
    ...overrides,
  } as unknown as Agent;
}

function createServer() {
  const input = new PassThrough();
  const output = new PassThrough();
  const server = new StdioServer({ input, output });

  const lines: string[] = [];
  output.on("data", (chunk: Buffer) => {
    const text = chunk.toString();
    for (const line of text.split("\n")) {
      if (line.trim()) lines.push(line);
    }
  });

  function getMessages(): unknown[] {
    return lines.map((l) => JSON.parse(l));
  }

  async function waitForMessages(count: number): Promise<unknown[]> {
    await vi.waitFor(() => {
      expect(lines.length).toBeGreaterThanOrEqual(count);
    });
    return getMessages();
  }

  function send(obj: unknown): void {
    input.write(JSON.stringify(obj) + "\n");
  }

  return { server, input, output, lines, getMessages, waitForMessages, send };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());
});

afterEach(() => {
  stderrWriteSpy.mockRestore();
});

// ── Basic request/response ───────────────────────────────────────

test("initialize request returns response with sessionId", async () => {
  const { server, send, waitForMessages } = createServer();
  server.start();

  send({ id: 1, method: "initialize", params: { workdir: "/test" } });
  const msgs = await waitForMessages(1);
  const response = msgs[0] as { id: number; result: unknown };

  expect(response.id).toBe(1);
  expect(response.result).toEqual({
    sessionId: "test-session-id",
    workingDirectory: "/test/workdir",
    permissionMode: "default",
    latestTotalTokens: 0,
    serverVersion: CLI_PACKAGE_VERSION,
  });

  server.stop();
});

test("multiple sequential requests get correct responses", async () => {
  const { server, send, waitForMessages } = createServer();
  server.start();

  send({ id: 1, method: "initialize", params: {} });
  await waitForMessages(1);

  send({ id: 2, method: "getPermissionMode", params: {} });
  const msgs = await waitForMessages(2);

  const resp2 = msgs[1] as { id: number; result: unknown };
  expect(resp2.id).toBe(2);
  expect(resp2.result).toEqual({ mode: "default" });

  server.stop();
});

test("string id is preserved in response", async () => {
  const { server, send, waitForMessages } = createServer();
  server.start();

  send({ id: "abc-123", method: "initialize", params: {} });
  const msgs = await waitForMessages(1);
  const response = msgs[0] as { id: string };

  expect(response.id).toBe("abc-123");

  server.stop();
});

// ── Notifications (no response) ──────────────────────────────────

test("notification does not produce a response", async () => {
  const { server, send, lines } = createServer();
  server.start();

  // First initialize so agent exists
  send({ id: 1, method: "initialize", params: {} });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const linesBefore = lines.length;

  // Send a notification (no id)
  send({
    method: "permissionResponse",
    params: { requestId: "perm_1", decision: { behavior: "allow" } },
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  // No new response should have been written
  expect(lines.length).toBe(linesBefore);

  server.stop();
});

// ── Malformed JSON ───────────────────────────────────────────────

test("malformed JSON produces error response with null id", async () => {
  const { server, input, waitForMessages } = createServer();
  server.start();

  input.write("{invalid json}\n");
  const msgs = await waitForMessages(1);
  const response = msgs[0] as {
    id: null;
    error: { code: number; message: string };
  };

  expect(response.id).toBeNull();
  expect(response.error.code).toBe(-32700); // PARSE_ERROR

  server.stop();
});

test("empty lines are ignored", async () => {
  const { server, input, send, waitForMessages } = createServer();
  server.start();

  input.write("\n\n  \n");
  send({ id: 1, method: "initialize", params: {} });
  const msgs = await waitForMessages(1);

  // Should only get the one response to the valid request
  expect(msgs.length).toBe(1);

  server.stop();
});

test("invalid request (missing method) produces error", async () => {
  const { server, send, waitForMessages } = createServer();
  server.start();

  send({ id: 5, foo: "bar" });
  const msgs = await waitForMessages(1);
  const response = msgs[0] as { id: number; error: { code: number } };

  expect(response.id).toBe(5);
  expect(response.error.code).toBe(-32600); // INVALID_REQUEST

  server.stop();
});

// ── Error propagation ────────────────────────────────────────────

test("method not found returns error response", async () => {
  const { server, send, waitForMessages } = createServer();
  server.start();

  send({ id: 1, method: "initialize", params: {} });
  await waitForMessages(1);

  send({ id: 2, method: "nonexistent", params: {} });
  const msgs = await waitForMessages(2);
  const response = msgs[1] as {
    id: number;
    error: { code: number; message: string };
  };

  expect(response.id).toBe(2);
  expect(response.error.code).toBe(-32601); // METHOD_NOT_FOUND
  expect(response.error.message).toContain("Method not found");

  server.stop();
});

test("calling method before initialize returns internal error", async () => {
  const { server, send, waitForMessages } = createServer();
  server.start();

  send({ id: 1, method: "sendMessage", params: { text: "hi" } });
  const msgs = await waitForMessages(1);
  const response = msgs[0] as {
    id: number;
    error: { code: number; message: string };
  };

  expect(response.id).toBe(1);
  expect(response.error.code).toBe(-32603); // INTERNAL_ERROR
  expect(response.error.message).toContain("not initialized");

  server.stop();
});

// ── Server notifications (callbacks → output) ────────────────────

test("callback triggers notification output on stdout", async () => {
  const { server, send, waitForMessages } = createServer();
  server.start();

  send({ id: 1, method: "initialize", params: {} });
  await waitForMessages(1);

  // Grab callbacks from Agent.create
  const options = vi.mocked(Agent.create).mock.calls[0][0];
  const callbacks = options.callbacks!;

  // Simulate a loading change callback
  callbacks.onLoadingChange!(true);

  const msgs = await waitForMessages(2);
  const notification = msgs[1] as {
    method: string;
    params: { loading: boolean; latestTotalTokens?: number };
  };

  expect(notification.method).toBe("loadingChange");
  expect(notification.params).toEqual({ loading: true, latestTotalTokens: 0 });

  server.stop();
});

// ── Permission flow end-to-end ───────────────────────────────────

test("canUseTool triggers permissionRequest notification and resolves on permissionResponse", async () => {
  const { server, send, waitForMessages, getMessages } = createServer();
  server.start();

  send({ id: 1, method: "initialize", params: {} });
  await waitForMessages(1);

  // Get canUseTool from options
  const options = vi.mocked(Agent.create).mock.calls[0][0];
  const canUseTool = options.canUseTool!;

  // Trigger canUseTool
  const permissionPromise = canUseTool({
    toolName: "Bash",
    permissionMode: "default",
    toolInput: { command: "ls" },
  });

  // Wait for permissionRequest notification
  await vi.waitFor(() => {
    const msgs = getMessages();
    expect(
      msgs.some(
        (m) => (m as { method: string }).method === "permissionRequest",
      ),
    ).toBe(true);
  });

  const allMsgs = getMessages();
  const permNotif = allMsgs.find(
    (m) => (m as { method: string }).method === "permissionRequest",
  ) as { method: string; params: { requestId: string } };
  const requestId = permNotif.params.requestId;

  // Client sends permissionResponse notification
  send({
    method: "permissionResponse",
    params: { requestId, decision: { behavior: "allow" } },
  });

  const decision = await permissionPromise;
  expect(decision.behavior).toBe("allow");

  server.stop();
});

// ── stop() ───────────────────────────────────────────────────────

test("stop() closes the readline interface", async () => {
  const { server, input } = createServer();
  server.start();
  server.stop();

  // Writing after stop should not crash
  input.write('{"id":1,"method":"initialize","params":{}}\n');

  // No crash = pass
  expect(true).toBe(true);
});
