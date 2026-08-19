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
  callAgent: vi.fn().mockImplementation(async () => ({
    content: "ok",
    usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
    tool_calls: [],
    finish_reason: "stop",
  })),
  compactMessages: vi.fn().mockResolvedValue({
    content: "Compacted",
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
  transformMessagesForExplicitCache: vi.fn((m) => m),
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
    getMemoryForInjection: vi.fn().mockResolvedValue({ prependContent: "" }),
    processTriggeredRules: vi.fn().mockReturnValue([]),
    addErrorBlock: vi.fn(),
    setlatestTotalTokens: vi.fn(),
    saveSession: vi.fn().mockResolvedValue(undefined),
    compactMessagesAndUpdateSession: vi.fn(),
    getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.md"),
    triggerFileRead: vi.fn(),
    finalizeStreamingBlocks: vi.fn(),
    finalizeAbortedToolBlocks: vi.fn(),
    addFileHistoryBlock: vi.fn(),
    updateCurrentMessageReasoning: vi.fn(),
    ...overrides,
  } as unknown as MessageManager;
}

function makeContainer(
  overrides: Record<string, unknown> = {},
  maxInputTokens = 96000,
) {
  const c = new Container();
  c.register("ConfigurationService", {
    resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
    resolveMaxInputTokens: vi.fn().mockReturnValue(maxInputTokens),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
    resolveLanguage: vi.fn().mockReturnValue(undefined),
    getEnvironmentVars: vi.fn().mockReturnValue({}),
  });
  c.register("MessageManager", mockMsgManager());
  c.register("ToolManager", {
    getToolsConfig: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
    isConcurrencySafe: vi.fn().mockReturnValue(true),
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
    setHasExitedPlanMode: vi.fn(),
    hasExitedPlanModeInSession: vi.fn(() => false),
    setNeedsPlanModeExitAttachment: vi.fn(),
    getNeedsPlanModeExitAttachment: vi.fn(() => false),
  });
  c.register("SubagentManager", {
    getConfigurations: vi.fn().mockReturnValue([]),
  });
  c.register("SkillManager", {
    getAvailableSkills: vi.fn().mockReturnValue([]),
  });
  c.register("MessageQueue", {
    hasNotifications: vi.fn().mockReturnValue(false),
    drainNotifications: vi.fn().mockReturnValue([]),
  });
  c.register("ReversionManager", null);
  c.register("HookManager", null);
  Object.entries(overrides).forEach(([k, v]) => c.register(k, v));
  return c;
}

describe("AIManager - pre-request auto compaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should compact BEFORE the request when the estimated context exceeds maxInputTokens", async () => {
    // Anchor usage total = 1500, plus a large tool result message after it.
    const messages = [
      {
        role: "user",
        blocks: [{ type: "text", content: "hello" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "hi" }],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
        },
      },
      {
        role: "user",
        blocks: [
          {
            type: "tool",
            name: "Read",
            stage: "end",
            result: "x".repeat(10000),
          },
        ],
      },
    ];
    const aiManager = new AIManager(
      makeContainer(
        {
          MessageManager: mockMsgManager({
            getMessages: vi.fn().mockReturnValue(messages),
          }),
        },
        2000, // maxInputTokens: 1500 anchor + ~2500 estimated tool result > 2000
      ),
      { workdir: "/test", stream: false },
    );
    const compactSpy = vi
      .spyOn(aiManager, "compactConversation")
      .mockResolvedValue(undefined);

    await aiManager.sendAIMessage();

    expect(compactSpy).toHaveBeenCalledTimes(1);
    // Compaction decision happens pre-request: it must fire before callAgent.
    expect(compactSpy.mock.invocationCallOrder[0]).toBeLessThan(
      (aiService.callAgent as ReturnType<typeof vi.fn>).mock
        .invocationCallOrder[0],
    );
  });

  it("should NOT compact when the estimated context is under maxInputTokens", async () => {
    const messages = [
      {
        role: "user",
        blocks: [{ type: "text", content: "hello" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "hi" }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      },
    ];
    const aiManager = new AIManager(
      makeContainer(
        {
          MessageManager: mockMsgManager({
            getMessages: vi.fn().mockReturnValue(messages),
          }),
        },
        2000,
      ),
      { workdir: "/test", stream: false },
    );
    const compactSpy = vi
      .spyOn(aiManager, "compactConversation")
      .mockResolvedValue(undefined);

    await aiManager.sendAIMessage();

    expect(compactSpy).not.toHaveBeenCalled();
  });

  it("should ignore cache fields — large cache_read with small total_tokens must NOT trigger", async () => {
    // Under the old formula (total + cache_read) this would fire (150 + 100000
    // > 2000). With total_tokens-only semantics it must not.
    const messages = [
      {
        role: "user",
        blocks: [{ type: "text", content: "hello" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "hi" }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          cache_read_input_tokens: 100000,
          cache_creation_input_tokens: 100000,
        },
      },
    ];
    const aiManager = new AIManager(
      makeContainer(
        {
          MessageManager: mockMsgManager({
            getMessages: vi.fn().mockReturnValue(messages),
          }),
        },
        2000,
      ),
      { workdir: "/test", stream: false },
    );
    const compactSpy = vi
      .spyOn(aiManager, "compactConversation")
      .mockResolvedValue(undefined);

    await aiManager.sendAIMessage();

    expect(compactSpy).not.toHaveBeenCalled();
  });

  it("should compact on the first request (no usage anchor) when the pure character estimate exceeds the limit", async () => {
    // No usage on any message: estimateContextTokens falls back to a pure
    // character estimate of all messages (~500 tokens for 2000 chars).
    const messages = [
      {
        role: "user",
        blocks: [{ type: "text", content: "a".repeat(2000) }],
      },
    ];
    const aiManager = new AIManager(
      makeContainer(
        {
          MessageManager: mockMsgManager({
            getMessages: vi.fn().mockReturnValue(messages),
          }),
        },
        300,
      ),
      { workdir: "/test", stream: false },
    );
    const compactSpy = vi
      .spyOn(aiManager, "compactConversation")
      .mockResolvedValue(undefined);

    await aiManager.sendAIMessage();

    expect(compactSpy).toHaveBeenCalledTimes(1);
  });

  it("should skip compaction when the circuit breaker has 3 consecutive failures", async () => {
    const messages = [
      {
        role: "user",
        blocks: [{ type: "text", content: "hello" }],
      },
      {
        role: "assistant",
        blocks: [{ type: "text", content: "hi" }],
        usage: {
          prompt_tokens: 1000,
          completion_tokens: 500,
          total_tokens: 1500,
        },
      },
    ];
    const aiManager = new AIManager(
      makeContainer(
        {
          MessageManager: mockMsgManager({
            getMessages: vi.fn().mockReturnValue(messages),
          }),
        },
        1000,
      ),
      { workdir: "/test", stream: false },
    );
    const compactSpy = vi
      .spyOn(aiManager, "compactConversation")
      .mockResolvedValue(undefined);
    (
      aiManager as unknown as { consecutiveCompactionFailures: number }
    ).consecutiveCompactionFailures = 3;

    await aiManager.sendAIMessage();

    expect(compactSpy).not.toHaveBeenCalled();
  });

  it("should re-check before every request in the loop (tool calls grow the context)", async () => {
    // Before the tool executes: small context (no compaction). After the tool
    // result lands: large context — the next request must compact first.
    const smallMessages = [
      {
        role: "assistant",
        blocks: [{ type: "text", content: "hi" }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      },
    ];
    const largeMessages = [
      ...smallMessages,
      {
        role: "user",
        blocks: [
          {
            type: "tool",
            name: "Read",
            stage: "end",
            result: "x".repeat(20000),
          },
        ],
      },
    ];
    let hasToolResult = false;
    const getMessages = vi
      .fn()
      .mockImplementation(() =>
        hasToolResult ? largeMessages : smallMessages,
      );
    const mm = mockMsgManager({ getMessages });
    const aiManager = new AIManager(
      makeContainer(
        {
          MessageManager: mm,
          ToolManager: {
            getToolsConfig: vi.fn().mockReturnValue([]),
            getTools: vi.fn().mockReturnValue([]),
            list: vi.fn().mockReturnValue([]),
            isConcurrencySafe: vi.fn().mockReturnValue(true),
            // Flipping the flag here simulates the tool result being added to
            // the conversation history by executeToolCall.
            execute: vi.fn().mockImplementation(async () => {
              hasToolResult = true;
              return { success: true, content: "result" };
            }),
          },
        },
        300,
      ),
      { workdir: "/test", stream: false },
    );
    const compactSpy = vi
      .spyOn(aiManager, "compactConversation")
      .mockResolvedValue(undefined);
    // First response makes a tool call so the loop iterates again.
    (aiService.callAgent as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      content: "",
      usage: { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 },
      tool_calls: [
        {
          id: "t1",
          type: "function" as const,
          function: { name: "Read", arguments: "{}" },
        },
      ],
      finish_reason: "tool_calls",
    });

    await aiManager.sendAIMessage();

    // Tool call round: no compaction; second round (after tool result): compacts.
    expect(compactSpy).toHaveBeenCalledTimes(1);
    expect(aiService.callAgent).toHaveBeenCalledTimes(2);
  });
});
