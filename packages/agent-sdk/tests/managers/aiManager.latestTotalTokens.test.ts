import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type {
  Logger,
  GatewayConfig,
  ModelConfig,
  Usage,
} from "../../src/types/index.js";
import * as aiService from "../../src/services/aiService.js";

// Mock the aiService module
vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn(),
  compressMessages: vi.fn(),
}));

// Mock the memory service
vi.mock("../../src/services/memory.js", () => ({
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

// Mock utility modules
vi.mock("../../src/utils/messageOperations.js", () => ({
  getMessagesToCompress: vi
    .fn()
    .mockReturnValue({ messagesToCompress: [], insertIndex: 0 }),
}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

describe("AIManager - latestTotalTokens calculation", () => {
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
      mergeAssistantMetadata: vi.fn(),
      setMessages: vi.fn(),
      addErrorBlock: vi.fn(),
      setlatestTotalTokens: vi.fn(),
      saveSession: vi.fn().mockResolvedValue(undefined),
      compressMessagesAndUpdateSession: vi.fn(),
      getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.md"),
    } as unknown as MessageManager;

    // Create mock ToolManager
    mockToolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
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
      logger: mockLogger,
      workdir: "/test/workdir",
      getGatewayConfig: () => mockGatewayConfig,
      getModelConfig: () => mockModelConfig,
      getTokenLimit: () => 96000,
    });
  });

  describe("latestTotalTokens calculation with different cache token scenarios", () => {
    it("should calculate latestTotalTokens with basic usage (total_tokens only)", async () => {
      const usage: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        model: "test-model",
        operation_type: "agent",
      };

      // Mock callAgent to return usage without cache tokens
      vi.mocked(aiService.callAgent).mockResolvedValue({
        content: "Test response",
        usage,
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      // Verify setlatestTotalTokens was called with total_tokens only (150)
      // Expected: 150 + 0 + 0 = 150
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(150);
    });

    it("should include cache_read_input_tokens in latestTotalTokens calculation", async () => {
      const usage: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cache_read_input_tokens: 25,
        model: "test-model",
        operation_type: "agent",
      };

      // Mock callAgent to return usage with cache_read_input_tokens
      vi.mocked(aiService.callAgent).mockResolvedValue({
        content: "Test response",
        usage,
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      // Verify setlatestTotalTokens was called with total_tokens + cache_read_input_tokens
      // Expected: 150 + 25 + 0 = 175
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(175);
    });

    it("should include cache_creation_input_tokens in latestTotalTokens calculation", async () => {
      const usage: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cache_creation_input_tokens: 30,
        model: "test-model",
        operation_type: "agent",
      };

      // Mock callAgent to return usage with cache_creation_input_tokens
      vi.mocked(aiService.callAgent).mockResolvedValue({
        content: "Test response",
        usage,
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      // Verify setlatestTotalTokens was called with total_tokens + cache_creation_input_tokens
      // Expected: 150 + 0 + 30 = 180
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(180);
    });

    it("should include both cache token types in latestTotalTokens calculation", async () => {
      const usage: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cache_read_input_tokens: 25,
        cache_creation_input_tokens: 30,
        model: "test-model",
        operation_type: "agent",
      };

      // Mock callAgent to return usage with both cache token types
      vi.mocked(aiService.callAgent).mockResolvedValue({
        content: "Test response",
        usage,
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      // Verify setlatestTotalTokens was called with total_tokens + both cache tokens
      // Expected: 150 + 25 + 30 = 205
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(205);
    });

    it("should default undefined cache fields to 0 in latestTotalTokens calculation", async () => {
      const usage: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        // Explicitly setting undefined to test the || 0 logic
        cache_read_input_tokens: undefined,
        cache_creation_input_tokens: undefined,
        model: "test-model",
        operation_type: "agent",
      };

      // Mock callAgent to return usage with undefined cache token fields
      vi.mocked(aiService.callAgent).mockResolvedValue({
        content: "Test response",
        usage,
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      // Verify setlatestTotalTokens was called with total_tokens only (undefined fields defaulted to 0)
      // Expected: 150 + 0 + 0 = 150
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(150);
    });

    it("should handle zero cache token values correctly", async () => {
      const usage: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        model: "test-model",
        operation_type: "agent",
      };

      // Mock callAgent to return usage with zero cache token values
      vi.mocked(aiService.callAgent).mockResolvedValue({
        content: "Test response",
        usage,
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      // Verify setlatestTotalTokens was called with total_tokens only (zeros remain zeros)
      // Expected: 150 + 0 + 0 = 150
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(150);
    });

    it("should handle large cache token values correctly", async () => {
      const usage: Usage = {
        prompt_tokens: 1000,
        completion_tokens: 500,
        total_tokens: 1500,
        cache_read_input_tokens: 2000,
        cache_creation_input_tokens: 3000,
        model: "test-model",
        operation_type: "agent",
      };

      // Mock callAgent to return usage with large cache token values
      vi.mocked(aiService.callAgent).mockResolvedValue({
        content: "Test response",
        usage,
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      // Verify setlatestTotalTokens was called with correct sum of large values
      // Expected: 1500 + 2000 + 3000 = 6500
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(
        6500,
      );
    });

    it("should not call setlatestTotalTokens when usage is undefined", async () => {
      // Mock callAgent to return no usage information
      vi.mocked(aiService.callAgent).mockResolvedValue({
        content: "Test response",
        usage: undefined,
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      // Verify setlatestTotalTokens was not called when usage is undefined
      expect(mockMessageManager.setlatestTotalTokens).not.toHaveBeenCalled();
    });

    it("should calculate latestTotalTokens correctly during compression operations", async () => {
      const usage: Usage = {
        prompt_tokens: 100000, // Large value to trigger compression
        completion_tokens: 50000,
        total_tokens: 150000, // This will exceed the token limit of 96000
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 7000,
        model: "test-model",
        operation_type: "agent",
      };

      // Mock getMessagesToCompress to return messages for compression
      const { getMessagesToCompress } = await import(
        "../../src/utils/messageOperations.js"
      );
      vi.mocked(getMessagesToCompress).mockReturnValue({
        messagesToCompress: [
          {
            role: "user",
            blocks: [{ type: "text", content: "test" }],
          },
        ] as unknown as Awaited<
          ReturnType<typeof getMessagesToCompress>
        >["messagesToCompress"],
        insertIndex: 0,
      });

      // Mock compressMessages to return successful compression
      vi.mocked(aiService.compressMessages).mockResolvedValue({
        content: "Compressed content",
        usage: {
          prompt_tokens: 50,
          completion_tokens: 25,
          total_tokens: 75,
        },
      });

      // Mock callAgent to return usage that triggers compression
      vi.mocked(aiService.callAgent).mockResolvedValue({
        content: "Test response",
        usage,
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      // Verify setlatestTotalTokens was called with comprehensive total including cache tokens
      // Expected: 150000 + 5000 + 7000 = 162000
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(
        162000,
      );
    });
  });

  describe("edge cases for latestTotalTokens calculation", () => {
    it("should handle fractional cache token values by truncating to integers", async () => {
      const usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cache_read_input_tokens: 25.7, // Fractional value
        cache_creation_input_tokens: 30.3, // Fractional value
        model: "test-model",
        operation_type: "agent" as const,
      };

      // Mock callAgent to return usage with fractional cache token values
      vi.mocked(aiService.callAgent).mockResolvedValue({
        content: "Test response",
        usage,
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      // JavaScript addition will preserve decimals, so we expect the exact sum
      // Expected: 150 + 25.7 + 30.3 = 206
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(206);
    });

    it("should handle negative cache token values (edge case)", async () => {
      const usage: Usage = {
        prompt_tokens: 100,
        completion_tokens: 50,
        total_tokens: 150,
        cache_read_input_tokens: -10, // Negative value (unusual but possible edge case)
        cache_creation_input_tokens: 30,
        model: "test-model",
        operation_type: "agent",
      };

      // Mock callAgent to return usage with negative cache token value
      vi.mocked(aiService.callAgent).mockResolvedValue({
        content: "Test response",
        usage,
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      // Verify setlatestTotalTokens handles negative values correctly
      // Expected: 150 + (-10) + 30 = 170
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(170);
    });
  });
});
