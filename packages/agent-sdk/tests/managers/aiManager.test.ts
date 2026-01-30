import { describe, it, expect, vi, beforeEach } from "vitest";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
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

// Mock utility modules
vi.mock("../../src/utils/messageOperations.js", () => ({
  getMessagesToCompress: vi
    .fn()
    .mockReturnValue({ messagesToCompress: [], insertIndex: 0 }),
}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

describe("AIManager", () => {
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
      getMaxInputTokens: () => 96000,
      getLanguage: () => undefined,
    });
  });

  describe("Language Prompt Injection", () => {
    it("should inject language prompt when language is set", async () => {
      const { callAgent } = await import("../../src/services/aiService.js");
      vi.mocked(callAgent).mockResolvedValue({
        content: "Test response",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [],
      });

      const aiManagerWithLanguage = new AIManager({
        messageManager: mockMessageManager,
        toolManager: mockToolManager,
        logger: mockLogger,
        workdir: "/test/workdir",
        getGatewayConfig: () => mockGatewayConfig,
        getModelConfig: () => mockModelConfig,
        getMaxInputTokens: () => 96000,
        getLanguage: () => "Chinese",
      });

      await aiManagerWithLanguage.sendAIMessage();

      expect(callAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("# Language"),
        }),
      );
      expect(callAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("Always respond in Chinese"),
        }),
      );
    });

    it("should NOT inject language prompt when language is undefined", async () => {
      const { callAgent } = await import("../../src/services/aiService.js");
      vi.mocked(callAgent).mockResolvedValue({
        content: "Test response",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      expect(callAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.not.stringContaining("# Language"),
        }),
      );
    });

    it("should preserve technical terms instruction in language prompt", async () => {
      const { callAgent } = await import("../../src/services/aiService.js");
      vi.mocked(callAgent).mockResolvedValue({
        content: "Test response",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [],
      });

      const aiManagerWithLanguage = new AIManager({
        messageManager: mockMessageManager,
        toolManager: mockToolManager,
        logger: mockLogger,
        workdir: "/test/workdir",
        getGatewayConfig: () => mockGatewayConfig,
        getModelConfig: () => mockModelConfig,
        getMaxInputTokens: () => 96000,
        getLanguage: () => "Spanish",
      });

      await aiManagerWithLanguage.sendAIMessage();

      expect(callAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining(
            "Technical terms (e.g., code, tool names, file paths) should remain in their original language or English where appropriate.",
          ),
        }),
      );
    });
  });

  describe("Message Persistence During AI Recursion (FR-012)", () => {
    it("should save session after each recursion level in nested calls", async () => {
      // Mock callAgent to return tool calls for the first call, no tool calls for subsequent calls
      const { callAgent } = await import("../../src/services/aiService.js");
      let callCount = 0;
      vi.mocked(callAgent).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call returns tool calls (triggers recursion)
          return {
            content: "Test response with tools",
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
            tool_calls: [
              {
                type: "function" as const,
                id: "test-tool-call",
                function: { name: "test-tool", arguments: "{}" },
              },
            ],
          };
        } else {
          // Subsequent calls return no tool calls (stops recursion)
          return {
            content: "Test response without tools",
            usage: {
              prompt_tokens: 5,
              completion_tokens: 10,
              total_tokens: 15,
            },
            tool_calls: [],
          };
        }
      });

      // Call sendAIMessage (initial call with recursionDepth = 0)
      await aiManager.sendAIMessage({ recursionDepth: 0 });

      // Verify that saveSession was called:
      // - Once for user
      // - Once for the initial call (recursionDepth = 0)
      // - Once for the recursive call (recursionDepth = 1)
      expect(mockMessageManager.saveSession).toHaveBeenCalledTimes(3);
    });

    it("should save session even when AI call fails during recursion", async () => {
      // Mock callAgent to throw an error
      const { callAgent } = await import("../../src/services/aiService.js");
      vi.mocked(callAgent).mockRejectedValue(new Error("AI service error"));

      // First, call with recursionDepth = 0 to set up abort controllers
      // Then the recursive call will have proper controllers
      let callCount = 0;
      vi.mocked(callAgent).mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // First call succeeds and returns tool calls (triggers recursion)
          return {
            content: "Test response",
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
            tool_calls: [
              {
                type: "function" as const,
                id: "test-tool-call",
                function: { name: "test-tool", arguments: "{}" },
              },
            ],
          };
        } else {
          // Second call (recursion) fails
          throw new Error("AI service error");
        }
      });

      // Call sendAIMessage with recursion depth = 0 (will trigger recursion that fails)
      await aiManager.sendAIMessage({ recursionDepth: 0 });

      // Verify that saveSession was called for user and both initial and recursive calls
      expect(mockMessageManager.saveSession).toHaveBeenCalledTimes(3);

      // Verify that error was handled in the recursive call
      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        "AI service error",
      );
    });

    it("should log warning when finish reason is length", async () => {
      const { callAgent } = await import("../../src/services/aiService.js");
      const mockHeaders = { "x-test-header": "test-value" };
      vi.mocked(callAgent).mockResolvedValue({
        content: "Truncated response",
        finish_reason: "length",
        response_headers: mockHeaders,
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [],
      });

      await aiManager.sendAIMessage();

      expect(mockLogger.warn).toHaveBeenCalledWith(
        "AI response truncated due to length limit. Response headers:",
        mockHeaders,
      );
    });

    it("should save session during each recursion regardless of tool execution results", async () => {
      // Mock callAgent to return tool calls
      const { callAgent } = await import("../../src/services/aiService.js");
      vi.mocked(callAgent)
        .mockResolvedValueOnce({
          content: "Test response",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          tool_calls: [
            {
              type: "function" as const,
              id: "test-tool-call",
              function: { name: "test-tool", arguments: "{}" },
            },
          ],
        })
        .mockResolvedValueOnce({
          content: "Final response",
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          tool_calls: [],
        });

      // Mock tool execution to fail
      vi.mocked(mockToolManager.execute).mockRejectedValue(
        new Error("Tool execution failed"),
      );

      // Call sendAIMessage with recursion depth > 0
      await aiManager.sendAIMessage({ recursionDepth: 1 });

      // Verify that saveSession was still called despite tool failure
      expect(mockMessageManager.saveSession).toHaveBeenCalledTimes(1);
    });
  });

  describe("Temporary Permissions", () => {
    it("should add temporary rules when allowedRules is provided", async () => {
      const mockPermissionManager = {
        addTemporaryRules: vi.fn(),
        clearTemporaryRules: vi.fn(),
      };

      const aiManagerWithPermissions = new AIManager({
        messageManager: mockMessageManager,
        toolManager: mockToolManager,
        logger: mockLogger,
        permissionManager:
          mockPermissionManager as unknown as PermissionManager,
        workdir: "/test/workdir",
        getGatewayConfig: () => mockGatewayConfig,
        getModelConfig: () => mockModelConfig,
        getMaxInputTokens: () => 96000,
        getLanguage: () => undefined,
      });

      const { callAgent } = await import("../../src/services/aiService.js");
      vi.mocked(callAgent).mockResolvedValue({
        content: "Test response",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [],
      });

      await aiManagerWithPermissions.sendAIMessage({
        allowedRules: ["Edit", "Bash"],
      });

      expect(mockPermissionManager.addTemporaryRules).toHaveBeenCalledWith([
        "Edit",
        "Bash",
      ]);
      expect(mockPermissionManager.clearTemporaryRules).toHaveBeenCalled();
    });

    it("should only add temporary rules at recursionDepth 0", async () => {
      const mockPermissionManager = {
        addTemporaryRules: vi.fn(),
        clearTemporaryRules: vi.fn(),
      };

      const aiManagerWithPermissions = new AIManager({
        messageManager: mockMessageManager,
        toolManager: mockToolManager,
        logger: mockLogger,
        permissionManager:
          mockPermissionManager as unknown as PermissionManager,
        workdir: "/test/workdir",
        getGatewayConfig: () => mockGatewayConfig,
        getModelConfig: () => mockModelConfig,
        getMaxInputTokens: () => 96000,
        getLanguage: () => undefined,
      });

      const { callAgent } = await import("../../src/services/aiService.js");
      vi.mocked(callAgent).mockResolvedValue({
        content: "Test response",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [],
      });

      await aiManagerWithPermissions.sendAIMessage({
        allowedRules: ["Edit"],
        recursionDepth: 1,
      });

      expect(mockPermissionManager.addTemporaryRules).not.toHaveBeenCalled();
      expect(mockPermissionManager.clearTemporaryRules).not.toHaveBeenCalled();
    });

    it("should clear temporary rules even if AI call fails", async () => {
      const mockPermissionManager = {
        addTemporaryRules: vi.fn(),
        clearTemporaryRules: vi.fn(),
      };

      const aiManagerWithPermissions = new AIManager({
        messageManager: mockMessageManager,
        toolManager: mockToolManager,
        logger: mockLogger,
        permissionManager:
          mockPermissionManager as unknown as PermissionManager,
        workdir: "/test/workdir",
        getGatewayConfig: () => mockGatewayConfig,
        getModelConfig: () => mockModelConfig,
        getMaxInputTokens: () => 96000,
        getLanguage: () => undefined,
      });

      const { callAgent } = await import("../../src/services/aiService.js");
      vi.mocked(callAgent).mockRejectedValue(new Error("AI service error"));

      await aiManagerWithPermissions.sendAIMessage({
        allowedRules: ["Edit"],
      });

      expect(mockPermissionManager.addTemporaryRules).toHaveBeenCalled();
      expect(mockPermissionManager.clearTemporaryRules).toHaveBeenCalled();
    });
  });
});
