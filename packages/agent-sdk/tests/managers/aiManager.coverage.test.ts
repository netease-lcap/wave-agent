import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import * as aiService from "../../src/services/aiService.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn().mockImplementation(async (options) => {
    if (options.onContentUpdate) options.onContentUpdate("Test response");
    return {
      content: "Test response",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [],
      finish_reason: "stop",
    };
  }),
  compressMessages: vi.fn().mockResolvedValue({
    content: "Compressed",
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
  isClaudeModel: vi.fn().mockReturnValue(false),
  transformMessagesForClaudeCache: vi.fn((m) => m),
  addCacheControlToLastTool: vi.fn((t) => t),
  extendUsageWithCacheMetrics: vi.fn((u) => u),
}));

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

const mockGatewayConfig: GatewayConfig = {
  apiKey: "test-key",
  baseURL: "https://test.com",
};
const mockModelConfig: ModelConfig = {
  model: "test-model",
  fastModel: "test-fast",
};

function mockMsgManager(overrides = {}) {
  return {
    getSessionId: vi.fn().mockReturnValue("test-session"),
    getMessages: vi.fn().mockReturnValue([]),
    addAssistantMessage: vi.fn(),
    addUserMessage: vi.fn(),
    updateCurrentMessageContent: vi.fn(),
    updateToolBlock: vi.fn(),
    mergeAssistantAdditionalFields: vi.fn(),
    setMessages: vi.fn(),
    getLatestTotalTokens: vi.fn().mockReturnValue(0),
    getCombinedMemory: vi.fn().mockResolvedValue(""),
    addErrorBlock: vi.fn(),
    setlatestTotalTokens: vi.fn(),
    saveSession: vi.fn().mockResolvedValue(undefined),
    compressMessagesAndUpdateSession: vi.fn(),
    getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.md"),
    touchFile: vi.fn(),
    finalizeStreamingBlocks: vi.fn(),
    addFileHistoryBlock: vi.fn(),
    updateCurrentMessageReasoning: vi.fn(),
    ...overrides,
  } as unknown as MessageManager;
}

function makeContainer(overrides: Record<string, unknown> = {}) {
  const c = new Container();
  c.register("ConfigurationService", {
    resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
    resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
    resolveLanguage: vi.fn().mockReturnValue(undefined),
    getEnvironmentVars: vi.fn().mockReturnValue({}),
  });
  c.register("MessageManager", mockMsgManager());
  c.register("ToolManager", {
    getToolsConfig: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue({ success: true, content: "result" }),
  } as unknown as ToolManager);
  c.register("TaskManager", {
    on: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
  } as unknown as TaskManager);
  c.register("MemoryService", {
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  });
  c.register("PermissionManager", {
    getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
    clearTemporaryRules: vi.fn(),
    getPlanFilePath: vi.fn().mockReturnValue(undefined),
    getAllowedRules: vi.fn().mockReturnValue([]),
    getDeniedRules: vi.fn().mockReturnValue([]),
    getAdditionalDirectories: vi.fn().mockReturnValue([]),
    getSystemAdditionalDirectories: vi.fn().mockReturnValue([]),
  });
  c.register("SubagentManager", {
    getConfigurations: vi.fn().mockReturnValue([]),
  });
  c.register("SkillManager", {
    getAvailableSkills: vi.fn().mockReturnValue([]),
  });
  c.register("NotificationQueue", {
    hasPending: vi.fn().mockReturnValue(false),
    dequeueAll: vi.fn().mockReturnValue([]),
  });
  c.register("ReversionManager", null);
  c.register("HookManager", null);
  Object.entries(overrides).forEach(([k, v]) => c.register(k, v));
  return c;
}

describe("AIManager - Coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should early return when isLoading at depth 0", async () => {
    const aiManager = new AIManager(makeContainer(), {
      workdir: "/test",
      stream: false,
    });
    (aiManager as unknown as { isLoading: boolean }).isLoading = true;
    await aiManager.sendAIMessage();
    expect(aiService.callAgent).not.toHaveBeenCalled();
  });

  it("should handle reversionManager with snapshots", async () => {
    const rev = {
      getAndClearCommittedSnapshots: vi.fn().mockReturnValue(["snap"]),
    };
    const mm = mockMsgManager({
      getMessages: vi
        .fn()
        .mockReturnValue([
          { role: "assistant", blocks: [{ type: "text", content: "t" }] },
        ]),
    });
    const aiManager = new AIManager(
      makeContainer({ MessageManager: mm, ReversionManager: rev }),
      { workdir: "/test", stream: false },
    );
    await aiManager.sendAIMessage();
    expect(rev.getAndClearCommittedSnapshots).toHaveBeenCalled();
  });

  it("should handle finish_reason length", async () => {
    vi.mocked(aiService.callAgent).mockResolvedValueOnce({
      content: "truncated",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [],
      finish_reason: "length",
    });
    const aiManager = new AIManager(makeContainer(), {
      workdir: "/test",
      stream: false,
    });
    await aiManager.sendAIMessage();
  });

  it("should handle compression with messages", async () => {
    const mm = mockMsgManager({
      getMessages: vi.fn().mockReturnValue([
        { role: "user", blocks: [{ type: "text", content: "hello" }] },
        { role: "assistant", blocks: [{ type: "text", content: "hi" }] },
      ]),
    });
    const aiManager = new AIManager(makeContainer({ MessageManager: mm }), {
      workdir: "/test",
      stream: false,
    });
    await aiManager.sendAIMessage();
  });

  it("should handle compression error", async () => {
    vi.mocked(aiService.compressMessages).mockRejectedValueOnce(
      new Error("fail"),
    );
    const mm = mockMsgManager({
      getMessages: vi.fn().mockReturnValue([
        { role: "user", blocks: [{ type: "text", content: "hello" }] },
        { role: "assistant", blocks: [{ type: "text", content: "hi" }] },
      ]),
    });
    const aiManager = new AIManager(makeContainer({ MessageManager: mm }), {
      workdir: "/test",
      stream: false,
    });
    await aiManager.sendAIMessage();
  });

  it("should handle result with additionalFields and reasoning_content", async () => {
    vi.mocked(aiService.callAgent).mockResolvedValueOnce({
      content: "response",
      reasoning_content: "thinking",
      additionalFields: { extra: "data" },
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
        cache_creation_input_tokens: 5,
        cache_creation: {
          ephemeral_5m_input_tokens: 100,
          ephemeral_1h_input_tokens: 50,
        },
      },
      tool_calls: [],
      finish_reason: "stop",
    });
    const mm = mockMsgManager({
      getMessages: vi
        .fn()
        .mockReturnValue([
          { role: "assistant", blocks: [{ type: "text", content: "t" }] },
        ]),
    });
    const aiManager = new AIManager(makeContainer({ MessageManager: mm }), {
      workdir: "/test",
      stream: false,
    });
    await aiManager.sendAIMessage();
    expect(mm.mergeAssistantAdditionalFields).toHaveBeenCalled();
    expect(mm.updateCurrentMessageReasoning).toHaveBeenCalled();
  });

  it("should handle tool calls with empty arguments", async () => {
    vi.mocked(aiService.callAgent).mockResolvedValueOnce({
      content: "",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [
        {
          id: "t1",
          type: "function" as const,
          function: { name: "Read", arguments: "" },
        },
      ],
      finish_reason: "stop",
    });
    const aiManager = new AIManager(makeContainer(), {
      workdir: "/test",
      stream: false,
    });
    await aiManager.sendAIMessage();
  });

  it("should handle tool calls with malformed JSON and finish_reason length", async () => {
    vi.mocked(aiService.callAgent).mockResolvedValueOnce({
      content: "",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [
        {
          id: "t1",
          type: "function" as const,
          function: { name: "Read", arguments: "{bad" },
        },
      ],
      finish_reason: "length",
    });
    const aiManager = new AIManager(makeContainer(), {
      workdir: "/test",
      stream: false,
    });
    await aiManager.sendAIMessage();
  });

  it("should handle non-function tool calls", async () => {
    vi.mocked(aiService.callAgent).mockResolvedValueOnce({
      content: "",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [
        {
          id: "t1",
          type: "code" as never,
          function: { name: "Read", arguments: "{}" },
        },
      ],
      finish_reason: "stop",
    });
    const aiManager = new AIManager(makeContainer(), {
      workdir: "/test",
      stream: false,
    });
    await aiManager.sendAIMessage();
  });

  it("should handle tool call without function type field", async () => {
    vi.mocked(aiService.callAgent).mockResolvedValueOnce({
      content: "",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [{ id: "t1" } as never],
      finish_reason: "stop",
    });
    const aiManager = new AIManager(makeContainer(), {
      workdir: "/test",
      stream: false,
    });
    await aiManager.sendAIMessage();
  });

  it("should handle stop hook error", async () => {
    const hm = { executeHooks: vi.fn().mockRejectedValue(new Error("err")) };
    const aiManager = new AIManager(makeContainer({ HookManager: hm }), {
      workdir: "/test",
      stream: false,
    });
    await aiManager.sendAIMessage();
  });

  it("should handle user message with file mention", async () => {
    const mm = mockMsgManager({
      getMessages: vi
        .fn()
        .mockReturnValue([
          {
            role: "user",
            blocks: [{ type: "text", content: "@src/index.ts" }],
          },
        ]),
    });
    const aiManager = new AIManager(makeContainer({ MessageManager: mm }), {
      workdir: "/test",
      stream: false,
    });
    await aiManager.sendAIMessage();
    expect(mm.touchFile).toHaveBeenCalledWith("src/index.ts");
  });

  it("should handle assistant message with usage", async () => {
    vi.mocked(aiService.callAgent).mockResolvedValueOnce({
      content: "response",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [],
      finish_reason: "stop",
    });
    const mm = mockMsgManager({
      getMessages: vi
        .fn()
        .mockReturnValue([
          { role: "assistant", blocks: [{ type: "text", content: "t" }] },
        ]),
    });
    const aiManager = new AIManager(makeContainer({ MessageManager: mm }), {
      workdir: "/test",
      stream: false,
    });
    await aiManager.sendAIMessage();
  });

  it("should handle tool execution with error result", async () => {
    vi.mocked(aiService.callAgent).mockResolvedValueOnce({
      content: "",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [
        {
          id: "t1",
          type: "function" as const,
          function: { name: "Bash", arguments: '{"command":"false"}' },
        },
      ],
      finish_reason: "stop",
    });
    const tm = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
      execute: vi.fn().mockResolvedValue({ success: false, error: "exit 1" }),
    };
    const aiManager = new AIManager(
      makeContainer({ ToolManager: tm as unknown as ToolManager }),
      { workdir: "/test", stream: false },
    );
    await aiManager.sendAIMessage();
  });

  it("should handle tool execution with neither content nor error", async () => {
    vi.mocked(aiService.callAgent).mockResolvedValueOnce({
      content: "",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [
        {
          id: "t1",
          type: "function" as const,
          function: { name: "Bash", arguments: '{"command":"true"}' },
        },
      ],
      finish_reason: "stop",
    });
    const tm = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
      execute: vi.fn().mockResolvedValue({ success: true }),
    };
    const aiManager = new AIManager(
      makeContainer({ ToolManager: tm as unknown as ToolManager }),
      { workdir: "/test", stream: false },
    );
    await aiManager.sendAIMessage();
  });

  it("should handle usage callback on tool execution", async () => {
    const onUsageAdded = vi.fn();
    vi.mocked(aiService.callAgent).mockResolvedValueOnce({
      content: "",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [
        {
          id: "t1",
          type: "function" as const,
          function: { name: "Bash", arguments: '{"command":"echo hi"}' },
        },
      ],
      finish_reason: "stop",
    });
    const aiManager = new AIManager(
      makeContainer({ AgentOptions: { callbacks: { onUsageAdded } } }),
      { workdir: "/test", stream: false },
    );
    await aiManager.sendAIMessage();
  });
});
