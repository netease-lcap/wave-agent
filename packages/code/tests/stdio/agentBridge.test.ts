import { test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  Agent,
  AuthService,
  PluginCore,
  PromptHistoryManager,
  listSessions,
  searchFiles,
  generateRandomName,
  getDefaultRemoteBranch,
  getMessageContent,
  validateWorktreeRemovalPath,
} from "wave-agent-sdk";
import { execFileSync } from "node:child_process";
import { createWorktree, removeWorktree } from "../../src/utils/worktree.js";

// Mock the Agent SDK
vi.mock("wave-agent-sdk");

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    execFileSync: vi.fn(),
  };
});

vi.mock("../../src/utils/worktree.js", () => ({
  createWorktree: vi.fn(),
  removeWorktree: vi.fn(),
}));

// writeArtifactFile writes into the artifacts dir on the machine where the
// agent runs (the remote daemon). Stub fs/os so the path and bytes are
// observable without touching disk; the real functions are only used by
// writeArtifactFile, so the rest of the file is unaffected.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    mkdirSync: vi.fn(() => undefined),
    existsSync: vi.fn(() => false),
    writeFileSync: vi.fn(() => undefined),
  };
});

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    tmpdir: vi.fn(() => "/tmp"),
  };
});

// Mock process.stderr.write to suppress noise
const stderrWriteSpy = vi
  .spyOn(process.stderr, "write")
  .mockImplementation(() => true);

import { AgentBridge, RpcError } from "../../src/stdio/agentBridge.js";
import { INVALID_PARAMS } from "../../src/stdio/protocol.js";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import type {
  AgentCallbacks,
  McpServerStatus,
  Message,
  QueuedMessage,
  Task,
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
    compact: vi.fn().mockResolvedValue(undefined),
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
  const notifications: Array<{
    method: string;
    params: unknown;
    sessionId?: string;
  }> = [];
  const bridge = new AgentBridge({
    emit: (method, params, sessionId) =>
      notifications.push({ method, params, sessionId }),
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
    permissionMode: "default",
    latestTotalTokens: 100,
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

test("initialize forwards worktreeName and isNewWorktree to Agent options", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {
    workdir: "/repo/.wave/worktrees/feat",
    worktreeName: "feat",
    isNewWorktree: true,
  });

  const options = vi.mocked(Agent.create).mock.calls[0][0];
  expect(options.worktreeName).toBe("feat");
  expect(options.isNewWorktree).toBe(true);
});

// ── Callbacks → Notifications ────────────────────────────────────

test("onAssistantContentUpdated emits assistantContentUpdated notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  const params = {
    messageId: "msg-1",
    chunk: "Hello",
    accumulated: "Hello",
    stage: "streaming" as const,
  };
  callbacks.onAssistantContentUpdated!(params);

  // The wire carries only the delta (accumulated is stripped) — spec: 流式通知纯增量负载
  expect(notifications).toContainEqual({
    method: "assistantContentUpdated",
    params: { messageId: "msg-1", chunk: "Hello", stage: "streaming" },
    sessionId: "test-session-id",
  });
});

test("onToolBlockUpdated strips parameters only at streaming stage", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  // streaming: only the delta (parametersChunk) crosses the wire
  callbacks.onToolBlockUpdated!({
    messageId: "msg-1",
    id: "tool-1",
    name: "Bash",
    parameters: '{"command":"echo hi"}',
    parametersChunk: '{"command":"e',
    stage: "streaming",
  });
  expect(notifications).toContainEqual({
    method: "toolBlockUpdated",
    params: {
      messageId: "msg-1",
      id: "tool-1",
      name: "Bash",
      parametersChunk: '{"command":"e',
      stage: "streaming",
    },
    sessionId: "test-session-id",
  });

  // running (forked-skill snapshot): full parameters must be kept — stripping
  // here would permanently lose the parameters in hosts (no end update carries them)
  callbacks.onToolBlockUpdated!({
    messageId: "msg-2",
    id: "tool-2",
    name: "Skill",
    parameters: "prepared content",
    stage: "running",
  });
  expect(notifications).toContainEqual({
    method: "toolBlockUpdated",
    params: {
      messageId: "msg-2",
      id: "tool-2",
      name: "Skill",
      parameters: "prepared content",
      stage: "running",
    },
    sessionId: "test-session-id",
  });

  // end: authoritative full value, kept verbatim
  callbacks.onToolBlockUpdated!({
    messageId: "msg-1",
    id: "tool-1",
    parameters: '{"command":"echo hi"}',
    result: "hi",
    success: true,
    stage: "end",
  });
  expect(notifications).toContainEqual({
    method: "toolBlockUpdated",
    params: {
      messageId: "msg-1",
      id: "tool-1",
      parameters: '{"command":"echo hi"}',
      result: "hi",
      success: true,
      stage: "end",
    },
    sessionId: "test-session-id",
  });
});

test("onCompactBlockAdded emits compactBlockAdded notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onCompactBlockAdded!("summary content");

  expect(notifications).toContainEqual({
    method: "compactBlockAdded",
    params: { content: "summary content" },
    sessionId: "test-session-id",
  });
});

test("onCompactionStateChange emits compactionStateChange notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onCompactionStateChange!(true);

  expect(notifications).toContainEqual({
    method: "compactionStateChange",
    params: { isCompacting: true },
    sessionId: "test-session-id",
  });
});

// ── compact request ───────────────────────────────────────────────

test("compact request with customInstructions calls agent.compact and returns null", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest(
    "compact",
    { customInstructions: "focus on tests" },
    sessionId,
  );

  expect(mockAgent.compact).toHaveBeenCalledWith("focus on tests");
  expect(r).toBeNull();
});

test("compact request without customInstructions calls agent.compact with undefined", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest("compact", {}, sessionId);

  expect(mockAgent.compact).toHaveBeenCalledWith(undefined);
  expect(r).toBeNull();
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
    sessionId: "test-session-id",
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
    sessionId: "test-session-id",
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
    params: { loading: true, latestTotalTokens: 100 },
    sessionId: "test-session-id",
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
    sessionId: "test-session-id",
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
    sessionId: "test-session-id",
  });
});

test("onCommandRunningChange emits commandRunningChange notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onCommandRunningChange!(true);

  expect(notifications).toContainEqual({
    method: "commandRunningChange",
    params: { running: true },
    sessionId: "test-session-id",
  });
});

test("onQueuedMessagesChange emits queuedMessagesChange notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  const queued = [{ id: "q1", content: "hello" }] as QueuedMessage[];
  callbacks.onQueuedMessagesChange!(queued);

  expect(notifications).toContainEqual({
    method: "queuedMessagesChange",
    params: { messages: queued },
    sessionId: "test-session-id",
  });
});

test("onTasksChange emits tasksChange notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  const tasks = [{ id: "t1", subject: "Task 1", status: "pending" }] as Task[];
  callbacks.onTasksChange!(tasks);

  expect(notifications).toContainEqual({
    method: "tasksChange",
    params: { tasks },
    sessionId: "test-session-id",
  });
});

test("onSessionIdChange emits sessionIdChange notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onSessionIdChange!("session-new");

  expect(notifications).toContainEqual({
    method: "sessionIdChange",
    params: { sessionId: "session-new" },
    sessionId: "test-session-id",
  });
});

test("onSessionIdChange with unchanged session id skips re-key", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  // oldSessionId === newSessionId → the re-key condition is skipped
  callbacks.onSessionIdChange!("test-session-id");

  expect(notifications).toContainEqual({
    method: "sessionIdChange",
    params: { sessionId: "test-session-id" },
    sessionId: "test-session-id",
  });
});

test("onSessionIdChange after destroy handles missing sessions entry", async () => {
  const { bridge, notifications } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  // destroy removes the sessions map entry while registeredSessionId stays set
  await bridge.handleRequest("destroy", {}, sessionId);

  callbacks.onSessionIdChange!("session-after-destroy");

  expect(notifications).toContainEqual({
    method: "sessionIdChange",
    params: { sessionId: "session-after-destroy" },
    sessionId,
  });
});

test("onMcpServersChange emits mcpServersChange notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  const servers = [
    { name: "server1", status: "connected" },
  ] as McpServerStatus[];
  callbacks.onMcpServersChange!(servers);

  expect(notifications).toContainEqual({
    method: "mcpServersChange",
    params: { servers },
    sessionId: "test-session-id",
  });
});

test("onAddBangMessage emits bangMessageAdded notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onAddBangMessage!("ls", "msg-1");

  expect(notifications).toContainEqual({
    method: "bangMessageAdded",
    params: { command: "ls", messageId: "msg-1" },
    sessionId: "test-session-id",
  });
});

test("onUpdateBangMessage emits bangMessageUpdated notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onUpdateBangMessage!("ls", "output", "msg-1");

  expect(notifications).toContainEqual({
    method: "bangMessageUpdated",
    params: { command: "ls", output: "output", messageId: "msg-1" },
    sessionId: "test-session-id",
  });
});

test("onCompleteBangMessage emits bangMessageCompleted notification", async () => {
  const { bridge, notifications } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onCompleteBangMessage!("ls", 0, "msg-1");

  expect(notifications).toContainEqual({
    method: "bangMessageCompleted",
    params: { command: "ls", exitCode: 0, messageId: "msg-1" },
    sessionId: "test-session-id",
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
  expect(permNotification.sessionId).toBe("test-session-id");
  const requestId = (permNotification.params as { requestId: string })
    .requestId;

  // Client responds with allow (permissionResponse uses requestId, no sessionId needed)
  bridge.handleNotification("permissionResponse", {
    requestId,
    decision: { behavior: "allow" },
  });

  const decision = await permissionPromise;
  expect(decision.behavior).toBe("allow");
});

test("canUseTool stays pending without auto-deny (no timeout)", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});
  const options = vi.mocked(Agent.create).mock.calls[0][0];
  const canUseTool = options.canUseTool!;

  const context: ToolPermissionContext = {
    toolName: "Write",
    permissionMode: "default",
  };

  vi.useFakeTimers();
  const permissionPromise = canUseTool(context);

  // Advance well past any former timeout — promise must NOT resolve
  let resolved = false;
  permissionPromise.then(() => {
    resolved = true;
  });
  vi.advanceTimersByTime(10 * 60 * 1000);
  expect(resolved).toBe(false);

  // Cleanup: resolve via permissionResponse so the promise doesn't hang
  vi.useRealTimers();
});

// ── Request routing ──────────────────────────────────────────────

test("sendMessage calls agent.sendMessage with text and images", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest(
    "sendMessage",
    {
      text: "hello world",
      images: [{ path: "/img.png", mimeType: "image/png" }],
    },
    sessionId,
  );

  expect(mockAgent.sendMessage).toHaveBeenCalledWith("hello world", [
    { path: "/img.png", mimeType: "image/png" },
  ]);
});

test("bang calls agent.bang with command", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest("bang", { command: "git status" }, sessionId);

  expect(mockAgent.bang).toHaveBeenCalledWith("git status");
});

test("abortMessage calls agent.abortMessage", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest("abortMessage", {}, sessionId);

  expect(mockAgent.abortMessage).toHaveBeenCalled();
});

test("clearMessages calls agent.clearMessages", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest("clearMessages", {}, sessionId);

  expect(mockAgent.clearMessages).toHaveBeenCalled();
});

test("getMessages returns agent messages", async () => {
  const { bridge } = createBridge();
  const testMessages = [
    { id: "1", role: "user", blocks: [] },
  ] as unknown as Message[];
  const mockAgent = createMockAgent({ messages: testMessages });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest("getMessages", {}, sessionId);

  expect(r).toEqual({ messages: testMessages });
});

test("getFullMessageThread returns messages and sessionIds", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest("getFullMessageThread", {}, sessionId);

  expect(r).toEqual({
    messages: [],
    sessionIds: ["test-session-id"],
  });
  expect(mockAgent.getFullMessageThread).toHaveBeenCalled();
});

test("listRewindCheckpoints filters to real user messages and flattens content", async () => {
  const { bridge } = createBridge();
  // The SDK module is auto-mocked; give getMessageContent a real-ish implementation.
  vi.mocked(getMessageContent).mockImplementation((m) => {
    const block = m.blocks.find((b) => b.type === "text");
    return block && "content" in block ? (block.content as string) : "";
  });
  const threadMessages = [
    {
      role: "user",
      id: "u1",
      blocks: [{ type: "text", content: "first\n  message" }],
    },
    {
      role: "assistant",
      id: "a1",
      blocks: [{ type: "text", content: "reply" }],
    },
    {
      role: "user",
      id: "u2",
      isMeta: true,
      blocks: [{ type: "text", content: "meta" }],
    },
    { role: "user", blocks: [{ type: "text", content: "no id" }] },
    { role: "user", id: "u3", blocks: [{ type: "text", content: "second" }] },
    // 后台通知：role 是 user 但不是用户输入，不能作为回滚点
    {
      role: "user",
      id: "u4",
      blocks: [
        {
          type: "task_notification",
          taskId: "t1",
          taskType: "shell",
          status: "completed",
          summary: "后台任务完成",
        },
      ],
    },
    // hook 注入的 user 消息（UserPromptSubmit stdout / PostToolUse 错误等）同样不是用户输入
    {
      role: "user",
      id: "u5",
      blocks: [{ type: "text", content: "hook 输出", source: "hook" }],
    },
  ] as unknown as Message[];
  const mockAgent = createMockAgent({
    getFullMessageThread: vi.fn().mockResolvedValue({
      messages: threadMessages,
      sessionIds: ["test-session-id"],
    }),
  });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest("listRewindCheckpoints", {}, sessionId);

  expect(r).toEqual({
    checkpoints: [
      { id: "u1", content: "first message" },
      { id: "u3", content: "second" },
    ],
  });
});

test("listRewindCheckpoints returns empty list when no user messages", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest("listRewindCheckpoints", {}, sessionId);

  expect(r).toEqual({ checkpoints: [] });
});

test("getSessionInfo returns session info", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest("getSessionInfo", {}, sessionId);

  expect(r).toEqual({
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

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest("setPermissionMode", { mode: "plan" }, sessionId);

  expect(mockAgent.setPermissionMode).toHaveBeenCalledWith("plan");
});

test("getPermissionMode returns current mode", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest("getPermissionMode", {}, sessionId);

  expect(r).toEqual({ mode: "default" });
});

test("getMcpServers returns server list", async () => {
  const { bridge } = createBridge();
  const servers = [{ name: "test-server", status: "connected" }];
  vi.mocked(Agent.create).mockResolvedValue(
    createMockAgent({ getMcpServers: vi.fn().mockReturnValue(servers) }),
  );

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest("getMcpServers", {}, sessionId);

  expect(r).toEqual({ servers });
});

test("connectMcpServer calls agent.connectMcpServer", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest(
    "connectMcpServer",
    { serverName: "my-server" },
    sessionId,
  );

  expect(mockAgent.connectMcpServer).toHaveBeenCalledWith("my-server");
  expect(r).toEqual({ success: true });
});

test("disconnectMcpServer calls agent.disconnectMcpServer", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest(
    "disconnectMcpServer",
    { serverName: "my-server" },
    sessionId,
  );

  expect(mockAgent.disconnectMcpServer).toHaveBeenCalledWith("my-server");
  expect(r).toEqual({ success: true });
});

test("getSlashCommands returns command list", async () => {
  const { bridge } = createBridge();
  const commands = [{ name: "/help", description: "Show help" }];
  vi.mocked(Agent.create).mockResolvedValue(
    createMockAgent({ getSlashCommands: vi.fn().mockReturnValue(commands) }),
  );

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest("getSlashCommands", {}, sessionId);

  expect(r).toEqual({ commands });
});

test("askBtw returns the side-question answer", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent({
    askBtw: vi.fn().mockResolvedValue("side answer"),
  });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest(
    "askBtw",
    { question: "what is 2+2?" },
    sessionId,
  );

  // askBtw now also receives streaming callbacks (content/reasoning)
  expect(vi.mocked(mockAgent.askBtw).mock.calls[0][0]).toBe("what is 2+2?");
  expect(vi.mocked(mockAgent.askBtw).mock.calls[0][1]).toBeUndefined();
  expect(r).toBe("side answer");
});

test("askBtw emits btwContent notifications for thinking and content chunks", async () => {
  const { bridge, notifications } = createBridge();
  const mockAgent = createMockAgent({
    askBtw: vi
      .fn()
      .mockImplementation(
        async (
          _question: string,
          _signal: AbortSignal | undefined,
          onContent?: (content: string) => void,
          onReasoning?: (content: string) => void,
        ) => {
          onReasoning?.("thinking chunk");
          onContent?.("answer chunk");
          return "side answer";
        },
      ),
  });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest("askBtw", { question: "what is 2+2?" }, sessionId);

  expect(notifications).toContainEqual({
    method: "btwContent",
    params: {
      question: "what is 2+2?",
      content: "thinking chunk",
      type: "thinking",
    },
    sessionId,
  });
  expect(notifications).toContainEqual({
    method: "btwContent",
    params: {
      question: "what is 2+2?",
      content: "answer chunk",
      type: "content",
    },
    sessionId,
  });
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

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest(
    "rewindToMessage",
    { messageId: "msg-1" },
    sessionId,
  );

  expect(mockAgent.truncateHistory).toHaveBeenCalledWith(0);
  expect(r).toEqual({ inputContent: "hello" });
});

test("deleteQueuedMessage calls removeQueuedMessage", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest("deleteQueuedMessage", { index: 2 }, sessionId);

  expect(mockAgent.removeQueuedMessage).toHaveBeenCalledWith(2);
});

test("destroy destroys the agent", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest("destroy", {}, sessionId);

  expect(mockAgent.destroy).toHaveBeenCalled();
});

test("destroy with unknown sessionId is a no-op", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});

  const result = await bridge.handleRequest("destroy", {}, "unknown-session");

  expect(result).toBeNull();
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
  ).rejects.toThrow("sessionId is required for this request");
});

test("calling method with an unknown sessionId throws Session not found", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  await bridge.handleRequest("initialize", {});

  await expect(
    bridge.handleRequest("sendMessage", { text: "hi" }, "unknown-session"),
  ).rejects.toThrow("Session not found: unknown-session");
});

test("RpcError has correct code and toJsonRpcError", () => {
  const err = new RpcError(-32601, "test error");
  expect(err.code).toBe(-32601);
  expect(err.message).toBe("test error");
  expect(err.toJsonRpcError()).toEqual({ code: -32601, message: "test error" });
});

// ── sendMessage prompt history ──────────────────────────────────

test("sendMessage saves prompt to history before sending", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest("sendMessage", { text: "hello world" }, sessionId);

  expect(PromptHistoryManager.addEntry).toHaveBeenCalledWith(
    "hello world",
    "test-session-id",
    {},
    "/test/workdir",
  );
  expect(mockAgent.sendMessage).toHaveBeenCalledWith("hello world", undefined);
});

// ── searchFiles with workdir ─────────────────────────────────────

test("searchFiles uses workdir param when provided", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());
  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;

  await bridge.handleRequest(
    "searchFiles",
    {
      query: "test",
      maxResults: 10,
      workdir: "/custom/workdir",
    },
    sessionId,
  );

  expect(searchFiles).toHaveBeenCalledWith("test", {
    maxResults: 10,
    workingDirectory: "/custom/workdir",
  });
});

test("searchFiles falls back to agent workingDirectory", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());
  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;

  await bridge.handleRequest("searchFiles", { query: "test" }, sessionId);

  expect(searchFiles).toHaveBeenCalledWith("test", {
    maxResults: undefined,
    workingDirectory: "/test/workdir",
  });
});

// ── writeArtifactFile (remote uploads) ──────────────────────────

test("writeArtifactFile writes bytes into the artifacts dir and returns the path", async () => {
  const { bridge } = createBridge();
  vi.mocked(tmpdir).mockReturnValue("/remote/tmp");
  vi.mocked(existsSync).mockReturnValue(false);

  const result = await bridge.handleRequest("writeArtifactFile", {
    name: "note.txt",
    contentBase64: Buffer.from("hello").toString("base64"),
  });

  expect(result).toEqual({ path: "/remote/tmp/wave-artifacts/note.txt" });
  expect(mkdirSync).toHaveBeenCalledWith("/remote/tmp/wave-artifacts", {
    recursive: true,
  });
  expect(writeFileSync).toHaveBeenCalledWith(
    "/remote/tmp/wave-artifacts/note.txt",
    Buffer.from("hello"),
  );
});

test("writeArtifactFile renames on collision with a numeric suffix", async () => {
  const { bridge } = createBridge();
  vi.mocked(tmpdir).mockReturnValue("/remote/tmp");
  vi.mocked(existsSync)
    .mockReturnValueOnce(true) // note.txt taken
    .mockReturnValueOnce(false); // note_1.txt free

  const result = await bridge.handleRequest("writeArtifactFile", {
    name: "note.txt",
    contentBase64: "aGVsbG8=",
  });

  expect(result).toEqual({ path: "/remote/tmp/wave-artifacts/note_1.txt" });
  expect(writeFileSync).toHaveBeenCalledWith(
    "/remote/tmp/wave-artifacts/note_1.txt",
    expect.any(Buffer),
  );
});

test("writeArtifactFile strips path traversal via basename", async () => {
  const { bridge } = createBridge();
  vi.mocked(tmpdir).mockReturnValue("/remote/tmp");
  vi.mocked(existsSync).mockReturnValue(false);

  const result = await bridge.handleRequest("writeArtifactFile", {
    name: "../../etc/evil.txt",
    contentBase64: "aGVsbG8=",
  });

  expect(result).toEqual({ path: "/remote/tmp/wave-artifacts/evil.txt" });
});

test("writeArtifactFile rejects empty or dot names", async () => {
  const { bridge } = createBridge();

  for (const name of ["", ".", ".."]) {
    await expect(
      bridge.handleRequest("writeArtifactFile", {
        name,
        contentBase64: "aGVsbG8=",
      }),
    ).rejects.toMatchObject({ code: INVALID_PARAMS });
  }
  expect(writeFileSync).not.toHaveBeenCalled();
});

// ── Auth handlers ────────────────────────────────────────────────

test("getAuthStatus returns auth state", async () => {
  const { bridge } = createBridge();
  vi.mocked(AuthService.getInstance).mockReturnValue({
    isSSOAuthenticated: vi.fn().mockReturnValue(true),
    getAuthUser: vi
      .fn()
      .mockReturnValue({ id: "user-1", email: "test@test.com" }),
    getServerUrl: vi.fn().mockReturnValue("https://codechat.codewave.163.com"),
    checkAndRefreshTokenIfNeeded: vi.fn().mockResolvedValue(true),
  } as unknown as AuthService);

  const result = await bridge.handleRequest("getAuthStatus", {});

  expect(result).toEqual({
    isAuthenticated: true,
    user: { id: "user-1", email: "test@test.com" },
    serverUrl: "https://codechat.codewave.163.com",
  });
});

test("getAuthStatus refreshes a stale-but-refreshable token before reporting", async () => {
  // A remote daemon started with an expired access token (hourly expiry) must
  // still report the user as logged in once the refresh succeeds. Without the
  // proactive refresh, getAuthStatus returns false right after daemon start —
  // the desktop welcome page then keeps showing the login button although the
  // user is authenticated (refresh token valid).
  const { bridge } = createBridge();
  let authenticated = false; // stale token on disk when the daemon starts
  const isSSOAuthenticated = vi.fn(() => authenticated);
  const checkAndRefreshTokenIfNeeded = vi.fn().mockImplementation(async () => {
    authenticated = true; // the refresh writes a fresh token
    return true;
  });
  vi.mocked(AuthService.getInstance).mockReturnValue({
    isSSOAuthenticated,
    getAuthUser: vi
      .fn()
      .mockReturnValue({ id: "user-1", email: "test@test.com" }),
    getServerUrl: vi.fn().mockReturnValue("https://codechat.codewave.163.com"),
    checkAndRefreshTokenIfNeeded,
  } as unknown as AuthService);

  const result = await bridge.handleRequest("getAuthStatus", {});

  expect(checkAndRefreshTokenIfNeeded).toHaveBeenCalled();
  expect(result).toEqual({
    isAuthenticated: true,
    user: { id: "user-1", email: "test@test.com" },
    serverUrl: "https://codechat.codewave.163.com",
  });
});

test("login emits authUrl notification and returns user", async () => {
  const { bridge, notifications } = createBridge();
  let capturedOnAuthUrl: ((url: string) => void) | undefined;
  vi.mocked(AuthService.getInstance).mockReturnValue({
    login: vi.fn().mockImplementation(async (opts) => {
      capturedOnAuthUrl = opts?.onAuthUrl;
      capturedOnAuthUrl?.("https://example.com/login");
    }),
    getAuthUser: vi
      .fn()
      .mockReturnValue({ id: "user-1", email: "test@test.com" }),
  } as unknown as AuthService);

  const result = await bridge.handleRequest("login", {});

  expect(notifications).toContainEqual({
    method: "authUrl",
    params: { url: "https://example.com/login" },
  });
  expect(result).toEqual({
    user: { id: "user-1", email: "test@test.com" },
  });
});

test("logout clears auth", async () => {
  const { bridge } = createBridge();
  const clearAuth = vi.fn().mockResolvedValue(undefined);
  vi.mocked(AuthService.getInstance).mockReturnValue({
    clearAuth,
  } as unknown as AuthService);

  await bridge.handleRequest("logout", {});

  expect(clearAuth).toHaveBeenCalled();
});

// ── Plugin handlers ──────────────────────────────────────────────

function mockPluginCore(instance: Record<string, unknown>) {
  vi.mocked(PluginCore).mockImplementation(function () {
    return instance;
  } as unknown as typeof PluginCore);
}

test("listPlugins returns mapped plugin list", async () => {
  const { bridge } = createBridge();
  mockPluginCore({
    listPlugins: vi.fn().mockResolvedValue({
      plugins: [
        {
          name: "my-plugin",
          marketplace: "official",
          description: "A test plugin",
          installed: true,
          version: "1.0.0",
          scope: "user",
          source: "github",
        },
      ],
      mergedEnabled: { "my-plugin@official": true },
    }),
  });

  const result = (await bridge.handleRequest("listPlugins", {})) as {
    plugins: Array<Record<string, unknown>>;
  };

  expect(result.plugins).toHaveLength(1);
  expect(result.plugins[0]).toEqual({
    id: "my-plugin@official",
    name: "my-plugin",
    description: "A test plugin",
    marketplace: "official",
    installed: true,
    version: "1.0.0",
    enabled: true,
    scope: "user",
  });
});

test("installPlugin delegates to PluginCore", async () => {
  const { bridge } = createBridge();
  const installPlugin = vi.fn().mockResolvedValue({
    name: "test",
    marketplace: "official",
    version: "1.0.0",
    cachePath: "/cache",
  });
  mockPluginCore({ installPlugin });

  await bridge.handleRequest("installPlugin", {
    pluginId: "test@official",
    scope: "user",
  });

  expect(installPlugin).toHaveBeenCalledWith("test@official", "user");
});

test("uninstallPlugin delegates to PluginCore", async () => {
  const { bridge } = createBridge();
  const uninstallPlugin = vi.fn().mockResolvedValue(undefined);
  mockPluginCore({ uninstallPlugin });

  await bridge.handleRequest("uninstallPlugin", { pluginId: "test@official" });

  expect(uninstallPlugin).toHaveBeenCalledWith("test@official");
});

test("enablePlugin delegates to PluginCore", async () => {
  const { bridge } = createBridge();
  const enablePlugin = vi.fn().mockResolvedValue("user");
  mockPluginCore({ enablePlugin });

  await bridge.handleRequest("enablePlugin", { pluginId: "test@official" });

  expect(enablePlugin).toHaveBeenCalledWith("test@official", undefined);
});

test("disablePlugin delegates to PluginCore", async () => {
  const { bridge } = createBridge();
  const disablePlugin = vi.fn().mockResolvedValue("user");
  mockPluginCore({ disablePlugin });

  await bridge.handleRequest("disablePlugin", {
    pluginId: "test@official",
    scope: "project",
  });

  expect(disablePlugin).toHaveBeenCalledWith("test@official", "project");
});

test("getProjectSettings returns merged enabledPlugins from PluginCore", async () => {
  const { bridge } = createBridge();
  const getMergedEnabledPlugins = vi.fn().mockReturnValue({
    "sdd@builtin": true,
    "other@official": false,
  });
  mockPluginCore({ getMergedEnabledPlugins });

  const result = (await bridge.handleRequest("getProjectSettings", {
    workdir: "/repo",
  })) as { enabledPlugins: Record<string, boolean> };

  expect(getMergedEnabledPlugins).toHaveBeenCalled();
  expect(result).toEqual({
    enabledPlugins: { "sdd@builtin": true, "other@official": false },
  });
});

test("setBuiltinPluginEnabled enables plugin with project scope when enabled", async () => {
  const { bridge } = createBridge();
  const enablePlugin = vi.fn().mockResolvedValue("project");
  const getMergedEnabledPlugins = vi.fn().mockReturnValue({
    "sdd@builtin": true,
  });
  mockPluginCore({ enablePlugin, getMergedEnabledPlugins });

  const result = (await bridge.handleRequest("setBuiltinPluginEnabled", {
    pluginId: "sdd@builtin",
    enabled: true,
  })) as { enabledPlugins: Record<string, boolean> };

  expect(enablePlugin).toHaveBeenCalledWith("sdd@builtin", "project");
  expect(result).toEqual({ enabledPlugins: { "sdd@builtin": true } });
});

test("setBuiltinPluginEnabled disables plugin with project scope when disabled", async () => {
  const { bridge } = createBridge();
  const disablePlugin = vi.fn().mockResolvedValue("project");
  const getMergedEnabledPlugins = vi.fn().mockReturnValue({
    "sdd@builtin": false,
  });
  mockPluginCore({ disablePlugin, getMergedEnabledPlugins });

  const result = (await bridge.handleRequest("setBuiltinPluginEnabled", {
    pluginId: "sdd@builtin",
    enabled: false,
    scope: "project",
  })) as { enabledPlugins: Record<string, boolean> };

  expect(disablePlugin).toHaveBeenCalledWith("sdd@builtin", "project");
  expect(result).toEqual({ enabledPlugins: { "sdd@builtin": false } });
});

test("setBuiltinPluginEnabled forwards explicit scope", async () => {
  const { bridge } = createBridge();
  const enablePlugin = vi.fn().mockResolvedValue("user");
  const getMergedEnabledPlugins = vi.fn().mockReturnValue({
    "sdd@builtin": true,
  });
  mockPluginCore({ enablePlugin, getMergedEnabledPlugins });

  await bridge.handleRequest("setBuiltinPluginEnabled", {
    pluginId: "sdd@builtin",
    enabled: true,
    scope: "user",
  });

  expect(enablePlugin).toHaveBeenCalledWith("sdd@builtin", "user");
});

test("listMarketplaces delegates to PluginCore", async () => {
  const { bridge } = createBridge();
  const listMarketplaces = vi
    .fn()
    .mockResolvedValue([
      { name: "official", source: { source: "directory", path: "/path" } },
    ]);
  mockPluginCore({ listMarketplaces });

  const result = await bridge.handleRequest("listMarketplaces", {});

  expect(listMarketplaces).toHaveBeenCalled();
  expect(result).toEqual([
    { name: "official", source: { source: "directory", path: "/path" } },
  ]);
});

test("addMarketplace delegates to PluginCore", async () => {
  const { bridge } = createBridge();
  const addMarketplace = vi.fn().mockResolvedValue({ name: "new-market" });
  mockPluginCore({ addMarketplace });

  await bridge.handleRequest("addMarketplace", { input: "owner/repo" });

  expect(addMarketplace).toHaveBeenCalledWith("owner/repo", undefined);
});

test("removeMarketplace delegates to PluginCore", async () => {
  const { bridge } = createBridge();
  const removeMarketplace = vi.fn().mockResolvedValue(undefined);
  mockPluginCore({ removeMarketplace });

  await bridge.handleRequest("removeMarketplace", { name: "official" });

  expect(removeMarketplace).toHaveBeenCalledWith("official", undefined);
});

test("updateMarketplace delegates to PluginCore", async () => {
  const { bridge } = createBridge();
  const updateMarketplace = vi.fn().mockResolvedValue(undefined);
  mockPluginCore({ updateMarketplace });

  await bridge.handleRequest("updateMarketplace", { name: "official" });

  expect(updateMarketplace).toHaveBeenCalledWith("official");
});

// ── notificationMessageAdded with full message ──────────────────

test("onNotificationMessageAdded emits with full message", async () => {
  const { bridge, notifications } = createBridge();
  const notificationMessage: Message = {
    id: "notif-1",
    role: "user",
    timestamp: new Date().toISOString(),
    blocks: [{ type: "task_notification", taskId: "task-1" } as never],
  };
  vi.mocked(Agent.create).mockResolvedValue(
    createMockAgent({ messages: [notificationMessage] }),
  );

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onNotificationMessageAdded!({
    taskId: "task-1",
    taskType: "shell",
    status: "completed",
    summary: "Done",
  });

  expect(notifications).toContainEqual({
    method: "notificationMessageAdded",
    params: {
      taskId: "task-1",
      taskType: "shell",
      status: "completed",
      summary: "Done",
      message: notificationMessage,
    },
    sessionId: "test-session-id",
  });
});

// ── Branch coverage: null params, untested switch cases ──────────

test("handleRequest with null params defaults to empty object", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const initResult = await bridge.handleRequest("initialize", {});
  const sessionId = (initResult as { sessionId: string }).sessionId;
  // getSessionInfo uses p but doesn't read any field, so null params should work
  const result = await bridge.handleRequest("getSessionInfo", null, sessionId);
  expect(result).toEqual({
    sessionId: "test-session-id",
    workingDirectory: "/test/workdir",
    latestTotalTokens: 100,
    permissionMode: "default",
    availableTools: ["Bash", "Read", "Write"],
  });
});

test("restoreSession delegates to agent.restoreSession", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest(
    "restoreSession",
    { sessionId: "old-session" },
    sessionId,
  );

  expect(mockAgent.restoreSession).toHaveBeenCalledWith("old-session");
});

test("initialize with restoreSessionId reuses a live session instead of creating a second agent", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  const first = await bridge.handleRequest("initialize", {
    workdir: "/test/workdir",
  });
  const sessionId = (first as { sessionId: string }).sessionId;

  const second = await bridge.handleRequest("initialize", {
    workdir: "/test/workdir",
    restoreSessionId: sessionId,
  });

  expect(vi.mocked(Agent.create)).toHaveBeenCalledTimes(1);
  expect(second).toEqual({
    sessionId,
    workingDirectory: "/test/workdir",
    permissionMode: "default",
    latestTotalTokens: 100,
  });
});

test("initialize with an unknown restoreSessionId creates a new agent", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  const result = await bridge.handleRequest("initialize", {
    workdir: "/test/workdir",
    restoreSessionId: "ghost-session",
  });

  // No live session matches → falls through to a fresh Agent.create
  expect(vi.mocked(Agent.create)).toHaveBeenCalledTimes(1);
  expect(result).toEqual({
    sessionId: "test-session-id",
    workingDirectory: "/test/workdir",
    permissionMode: "default",
    latestTotalTokens: 100,
  });
});

test("restoreSession to a live streaming session emits the current loading state so re-attached clients restore the running indicator", async () => {
  const { bridge, notifications } = createBridge();
  // The live agent is mid-generation on the daemon; a freshly attached client
  // missed the loadingChange(true) that fired before its router registered.
  const mockAgent = createMockAgent({ isLoading: true });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;

  await bridge.handleRequest("restoreSession", { sessionId }, sessionId);

  expect(mockAgent.restoreSession).not.toHaveBeenCalled();
  expect(notifications).toContainEqual({
    method: "loadingChange",
    params: { loading: true, latestTotalTokens: 100 },
    sessionId,
  });
});

test("restoreSession to the live session emits a messagesChange snapshot without replaying", async () => {
  const { bridge, notifications } = createBridge();
  const mockAgent = createMockAgent({
    messages: [
      {
        id: "msg-1",
        role: "user",
        blocks: [{ type: "text", content: "hello" }],
      },
    ],
  });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;

  await bridge.handleRequest("restoreSession", { sessionId }, sessionId);

  expect(mockAgent.restoreSession).not.toHaveBeenCalled();
  expect(notifications).toContainEqual({
    method: "messagesChange",
    params: {
      messages: [
        {
          id: "msg-1",
          role: "user",
          blocks: [{ type: "text", content: "hello" }],
        },
      ],
    },
    sessionId,
  });
});

test("listSessions with workdir delegates to listSessions SDK", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());
  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;

  await bridge.handleRequest(
    "listSessions",
    { workdir: "/custom/workdir" },
    sessionId,
  );

  expect(listSessions).toHaveBeenCalledWith("/custom/workdir");
});

test("listSessions without agent or workdir falls back to process.cwd()", async () => {
  const { bridge } = createBridge();
  // Don't initialize — agent is undefined

  await bridge.handleRequest("listSessions", {});

  expect(listSessions).toHaveBeenCalledWith(process.cwd());
});

test("updateConfig destroys and recreates agent with merged config", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", { model: "gpt-4" });
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest(
    "updateConfig",
    { permissionMode: "plan" },
    sessionId,
  );

  expect(mockAgent.destroy).toHaveBeenCalled();
  expect(r).toEqual({ sessionId: "test-session-id" });
  // Second Agent.create call should have merged config
  const secondCall = vi.mocked(Agent.create).mock.calls[1][0];
  expect(secondCall.model).toBe("gpt-4");
  expect(secondCall.permissionMode).toBe("plan");
});

test("updateConfig preserves worktreeName but never re-marks the worktree as new", async () => {
  const { bridge } = createBridge();
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent());

  const result = await bridge.handleRequest("initialize", {
    workdir: "/repo/.wave/worktrees/feat",
    worktreeName: "feat",
    isNewWorktree: true,
  });
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest("updateConfig", { model: "gpt-4" }, sessionId);

  const secondCall = vi.mocked(Agent.create).mock.calls[1][0];
  expect(secondCall.worktreeName).toBe("feat");
  expect(secondCall.isNewWorktree).toBeUndefined();
});

test("destroy without agent is a no-op", async () => {
  const { bridge } = createBridge();
  // Don't initialize — agent is undefined
  const result = await bridge.handleRequest("destroy", {});
  expect(result).toBeNull();
});

test("getPromptHistory delegates to PromptHistoryManager", async () => {
  const { bridge } = createBridge();
  vi.mocked(PromptHistoryManager.getHistory).mockResolvedValue([]);

  await bridge.handleRequest("getPromptHistory", { workdir: "/test/workdir" });

  expect(PromptHistoryManager.getHistory).toHaveBeenCalledWith({
    workdir: "/test/workdir",
  });
});

test("searchPromptHistory delegates to PromptHistoryManager", async () => {
  const { bridge } = createBridge();
  vi.mocked(PromptHistoryManager.searchHistory).mockResolvedValue([]);

  await bridge.handleRequest("searchPromptHistory", {
    query: "hello",
    workdir: "/test/workdir",
  });

  expect(PromptHistoryManager.searchHistory).toHaveBeenCalledWith("hello", {
    workdir: "/test/workdir",
  });
});

test("updatePlugin delegates to PluginCore", async () => {
  const { bridge } = createBridge();
  const updatePlugin = vi.fn().mockResolvedValue(undefined);
  mockPluginCore({ updatePlugin });

  await bridge.handleRequest("updatePlugin", { pluginId: "test@official" });

  expect(updatePlugin).toHaveBeenCalledWith("test@official");
});

// ── Branch coverage: handleNotification ──────────────────────────

test("handleNotification ignores unknown methods", () => {
  const { bridge } = createBridge();
  // Should not throw
  bridge.handleNotification("unknownMethod", {});
});

test("handleNotification with unknown requestId does nothing", () => {
  const { bridge } = createBridge();
  bridge.handleNotification("permissionResponse", {
    requestId: "unknown-id",
    decision: { behavior: "allow" },
  });
  // No error, no crash
});

// ── Branch coverage: sendMessage force ───────────────────────────

test("sendMessage with force aborts before sending", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent();
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest(
    "sendMessage",
    { text: "hello", force: true },
    sessionId,
  );

  expect(mockAgent.abortMessage).toHaveBeenCalled();
  expect(mockAgent.sendMessage).toHaveBeenCalledWith("hello", undefined);
});

// ── Branch coverage: rewindToMessage edge cases ──────────────────

test("rewindToMessage throws when messageId not found", async () => {
  const { bridge } = createBridge();
  const messages = [
    { id: "msg-1", role: "user", blocks: [{ type: "text", content: "hello" }] },
  ] as unknown as Message[];
  const mockAgent = createMockAgent({
    messages,
    getFullMessageThread: vi.fn().mockResolvedValue({
      messages,
      sessionIds: ["test-session-id"],
    }),
  });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;

  await expect(
    bridge.handleRequest(
      "rewindToMessage",
      { messageId: "nonexistent" },
      sessionId,
    ),
  ).rejects.toThrow("Message not found: nonexistent");
});

test("rewindToMessage returns empty string when message has no text block", async () => {
  const { bridge } = createBridge();
  const messages = [
    { id: "msg-1", role: "user", blocks: [{ type: "image" }] },
  ] as unknown as Message[];
  const mockAgent = createMockAgent({
    messages,
    getFullMessageThread: vi.fn().mockResolvedValue({
      messages,
      sessionIds: ["test-session-id"],
    }),
  });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const r = await bridge.handleRequest(
    "rewindToMessage",
    { messageId: "msg-1" },
    sessionId,
  );

  expect(r).toEqual({ inputContent: "" });
});

// ── Branch coverage: searchFiles / history without agent ─────────

test("searchFiles without agent or workdir falls back to process.cwd()", async () => {
  const { bridge } = createBridge();
  // Don't initialize — agent is undefined

  await bridge.handleRequest("searchFiles", { query: "test" });

  expect(searchFiles).toHaveBeenCalledWith("test", {
    maxResults: undefined,
    workingDirectory: process.cwd(),
  });
});

test("getPromptHistory without agent falls back to undefined workdir", async () => {
  const { bridge } = createBridge();
  vi.mocked(PromptHistoryManager.getHistory).mockResolvedValue([]);

  await bridge.handleRequest("getPromptHistory", {});

  expect(PromptHistoryManager.getHistory).toHaveBeenCalledWith({
    workdir: undefined,
  });
});

test("searchPromptHistory without agent falls back to undefined workdir", async () => {
  const { bridge } = createBridge();
  vi.mocked(PromptHistoryManager.searchHistory).mockResolvedValue([]);

  await bridge.handleRequest("searchPromptHistory", { query: "test" });

  expect(PromptHistoryManager.searchHistory).toHaveBeenCalledWith("test", {
    workdir: undefined,
  });
});

// ── Branch coverage: PluginCore cache hit ────────────────────────

test("PluginCore is cached for same workdir", async () => {
  const { bridge } = createBridge();
  const listPlugins = vi
    .fn()
    .mockResolvedValue({ plugins: [], mergedEnabled: {} });
  mockPluginCore({ listPlugins });

  // First call creates PluginCore, second uses cache
  await bridge.handleRequest("listPlugins", { workdir: "/same/workdir" });
  await bridge.handleRequest("listPlugins", { workdir: "/same/workdir" });

  // PluginCore constructor should only be called once
  expect(PluginCore).toHaveBeenCalledTimes(1);
});

test("PluginCore uses agent workingDirectory when no workdir provided", async () => {
  const { bridge } = createBridge();
  const listPlugins = vi
    .fn()
    .mockResolvedValue({ plugins: [], mergedEnabled: {} });
  mockPluginCore({ listPlugins });

  // Initialize agent first, then call listPlugins without workdir
  const result = await bridge.handleRequest("initialize", {
    workdir: "/test/workdir",
  });
  const sessionId = (result as { sessionId: string }).sessionId;
  await bridge.handleRequest("listPlugins", {}, sessionId);

  // PluginCore should be constructed with agent's workingDirectory
  expect(PluginCore).toHaveBeenCalledWith("/test/workdir");
});

// ── Branch coverage: callback edge cases ─────────────────────────

test("onUserMessageAdded with no user messages does not emit", async () => {
  const { bridge, notifications } = createBridge();
  // Agent with no messages
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent({ messages: [] }));

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onUserMessageAdded!({} as never);

  // Should not emit userMessageAdded
  expect(
    notifications.filter((n) => n.method === "userMessageAdded"),
  ).toHaveLength(0);
});

test("onAssistantMessageAdded with unknown messageId does not emit", async () => {
  const { bridge, notifications } = createBridge();
  const messages = [
    { id: "msg-1", role: "assistant", blocks: [] },
  ] as unknown as Message[];
  vi.mocked(Agent.create).mockResolvedValue(createMockAgent({ messages }));

  await bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onAssistantMessageAdded!("nonexistent-id");

  expect(
    notifications.filter((n) => n.method === "assistantMessageAdded"),
  ).toHaveLength(0);
});

test("onUserMessageAdded before initialize does not crash", async () => {
  const { bridge, notifications } = createBridge();
  // Initialize with an agent that has no messages, then destroy agent to test undefined path
  // Actually, we need to capture callbacks before agent is created.
  // The findLastUserMessage uses this.agent?.messages which is undefined before init.
  // We can't easily get callbacks without calling initialize, but we can test
  // by creating a bridge and calling the callback after destroying the agent.

  const mockAgent = createMockAgent({ messages: [] });
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);

  const result = await bridge.handleRequest("initialize", {});
  const sessionId = (result as { sessionId: string }).sessionId;
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  // Destroy agent so this.agent becomes undefined
  await bridge.handleRequest("destroy", {}, sessionId);

  // Now onUserMessageAdded should handle undefined agent gracefully
  callbacks.onUserMessageAdded!({} as never);

  expect(
    notifications.filter((n) => n.method === "userMessageAdded"),
  ).toHaveLength(0);
});

test("onUserMessageAdded with no agent (pre-create) does not crash", async () => {
  const { bridge, notifications } = createBridge();
  const mockAgent = createMockAgent();
  let resolveCreate!: (agent: Agent) => void;
  vi.mocked(Agent.create).mockReturnValue(
    new Promise<Agent>((resolve) => {
      resolveCreate = resolve;
    }),
  );

  // Kick off initialize without awaiting — ctx.agent is still undefined here
  const initPromise = bridge.handleRequest("initialize", {});
  const callbacks = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;

  callbacks.onUserMessageAdded!({} as never);

  expect(
    notifications.filter((n) => n.method === "userMessageAdded"),
  ).toHaveLength(0);

  resolveCreate(mockAgent);
  await initPromise;
});

// ── Multi-session (multi-tenant) ─────────────────────────────────

test("two sessions are independent and route notifications by sessionId", async () => {
  const { bridge } = createBridge();
  const agentA = createMockAgent({ sessionId: "sess-A" });
  const agentB = createMockAgent({ sessionId: "sess-B" });
  vi.mocked(Agent.create)
    .mockResolvedValueOnce(agentA)
    .mockResolvedValueOnce(agentB);

  const initA = await bridge.handleRequest("initialize", {});
  const initB = await bridge.handleRequest("initialize", {});
  const sessionA = (initA as { sessionId: string }).sessionId;
  const sessionB = (initB as { sessionId: string }).sessionId;
  expect(sessionA).toBe("sess-A");
  expect(sessionB).toBe("sess-B");

  // Send message on each; verify each agent's sendMessage is called exactly once
  await bridge.handleRequest("sendMessage", { text: "hi-A" }, sessionA);
  await bridge.handleRequest("sendMessage", { text: "hi-B" }, sessionB);

  expect(agentA.sendMessage).toHaveBeenCalledTimes(1);
  expect(agentA.sendMessage).toHaveBeenCalledWith("hi-A", undefined);
  expect(agentB.sendMessage).toHaveBeenCalledTimes(1);
  expect(agentB.sendMessage).toHaveBeenCalledWith("hi-B", undefined);

  // Verify getMessages routes to the correct session's agent
  const msgsA = await bridge.handleRequest("getMessages", {}, sessionA);
  const msgsB = await bridge.handleRequest("getMessages", {}, sessionB);
  expect(agentA.messages).toBe((msgsA as { messages: Message[] }).messages);
  expect(agentB.messages).toBe((msgsB as { messages: Message[] }).messages);
});

test("destroying one session leaves the other intact", async () => {
  const { bridge } = createBridge();
  const agentA = createMockAgent({ sessionId: "sess-A" });
  const agentB = createMockAgent({ sessionId: "sess-B" });
  vi.mocked(Agent.create)
    .mockResolvedValueOnce(agentA)
    .mockResolvedValueOnce(agentB);

  const initA = await bridge.handleRequest("initialize", {});
  const initB = await bridge.handleRequest("initialize", {});
  const sessionA = (initA as { sessionId: string }).sessionId;
  const sessionB = (initB as { sessionId: string }).sessionId;

  // Destroy session A
  await bridge.handleRequest("destroy", {}, sessionA);
  expect(agentA.destroy).toHaveBeenCalledTimes(1);

  // Session B should still work
  const result = await bridge.handleRequest("getMessages", {}, sessionB);
  expect(result).toEqual({ messages: [] });
  expect(agentB.destroy).not.toHaveBeenCalled();
});

test("notifications route by sessionId when callbacks fire", async () => {
  const { bridge, notifications } = createBridge();
  const agentA = createMockAgent({ sessionId: "sess-A" });
  const agentB = createMockAgent({ sessionId: "sess-B" });
  vi.mocked(Agent.create)
    .mockResolvedValueOnce(agentA)
    .mockResolvedValueOnce(agentB);

  await bridge.handleRequest("initialize", {});
  await bridge.handleRequest("initialize", {});

  // Grab callbacks for each Agent.create call
  const callbacksA = vi.mocked(Agent.create).mock.calls[0][0]
    .callbacks as AgentCallbacks;
  const callbacksB = vi.mocked(Agent.create).mock.calls[1][0]
    .callbacks as AgentCallbacks;

  const paramsA = {
    messageId: "a-1",
    chunk: "A",
    accumulated: "A",
    stage: "streaming" as const,
  };
  const paramsB = {
    messageId: "b-1",
    chunk: "B",
    accumulated: "B",
    stage: "streaming" as const,
  };

  // Fire onAssistantContentUpdated for session A's callbacks
  callbacksA.onAssistantContentUpdated!(paramsA);

  // The notification emitted via session A's callbacks should carry sessionId "sess-A"
  expect(notifications).toContainEqual({
    method: "assistantContentUpdated",
    params: { messageId: "a-1", chunk: "A", stage: "streaming" },
    sessionId: "sess-A",
  });

  // Fire for session B → should carry "sess-B"
  callbacksB.onAssistantContentUpdated!(paramsB);
  expect(notifications).toContainEqual({
    method: "assistantContentUpdated",
    params: { messageId: "b-1", chunk: "B", stage: "streaming" },
    sessionId: "sess-B",
  });
});

// ── listGitBranches ────────────────────────────────────────────

test("listGitBranches returns branches and current branch", async () => {
  const { bridge } = createBridge();

  vi.mocked(execFileSync)
    // git for-each-ref
    .mockReturnValueOnce("main\ndev\nfeature-x\n")
    // git rev-parse --abbrev-ref HEAD
    .mockReturnValueOnce("dev\n");

  const result = (await bridge.handleRequest("listGitBranches", {
    workdir: "/repo",
  })) as { branches: string[]; current: string | null };

  expect(result.branches).toEqual(["main", "dev", "feature-x"]);
  expect(result.current).toBe("dev");

  expect(execFileSync).toHaveBeenCalledWith(
    "git",
    ["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    expect.objectContaining({ cwd: "/repo" }),
  );
  expect(execFileSync).toHaveBeenCalledWith(
    "git",
    ["rev-parse", "--abbrev-ref", "HEAD"],
    expect.objectContaining({ cwd: "/repo" }),
  );
});

test("listGitBranches throws when workdir is missing", async () => {
  const { bridge } = createBridge();
  await expect(bridge.handleRequest("listGitBranches", {})).rejects.toThrow(
    "workdir is required",
  );
});

test("listGitBranches throws when not a git repo", async () => {
  const { bridge } = createBridge();
  vi.mocked(execFileSync).mockImplementation(() => {
    throw new Error("not a git repository");
  });

  await expect(
    bridge.handleRequest("listGitBranches", { workdir: "/not-a-repo" }),
  ).rejects.toThrow("Not a git repository");
});

test("listGitBranches returns null current on detached HEAD", async () => {
  const { bridge } = createBridge();
  vi.mocked(execFileSync)
    .mockReturnValueOnce("main\n")
    .mockReturnValueOnce("HEAD\n");

  const result = (await bridge.handleRequest("listGitBranches", {
    workdir: "/repo",
  })) as { branches: string[]; current: string | null };

  expect(result.current).toBeNull();
});

test("listGitBranches returns null current when rev-parse fails", async () => {
  const { bridge } = createBridge();
  vi.mocked(execFileSync)
    .mockReturnValueOnce("main\n")
    .mockImplementationOnce(() => {
      throw new Error("rev-parse failed");
    });

  const result = (await bridge.handleRequest("listGitBranches", {
    workdir: "/repo",
  })) as { branches: string[]; current: string | null };

  expect(result.branches).toEqual(["main"]);
  expect(result.current).toBeNull();
});

test("listGitBranches returns an empty list when the repo has no refs", async () => {
  const { bridge } = createBridge();
  vi.mocked(execFileSync).mockReturnValueOnce("").mockReturnValueOnce("main\n");

  const result = (await bridge.handleRequest("listGitBranches", {
    workdir: "/repo",
  })) as { branches: string[]; current: string | null };

  expect(result.branches).toEqual([]);
  expect(result.current).toBe("main");
});

// ── createWorktree ─────────────────────────────────────────────

test("createWorktree creates worktree with default name", async () => {
  const { bridge } = createBridge();

  vi.mocked(generateRandomName).mockReturnValue("random-name");
  vi.mocked(createWorktree).mockResolvedValue({
    name: "random-name",
    path: "/repo/.wave/worktrees/random-name",
    branch: "worktree-random-name",
    repoRoot: "/repo",
    hasUncommittedChanges: false,
    hasNewCommits: false,
    isNew: true,
  });
  vi.mocked(getDefaultRemoteBranch).mockReturnValue("origin/main");

  const result = (await bridge.handleRequest("createWorktree", {
    workdir: "/repo",
    baseBranch: "origin/main",
  })) as {
    name: string;
    path: string;
    branch: string;
    repoRoot: string;
    baseBranch: string;
    isNew: boolean;
  };

  expect(result.name).toBe("random-name");
  expect(result.path).toBe("/repo/.wave/worktrees/random-name");
  expect(result.branch).toBe("worktree-random-name");
  expect(result.repoRoot).toBe("/repo");
  expect(result.baseBranch).toBe("origin/main");
  expect(result.isNew).toBe(true);

  expect(createWorktree).toHaveBeenCalledWith("random-name", "/repo", {
    baseBranch: "origin/main",
  });
});

test("createWorktree uses caller-provided name", async () => {
  const { bridge } = createBridge();

  vi.mocked(createWorktree).mockResolvedValue({
    name: "custom",
    path: "/repo/.wave/worktrees/custom",
    branch: "worktree-custom",
    repoRoot: "/repo",
    hasUncommittedChanges: false,
    hasNewCommits: false,
    isNew: true,
  });

  const result = (await bridge.handleRequest("createWorktree", {
    workdir: "/repo",
    name: "custom",
  })) as { name: string };

  expect(result.name).toBe("custom");
  expect(createWorktree).toHaveBeenCalledWith("custom", "/repo", {
    baseBranch: undefined,
  });
});

test("createWorktree trims whitespace from name", async () => {
  const { bridge } = createBridge();

  vi.mocked(createWorktree).mockResolvedValue({
    name: "trimmed",
    path: "/repo/.wave/worktrees/trimmed",
    branch: "worktree-trimmed",
    repoRoot: "/repo",
    hasUncommittedChanges: false,
    hasNewCommits: false,
    isNew: true,
  });

  await bridge.handleRequest("createWorktree", {
    workdir: "/repo",
    name: "  trimmed  ",
  });

  expect(createWorktree).toHaveBeenCalledWith("trimmed", "/repo", {
    baseBranch: undefined,
  });
});

test("createWorktree falls back to generateRandomName on empty name", async () => {
  const { bridge } = createBridge();

  vi.mocked(generateRandomName).mockReturnValue("fallback-name");
  vi.mocked(createWorktree).mockResolvedValue({
    name: "fallback-name",
    path: "/repo/.wave/worktrees/fallback-name",
    branch: "worktree-fallback-name",
    repoRoot: "/repo",
    hasUncommittedChanges: false,
    hasNewCommits: false,
    isNew: true,
  });

  await bridge.handleRequest("createWorktree", {
    workdir: "/repo",
    name: "   ",
  });

  expect(generateRandomName).toHaveBeenCalled();
});

test("createWorktree throws when workdir is missing", async () => {
  const { bridge } = createBridge();
  await expect(bridge.handleRequest("createWorktree", {})).rejects.toThrow(
    "workdir is required",
  );
});

test("createWorktree wraps createWorktree errors in RpcError", async () => {
  const { bridge } = createBridge();

  vi.mocked(generateRandomName).mockReturnValue("fail-name");
  vi.mocked(createWorktree).mockRejectedValue(
    new Error("git worktree add failed"),
  );

  await expect(
    bridge.handleRequest("createWorktree", { workdir: "/repo" }),
  ).rejects.toThrow("git worktree add failed");
});

// ── removeWorktree ─────────────────────────────────────────────

test("removeWorktree calls removeWorktree with correct session", async () => {
  const { bridge } = createBridge();

  const result = (await bridge.handleRequest("removeWorktree", {
    path: "/repo/.wave/worktrees/feat",
    branch: "worktree-feat",
    repoRoot: "/repo",
  })) as { ok: true };

  expect(result.ok).toBe(true);
  expect(removeWorktree).toHaveBeenCalledWith({
    name: "",
    path: "/repo/.wave/worktrees/feat",
    branch: "worktree-feat",
    repoRoot: "/repo",
    hasUncommittedChanges: false,
    hasNewCommits: false,
    isNew: false,
  });
});

test("removeWorktree delegates to removeWorktree (best-effort)", async () => {
  const { bridge } = createBridge();

  // removeWorktree is mocked as a no-op (success). The real implementation
  // catches its own errors internally and never throws.
  const result = (await bridge.handleRequest("removeWorktree", {
    path: "/nonexistent",
    branch: "gone",
    repoRoot: "/repo",
  })) as { ok: true };

  expect(result.ok).toBe(true);
  expect(removeWorktree).toHaveBeenCalledTimes(1);
});

test("removeWorktree rejects paths that fail validation", async () => {
  const { bridge } = createBridge();
  vi.mocked(validateWorktreeRemovalPath).mockImplementationOnce(() => {
    throw new Error(
      "Refusing to remove worktree outside repo root: /etc/passwd",
    );
  });

  await expect(
    bridge.handleRequest("removeWorktree", {
      path: "/etc/passwd",
      branch: "worktree-feat",
      repoRoot: "/repo",
    }),
  ).rejects.toThrow("Refusing to remove worktree outside repo root");
  expect(removeWorktree).not.toHaveBeenCalled();
});

test("removeWorktree triggers WorktreeRemove hook for the session in that worktree", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent({
    workingDirectory: "/repo/.wave/worktrees/feat",
  });
  mockAgent.triggerWorktreeRemoveHook = vi.fn().mockResolvedValue(undefined);
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);
  await bridge.handleRequest("initialize", {
    workdir: "/repo/.wave/worktrees/feat",
  });

  const result = (await bridge.handleRequest("removeWorktree", {
    path: "/repo/.wave/worktrees/feat",
    branch: "worktree-feat",
    repoRoot: "/repo",
  })) as { ok: true };

  expect(result.ok).toBe(true);
  expect(mockAgent.triggerWorktreeRemoveHook).toHaveBeenCalledWith(
    "/repo/.wave/worktrees/feat",
  );
  expect(removeWorktree).toHaveBeenCalledTimes(1);
});

test("removeWorktree skips the hook when no session runs in that worktree", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent({ workingDirectory: "/other/dir" });
  mockAgent.triggerWorktreeRemoveHook = vi.fn().mockResolvedValue(undefined);
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);
  await bridge.handleRequest("initialize", { workdir: "/other/dir" });

  const result = (await bridge.handleRequest("removeWorktree", {
    path: "/repo/.wave/worktrees/feat",
    branch: "worktree-feat",
    repoRoot: "/repo",
  })) as { ok: true };

  expect(result.ok).toBe(true);
  expect(mockAgent.triggerWorktreeRemoveHook).not.toHaveBeenCalled();
  expect(removeWorktree).toHaveBeenCalledTimes(1);
});

test("removeWorktree hook failure does not block git removal", async () => {
  const { bridge } = createBridge();
  const mockAgent = createMockAgent({
    workingDirectory: "/repo/.wave/worktrees/feat",
  });
  mockAgent.triggerWorktreeRemoveHook = vi
    .fn()
    .mockRejectedValue(new Error("hook failed"));
  vi.mocked(Agent.create).mockResolvedValue(mockAgent);
  await bridge.handleRequest("initialize", {
    workdir: "/repo/.wave/worktrees/feat",
  });

  const result = (await bridge.handleRequest("removeWorktree", {
    path: "/repo/.wave/worktrees/feat",
    branch: "worktree-feat",
    repoRoot: "/repo",
  })) as { ok: true };

  expect(result.ok).toBe(true);
  expect(removeWorktree).toHaveBeenCalledTimes(1);
});
