import { test, expect, vi, beforeEach, afterEach } from "vitest";
import { Agent } from "wave-agent-sdk";

// Mock the Agent SDK
vi.mock("wave-agent-sdk");

// Mock process.stderr.write to suppress noise
const stderrWriteSpy = vi
  .spyOn(process.stderr, "write")
  .mockImplementation(() => true);

import { AgentBridge, RpcError } from "../../src/stdio/agentBridge.js";
import type {
  AgentCallbacks,
  Message,
  ToolPermissionContext,
} from "wave-agent-sdk";

// ── Helpers ──────────────────────────────────────────────────────

function createMockAgent(overrides: Record<string, unknown> = {}) {
  const messages: Message[] = [];
  return {
    sessionId: "test-session-id",
    workingDirectory: "/test/workdir",
    latestTotalTokens: 100,
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
    getAvailableToolNames: vi.fn().mockReturnValue(["Bash", "Read", "Write"]),
    ...overrides,
  } as unknown as Agent;
}

function createBridge() {
  const notifications: Array<{ method: string; params: unknown }> = [];
  const bridge = new AgentBridge({
    emit: (method, params) => notifications.push({ method, params }),
  });
  return { bridge, notifications };
}

// ── Tests ────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  stderrWriteSpy.mockRestore();
});

// ── initialize ───────────────────────────────────────────────────

test("initialize creates Agent with correct options and returns session info", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {
    workdir: "/test/workdir",
    model: "gpt-4",
    permissionMode: "acceptEdits",
  });

  expect(result).toEqual({
    sessionId: "test-session-id",
    workingDirectory: "/test/workdir",
  });
  expect(Agent.create).toHaveBeenCalledTimes(1);

  // Verify callbacks and canUseTool were passed
  const options = vi.mocked(Agent.create).mock.calls[0][0];
  expect(options.workdir).toBe("/test/workdir");
  expect(options.model).toBe("gpt-4");
  expect(options.permissionMode).toBe("acceptEdits");
  expect(options.callbacks).toBeDefined();
  expect(options.canUseTool).toBeDefined();
});

test("initialize passes pluginDirs as PluginConfig[]", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {
    pluginDirs: ["/path/to/plugin1", "/path/to/plugin2"],
  });

  const options = vi.mocked(Agent.create).mock.calls[0][0];
  expect(options.plugins).toEqual([
    { type: "local", path: "/path/to/plugin1" },
    { type: "local", path: "/path/to/plugin2" },
  ]);
});

// ── Callbacks → Notifications ────────────────────────────────────

test("onMessagesChange emits messagesChange notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  const messages = [
    { id: "1", role: "user", blocks: [] },
  ] as unknown as Message[];
  callbacks.onMessagesChange!(messages);

  expect(notifications).toContainEqual({
    method: "messagesChange",
    params: { messages },
  });
});

test("onUserMessageAdded finds last user message and emits notification", async () => {
  const { bridge, notifications } = createBridge();
  const userMessage = {
    id: "msg-1",
    role: "user",
    blocks: [{ type: "text", content: "hello" }],
  } as unknown as Message;
  const mockAgent = createMockAgent({ messages: [userMessage] });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onUserMessageAdded!({} as never);

  expect(notifications).toContainEqual({
    method: "userMessageAdded",
    params: { message: userMessage },
  });
});

test("onAssistantMessageAdded finds message by id and emits notification", async () => {
  const { bridge, notifications } = createBridge();
  const assistantMessage = {
    id: "msg-2",
    role: "assistant",
    blocks: [{ type: "text", content: "hi" }],
  } as unknown as Message;
  const mockAgent = createMockAgent({ messages: [assistantMessage] });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onAssistantMessageAdded!("msg-2");

  expect(notifications).toContainEqual({
    method: "assistantMessageAdded",
    params: { message: assistantMessage },
  });
});

test("onLoadingChange emits loadingChange notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onLoadingChange!(true);

  expect(notifications).toContainEqual({
    method: "loadingChange",
    params: { loading: true },
  });
});

test("onErrorBlockAdded emits errorBlockAdded notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onErrorBlockAdded!("something went wrong");

  expect(notifications).toContainEqual({
    method: "errorBlockAdded",
    params: { error: "something went wrong" },
  });
});

test("onPermissionModeChange emits permissionModeChange notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onPermissionModeChange!("plan");

  expect(notifications).toContainEqual({
    method: "permissionModeChange",
    params: { mode: "plan" },
  });
});

// ── canUseTool permission flow ───────────────────────────────────

test("canUseTool emits permissionRequest and resolves when permissionResponse received", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const options = vi.mocked(Agent.create).mock.calls[0][0];
  const canUseTool = options.canUseTool!;

  const context: ToolPermissionContext = {
    toolName: "Bash",
    permissionMode: "default",
    toolInput: { command: "ls" },
  };

  const permissionPromise = canUseTool(context);

  // Wait for notification to be emitted
  await vi.waitFor(() => {
    expect(notifications.some((n) => n.method === "permissionRequest")).toBe(
      true,
    );
  });

  const permNotification = notifications.find(
    (n) => n.method === "permissionRequest",
  )!;
  const requestId = (permNotification.params as { requestId: string })
    .requestId;

  // Client responds with allow
  bridge.handleNotification("permissionResponse", {
    requestId,
    decision: { behavior: "allow" },
  });

  const decision = await permissionPromise;
  expect(decision.behavior).toBe("allow");
});

test("canUseTool resolves with deny on timeout", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const options = vi.mocked(Agent.create).mock.calls[0][0];
  const canUseTool = options.canUseTool!;

  const context: ToolPermissionContext = {
    toolName: "Write",
    permissionMode: "default",
  };

  // Use fake timers to test timeout
  vi.useFakeTimers();
  const permissionPromise = canUseTool(context);

  // Advance past 5-minute timeout
  vi.advanceTimersByTime(5 * 60 * 1000 + 100);

  const decision = await permissionPromise;
  expect(decision.behavior).toBe("deny");
  expect(decision.message).toBe("Permission request timed out");
  vi.useRealTimers();
});

// ── Request routing ──────────────────────────────────────────────

test("sendMessage calls agent.sendMessage with text and images", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  await bridge.handleRequest("sendMessage", {
    text: "hello world",
    images: [{ path: "/img.png", mimeType: "image/png" }],
  });

  expect(mockAgent.sendMessage).toHaveBeenCalledWith("hello world", [
    { path: "/img.png", mimeType: "image/png" },
  ]);
});

test("bang calls agent.bang with command", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  await bridge.handleRequest("bang", { command: "git status" });

  expect(mockAgent.bang).toHaveBeenCalledWith("git status");
});

test("abortMessage calls agent.abortMessage", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  await bridge.handleRequest("abortMessage", {});

  expect(mockAgent.abortMessage).toHaveBeenCalled();
});

test("clearMessages calls agent.clearMessages", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  await bridge.handleRequest("clearMessages", {});

  expect(mockAgent.clearMessages).toHaveBeenCalled();
});

test("getMessages returns agent messages", async () => {
  const { bridge } = createBridge();
  const testMessages = [
    { id: "1", role: "user", blocks: [] },
  ] as unknown as Message[];
  const mockAgent = createMockAgent({ messages: testMessages });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  const result = await bridge.handleRequest("getMessages", {});

  expect(result).toEqual({ messages: testMessages });
});

test("getFullMessageThread returns messages and sessionIds", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  const result = await bridge.handleRequest("getFullMessageThread", {});

  expect(result).toEqual({
    messages: [],
    sessionIds: ["test-session-id"],
  });
  expect(mockAgent.getFullMessageThread).toHaveBeenCalled();
});

test("getSessionInfo returns session info", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const result = await bridge.handleRequest("getSessionInfo", {});

  expect(result).toEqual({
    sessionId: "test-session-id",
    workingDirectory: "/test/workdir",
    latestTotalTokens: 100,
    permissionMode: "default",
    availableTools: ["Bash", "Read", "Write"],
  });
});

test("setPermissionMode calls agent.setPermissionMode", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  await bridge.handleRequest("setPermissionMode", { mode: "plan" });

  expect(mockAgent.setPermissionMode).toHaveBeenCalledWith("plan");
});

test("getPermissionMode returns current mode", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const result = await bridge.handleRequest("getPermissionMode", {});

  expect(result).toEqual({ mode: "default" });
});

test("getMcpServers returns server list", async () => {
  const { bridge } = createBridge();
  const servers = [{ name: "test-server", status: "connected" }];
  vi.mocked(Agent.create).mockResolvedValue(
    createMockAgent({ getMcpServers: vi.fn().mockReturnValue(servers) }),
  );

  await bridge.handleRequest("initialize", {});
  const result = await bridge.handleRequest("getMcpServers", {});

  expect(result).toEqual({ servers });
});

test("connectMcpServer calls agent.connectMcpServer", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  const result = await bridge.handleRequest("connectMcpServer", {
    serverName: "my-server",
  });

  expect(mockAgent.connectMcpServer).toHaveBeenCalledWith("my-server");
  expect(result).toEqual({ success: true });
});

test("disconnectMcpServer calls agent.disconnectMcpServer", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  const result = await bridge.handleRequest("disconnectMcpServer", {
    serverName: "my-server",
  });

  expect(mockAgent.disconnectMcpServer).toHaveBeenCalledWith("my-server");
  expect(result).toEqual({ success: true });
});

test("getSlashCommands returns command list", async () => {
  const { bridge } = createBridge();
  const commands = [{ name: "/help", description: "Show help" }];
  vi.mocked(Agent.create).mockResolvedValue(
    createMockAgent({ getSlashCommands: vi.fn().mockReturnValue(commands) }),
  );

  await bridge.handleRequest("initialize", {});
  const result = await bridge.handleRequest("getSlashCommands", {});

  expect(result).toEqual({ commands });
});

test("rewindToMessage truncates history and returns input content", async () => {
  const { bridge } = createBridge();
  const messages = [
    { id: "msg-1", role: "user", blocks: [{ type: "text", content: "hello" }] },
    {
      id: "msg-2",
      role: "assistant",
      blocks: [{ type: "text", content: "hi" }],
    },
  ] as unknown as Message[];
  const mockAgent = createMockAgent({
    messages,
    getFullMessageThread: vi.fn().mockResolvedValue({
      messages,
      sessionIds: ["test-session-id"],
    }),
  });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  const result = await bridge.handleRequest("rewindToMessage", {
    messageId: "msg-1",
  });

  expect(mockAgent.truncateHistory).toHaveBeenCalledWith(0);
  expect(result).toEqual({ inputContent: "hello" });
});

test("deleteQueuedMessage calls removeQueuedMessage", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  await bridge.handleRequest("deleteQueuedMessage", { index: 2 });

  expect(mockAgent.removeQueuedMessage).toHaveBeenCalledWith(2);
});

test("destroy destroys the agent", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  await bridge.handleRequest("initialize", {});
  await bridge.handleRequest("destroy", {});

  expect(mockAgent.destroy).toHaveBeenCalled();
});

// ── Error handling ───────────────────────────────────────────────

test("unknown method throws METHOD_NOT_FOUND", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});

  await expect(bridge.handleRequest("nonexistentMethod", {})).rejects.toThrow(
    "Method not found: nonexistentMethod",
  );
});

test("calling method before initialize throws INTERNAL_ERROR", async () => {
  const { bridge } = createBridge();

  await expect(
    bridge.handleRequest("sendMessage", { text: "hi" }),
  ).rejects.toThrow("Agent not initialized");
});

test("RpcError has correct code and toJsonRpcError", () => {
  const err = new RpcError(-32601, "test error");
  expect(err.code).toBe(-32601);
  expect(err.message).toBe("test error");
  expect(err.toJsonRpcError()).toEqual({ code: -32601, message: "test error" });
});
