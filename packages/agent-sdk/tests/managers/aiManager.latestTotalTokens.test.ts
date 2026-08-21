import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type {
  GatewayConfig,
  ModelConfig,
  Usage,
  Message,
} from "../../src/types/index.js";
import * as aiService from "../../src/services/aiService.js";

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

describe("AIManager - latestTotalTokens calculation", () => {
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
    } as unknown as ToolManager;

    // Create mock Logger

    // Mock ConfigurationService
    const mockConfigurationService = {
      setOptions: vi.fn(),
      resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
      resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
      resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
      resolveLanguage: vi.fn().mockReturnValue(undefined),
      getEnvironmentVars: vi.fn().mockReturnValue({}),
    };

    const container = new Container();
    container.register("ConfigurationService", mockConfigurationService);
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

    it("should ignore cache_read_input_tokens in latestTotalTokens calculation", async () => {
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

      // Verify setlatestTotalTokens was called with total_tokens only (cache excluded)
      // Expected: 150 (25 cache_read ignored)
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(150);
    });

    it("should ignore cache_creation_input_tokens in latestTotalTokens calculation", async () => {
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

      // Verify setlatestTotalTokens was called with total_tokens only (cache excluded)
      // Expected: 150 (30 cache_creation ignored)
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(150);
    });

    it("should ignore both cache token types in latestTotalTokens calculation", async () => {
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

      // Verify setlatestTotalTokens was called with total_tokens only (cache excluded)
      // Expected: 150 (25 + 30 cache ignored)
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(150);
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

    it("should ignore large cache token values in latestTotalTokens calculation", async () => {
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

      // Verify setlatestTotalTokens was called with total_tokens only (large cache ignored)
      // Expected: 1500 (2000 + 3000 cache ignored)
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(
        1500,
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

    it("should calculate latestTotalTokens correctly during compaction operations", async () => {
      const usage: Usage = {
        prompt_tokens: 100000, // Large value to trigger compaction
        completion_tokens: 50000,
        total_tokens: 150000, // This will exceed the token limit of 96000
        cache_read_input_tokens: 5000,
        cache_creation_input_tokens: 7000,
        model: "test-model",
        operation_type: "agent",
      };

      // Mock getMessages to return messages for compaction
      vi.mocked(mockMessageManager.getMessages).mockReturnValue([
        {
          role: "user",
          blocks: [{ type: "text", content: "test" }],
        },
      ] as unknown as Message[]);

      // Mock callAgent to return usage that triggers compaction
      vi.mocked(aiService.callAgent).mockResolvedValue({
        content: "Test response",
        usage,
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      // Verify setlatestTotalTokens was called with total_tokens only (cache excluded)
      // Expected: 150000 (5000 + 7000 cache ignored)
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(
        150000,
      );
    });
  });

  describe("edge cases for latestTotalTokens calculation", () => {
    it("should ignore fractional cache token values in latestTotalTokens calculation", async () => {
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

      // Expected: 150 (fractional cache values ignored)
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(150);
    });

    it("should ignore negative cache token values (edge case)", async () => {
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

      // Expected: 150 (negative/positive cache values ignored)
      expect(mockMessageManager.setlatestTotalTokens).toHaveBeenCalledWith(150);
    });
  });
});
