import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";

import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { ChatCompletionMessageToolCall } from "openai/resources";

// Mock the aiService module
vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn(),
  compactMessages: vi.fn(),
}));

// Mock the memory service
vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/utils/messageOperations.js", () => ({}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

describe("AIManager finish reason", () => {
  let aiManager: AIManager;
  let mockMessageManager: MessageManager;
  let mockToolManager: ToolManager;

  const mockGatewayConfig: GatewayConfig = {
    apiKey: "test-api-key",
    baseURL: "https://test-gateway.com",
  };

  const mockModelConfig: ModelConfig = {
    model: "test-agent-model",
    fastModel: "test-fast-model",
  };

  beforeEach(async () => {
    // Create mock MessageManager
    mockMessageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session-id"),
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
      finalizeStreamingBlocks: vi.fn(),
      finalizeAbortedToolBlocks: vi.fn(),
    } as unknown as MessageManager;

    // Create mock ToolManager
    mockToolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
      execute: vi
        .fn()
        .mockResolvedValue({ success: true, content: "test result" }),
      isConcurrencySafe: vi.fn().mockReturnValue(true),
    } as unknown as ToolManager;

    // Create mock Logger

    const container = new Container();
    container.register("ConfigurationService", {
      resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
      resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
      resolveLanguage: vi.fn().mockReturnValue(undefined),
    });
    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("TaskManager", {} as unknown as TaskManager);
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
      ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
      getAutoMemoryContent: vi.fn().mockResolvedValue(""),
    });
    container.register("PermissionManager", {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
      clearTemporaryRules: vi.fn(),
      getPlanFilePath: vi.fn().mockReturnValue(undefined),
      setHasExitedPlanMode: vi.fn(),
      hasExitedPlanModeInSession: vi.fn(() => false),
      setNeedsPlanModeExitAttachment: vi.fn(),
      getNeedsPlanModeExitAttachment: vi.fn(() => false),
    } as unknown as Record<string, unknown>);

    // Mock SubagentManager and register it
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
    });

    // Mock SkillManager and register it
    container.register("SkillManager", {
      getAvailableSkills: vi.fn().mockReturnValue([]),
    });

    // Create AIManager instance
    aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
    });

    // Clear mocks
    const { callAgent } = await import("../../src/services/aiService.js");
    vi.mocked(callAgent).mockClear();
  });

  it("should add a user message and recurse when finish reason is length and no tools are called", async () => {
    const { callAgent } = await import("../../src/services/aiService.js");
    vi.mocked(callAgent)
      .mockResolvedValueOnce({
        content: "Truncated response...",
        finish_reason: "length",
        tool_calls: [],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      })
      .mockResolvedValueOnce({
        content: "Final response",
        finish_reason: "stop",
        tool_calls: [],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 5,
          total_tokens: 10,
        },
      });

    await aiManager.sendAIMessage();

    expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Output token limit hit"),
        isMeta: true,
      }),
    );
    expect(callAgent).toHaveBeenCalledTimes(2);
  });

  it("should NOT add a user message but still recurse when finish reason is length and tools ARE called", async () => {
    const { callAgent } = await import("../../src/services/aiService.js");
    // First call returns tool calls, second call returns stop to prevent infinite recursion
    vi.mocked(callAgent)
      .mockResolvedValueOnce({
        content: "Truncated response...",
        finish_reason: "length",
        tool_calls: [
          {
            id: "tool-1",
            type: "function",
            function: {
              name: "test_tool",
              arguments: '{"arg": "val"}',
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      })
      .mockResolvedValueOnce({
        content: "Final response",
        finish_reason: "stop",
        tool_calls: [],
        usage: {
          prompt_tokens: 5,
          completion_tokens: 5,
          total_tokens: 10,
        },
      });

    await aiManager.sendAIMessage();

    // It should still call addUserMessage with isMeta: true
    expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("Output token limit hit"),
        isMeta: true,
      }),
    );
    expect(callAgent).toHaveBeenCalledTimes(2);
  });

  it("should NOT add an error block when finish reason is stop", async () => {
    const { callAgent } = await import("../../src/services/aiService.js");
    vi.mocked(callAgent).mockResolvedValue({
      content: "Normal response",
      finish_reason: "stop",
      tool_calls: [],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });

    await aiManager.sendAIMessage();

    expect(mockMessageManager.addErrorBlock).not.toHaveBeenCalled();
  });

  it("should stop with an error block after 3 consecutive truncations with no tool calls", async () => {
    const { callAgent } = await import("../../src/services/aiService.js");
    const truncated = (
      content: string,
    ): Awaited<ReturnType<typeof callAgent>> => ({
      content,
      finish_reason: "length",
      tool_calls: [],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });
    // 1st-3rd truncations recover (count 1→3), 4th truncation exhausts the
    // limit — no 5th call should happen.
    vi.mocked(callAgent)
      .mockResolvedValueOnce(truncated("truncated 1"))
      .mockResolvedValueOnce(truncated("truncated 2"))
      .mockResolvedValueOnce(truncated("truncated 3"))
      .mockResolvedValueOnce(truncated("truncated 4"));

    await aiManager.sendAIMessage();

    expect(callAgent).toHaveBeenCalledTimes(4);
    // First 3 truncations got the hidden recovery message, the 4th did not.
    const resumeCalls = vi
      .mocked(mockMessageManager.addUserMessage)
      .mock.calls.filter(
        ([params]) =>
          typeof params?.content === "string" &&
          params.content.includes("Output token limit hit"),
      );
    expect(resumeCalls).toHaveLength(3);
    expect(mockMessageManager.addErrorBlock).toHaveBeenCalledTimes(1);
    expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
      expect.stringContaining("output token limit"),
    );
  });

  it("should reset the consecutive recovery counter when a truncated turn includes tool calls", async () => {
    const { callAgent } = await import("../../src/services/aiService.js");
    const truncated = (
      content: string,
      tool_calls: ChatCompletionMessageToolCall[] = [],
    ): Awaited<ReturnType<typeof callAgent>> => ({
      content,
      finish_reason: "length",
      tool_calls,
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });
    const toolCall: ChatCompletionMessageToolCall = {
      id: "tool-1",
      type: "function",
      function: { name: "test_tool", arguments: '{"arg": "val"}' },
    };
    // t1: count 1 · t2: tool call resets to 0 · t3-t5: count 1→3 ·
    // t6: 4th pure truncation → exhaustion. Without the reset, exhaustion
    // would hit at t4 (only 4 calls total).
    vi.mocked(callAgent)
      .mockResolvedValueOnce(truncated("truncated 1"))
      .mockResolvedValueOnce(truncated("truncated 2", [toolCall]))
      .mockResolvedValueOnce(truncated("truncated 3"))
      .mockResolvedValueOnce(truncated("truncated 4"))
      .mockResolvedValueOnce(truncated("truncated 5"))
      .mockResolvedValueOnce(truncated("truncated 6"));

    await aiManager.sendAIMessage();

    expect(callAgent).toHaveBeenCalledTimes(6);
    expect(mockMessageManager.addErrorBlock).toHaveBeenCalledTimes(1);
    expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
      expect.stringContaining("output token limit"),
    );
  });
});
