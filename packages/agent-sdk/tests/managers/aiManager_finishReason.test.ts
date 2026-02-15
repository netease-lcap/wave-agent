import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type {
  Logger,
  GatewayConfig,
  ModelConfig,
} from "../../src/types/index.js";

// Mock the aiService module
vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn(),
  compressMessages: vi.fn(),
}));

// Mock the memory service
vi.mock("../../src/services/memory.js", () => ({
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
  let mockLogger: Logger;

  const mockGatewayConfig: GatewayConfig = {
    apiKey: "test-api-key",
    baseURL: "https://test-gateway.com",
  };

  const mockModelConfig: ModelConfig = {
    agentModel: "test-agent-model",
    fastModel: "test-fast-model",
  };

  beforeEach(() => {
    // Create mock MessageManager
    mockMessageManager = {
      getSessionId: vi.fn().mockReturnValue("test-session-id"),
      getMessages: vi.fn().mockReturnValue([]),
      addAssistantMessage: vi.fn(),
      updateCurrentMessageContent: vi.fn(),
      updateToolBlock: vi.fn(),
      mergeAssistantAdditionalFields: vi.fn(),
      setMessages: vi.fn(),
      getlatestTotalTokens: vi.fn().mockReturnValue(0),
      getCombinedMemory: vi.fn().mockResolvedValue(""),
      addErrorBlock: vi.fn(),
      setlatestTotalTokens: vi.fn(),
      saveSession: vi.fn().mockResolvedValue(undefined),
      compressMessagesAndUpdateSession: vi.fn(),
      getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.md"),
    } as unknown as MessageManager;

    // Create mock ToolManager
    mockToolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
      execute: vi
        .fn()
        .mockResolvedValue({ success: true, content: "test result" }),
    } as unknown as ToolManager;

    // Create mock Logger
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    // Create AIManager instance
    aiManager = new AIManager({
      messageManager: mockMessageManager,
      toolManager: mockToolManager,
      taskManager: {} as unknown as TaskManager,
      logger: mockLogger,
      workdir: "/test/workdir",
      getGatewayConfig: () => mockGatewayConfig,
      getModelConfig: () => mockModelConfig,
      getMaxInputTokens: () => 96000,
      getLanguage: () => undefined,
    });
  });

  it("should add an error block when finish reason is length and no tools are called", async () => {
    const { callAgent } = await import("../../src/services/aiService.js");
    vi.mocked(callAgent).mockResolvedValue({
      content: "Truncated response...",
      finish_reason: "length",
      tool_calls: [],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });

    await aiManager.sendAIMessage();

    expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
      expect.stringContaining("truncated"),
    );
  });

  it("should NOT add an error block when finish reason is length but tools ARE called", async () => {
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

    // It should NOT call addErrorBlock directly on AIManager level
    // (The tool block itself might have an error if it fails to parse, but that's different)
    expect(mockMessageManager.addErrorBlock).not.toHaveBeenCalled();
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
});
