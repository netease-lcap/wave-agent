import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import * as aiService from "../../src/services/aiService.js";
import { logger } from "../../src/utils/globalLogger.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock node:fs
vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

// Mock gitUtils
vi.mock("../../src/utils/gitUtils.js", () => ({
  isGitRepository: vi.fn(),
}));

// Mock the aiService module
vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn().mockImplementation(async (options) => {
    if (options.onContentUpdate) options.onContentUpdate("Test response");
    return {
      content: "Test response",
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      tool_calls: [],
    };
  }),
  compressMessages: vi.fn().mockResolvedValue({
    content: "Compressed content",
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
  isClaudeModel: vi.fn().mockReturnValue(false),
  transformMessagesForClaudeCache: vi.fn((m) => m),
  addCacheControlToLastTool: vi.fn((t) => t),
  extendUsageWithCacheMetrics: vi.fn((u) => u),
}));

// Mock the memory service
vi.mock("../../src/services/memory.js", () => ({
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/utils/messageOperations.js", () => ({}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

describe("AIManager", () => {
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

    const taskManager = {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
    } as unknown as TaskManager;

    const container = new Container();
    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("TaskManager", taskManager);
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      autoMemoryEnabled: false,
      autoMemoryContent: "",
      autoMemoryDir: undefined,
    });

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
      getGatewayConfig: () => mockGatewayConfig,
      getModelConfig: () => mockModelConfig,
      getMaxInputTokens: () => 96000,
      getLanguage: () => undefined,
      stream: false,
    });

    // Mock addUserMessage to save session (simulating real behavior)
    vi.mocked(mockMessageManager.addUserMessage).mockImplementation(() => {
      mockMessageManager.saveSession();
    });

    // Reset mocks
    vi.mocked(aiService.callAgent).mockClear();
    vi.mocked(aiService.compressMessages).mockClear();
  });

  it("should call callAgent", async () => {
    await aiManager.sendAIMessage();
    expect(aiService.callAgent).toHaveBeenCalled();
  });

  describe("Language Prompt Injection", () => {
    it("should inject language prompt when language is set", async () => {
      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      const container = new Container();
      container.register("MessageManager", mockMessageManager);
      container.register("ToolManager", mockToolManager);
      container.register("TaskManager", taskManager);
      container.register("MemoryService", {
        getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
        autoMemoryEnabled: false,
        autoMemoryContent: "",
        autoMemoryDir: undefined,
      });

      const aiManagerWithLanguage = new AIManager(container, {
        workdir: "/test/workdir",
        getGatewayConfig: () => mockGatewayConfig,
        getModelConfig: () => mockModelConfig,
        getMaxInputTokens: () => 96000,
        getLanguage: () => "Chinese",
        stream: false,
      });

      await aiManagerWithLanguage.sendAIMessage();

      expect(aiService.callAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("# Language"),
        }),
      );
      expect(aiService.callAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("Always respond in Chinese"),
        }),
      );
    });

    it("should NOT inject language prompt when language is undefined", async () => {
      await aiManager.sendAIMessage();

      expect(aiService.callAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.not.stringContaining("# Language"),
        }),
      );
    });

    it("should preserve technical terms instruction in language prompt", async () => {
      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      const container = new Container();
      container.register("MessageManager", mockMessageManager);
      container.register("ToolManager", mockToolManager);
      container.register("TaskManager", taskManager);
      container.register("MemoryService", {
        getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
        autoMemoryEnabled: false,
        autoMemoryContent: "",
        autoMemoryDir: undefined,
      });

      const aiManagerWithLanguage = new AIManager(container, {
        workdir: "/test/workdir",
        getGatewayConfig: () => mockGatewayConfig,
        getModelConfig: () => mockModelConfig,
        getMaxInputTokens: () => 96000,
        getLanguage: () => "Spanish",
        stream: false,
      });

      await aiManagerWithLanguage.sendAIMessage();

      expect(aiService.callAgent).toHaveBeenCalledWith(
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
      const aiService = await import("../../src/services/aiService.js");
      let callCount = 0;
      vi.spyOn(aiService, "callAgent").mockImplementation(async () => {
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
      const aiService = await import("../../src/services/aiService.js");
      vi.spyOn(aiService, "callAgent").mockRejectedValue(
        new Error("AI service error"),
      );

      // First, call with recursionDepth = 0 to set up abort controllers
      // Then the recursive call will have proper controllers
      let callCount = 0;
      vi.spyOn(aiService, "callAgent").mockImplementation(async () => {
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

    it("should log warning and recurse when finish reason is length", async () => {
      const aiService = await import("../../src/services/aiService.js");
      const mockHeaders = { "x-test-header": "test-value" };
      vi.spyOn(aiService, "callAgent")
        .mockResolvedValueOnce({
          content: "Truncated response",
          finish_reason: "length",
          response_headers: mockHeaders,
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          tool_calls: [],
        })
        .mockResolvedValueOnce({
          content: "Final response",
          finish_reason: "stop",
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          tool_calls: [],
        });

      await aiManager.sendAIMessage();

      expect(logger.warn).toHaveBeenCalledWith(
        "AI response truncated due to length limit. Response headers:",
        mockHeaders,
      );
      expect(mockMessageManager.addUserMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("cut off"),
        }),
      );
      expect(aiService.callAgent).toHaveBeenCalledTimes(2);
    });

    it("should save session during each recursion regardless of tool execution results", async () => {
      // Mock callAgent to return tool calls
      const aiService = await import("../../src/services/aiService.js");
      vi.spyOn(aiService, "callAgent")
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
        getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
      };

      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      const container = new Container();
      container.register("MessageManager", mockMessageManager);
      container.register("ToolManager", mockToolManager);
      container.register("TaskManager", taskManager);
      container.register("MemoryService", {
        getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
        autoMemoryEnabled: false,
        autoMemoryContent: "",
        autoMemoryDir: undefined,
      });
      container.register(
        "PermissionManager",
        mockPermissionManager as unknown as PermissionManager,
      );

      const aiManagerWithPermissions = new AIManager(container, {
        workdir: "/test/workdir",
        getGatewayConfig: () => mockGatewayConfig,
        getModelConfig: () => mockModelConfig,
        getMaxInputTokens: () => 96000,
        getLanguage: () => undefined,
        stream: false,
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
        getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
      };

      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      const container = new Container();
      container.register("MessageManager", mockMessageManager);
      container.register("ToolManager", mockToolManager);
      container.register("TaskManager", taskManager);
      container.register("MemoryService", {
        getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
        autoMemoryEnabled: false,
        autoMemoryContent: "",
        autoMemoryDir: undefined,
      });
      container.register(
        "PermissionManager",
        mockPermissionManager as unknown as PermissionManager,
      );

      const aiManagerWithPermissions = new AIManager(container, {
        workdir: "/test/workdir",
        getGatewayConfig: () => mockGatewayConfig,
        getModelConfig: () => mockModelConfig,
        getMaxInputTokens: () => 96000,
        getLanguage: () => undefined,
        stream: false,
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
        getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
      };

      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      const container = new Container();
      container.register("MessageManager", mockMessageManager);
      container.register("ToolManager", mockToolManager);
      container.register("TaskManager", taskManager);
      container.register("MemoryService", {
        getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
        autoMemoryEnabled: false,
        autoMemoryContent: "",
        autoMemoryDir: undefined,
      });
      container.register(
        "PermissionManager",
        mockPermissionManager as unknown as PermissionManager,
      );

      const aiManagerWithPermissions = new AIManager(container, {
        workdir: "/test/workdir",
        getGatewayConfig: () => mockGatewayConfig,
        getModelConfig: () => mockModelConfig,
        getMaxInputTokens: () => 96000,
        getLanguage: () => undefined,
        stream: false,
      });

      vi.mocked(aiService.callAgent).mockRejectedValueOnce(
        new Error("AI service error"),
      );

      await aiManagerWithPermissions.sendAIMessage({
        allowedRules: ["Edit"],
      });

      expect(mockPermissionManager.addTemporaryRules).toHaveBeenCalled();
      expect(mockPermissionManager.clearTemporaryRules).toHaveBeenCalled();
    });
  });

  describe("isGitRepository", () => {
    it("should include 'Is directory a git repo: Yes' in system prompt if .git exists", async () => {
      const { isGitRepository } = await import("../../src/utils/gitUtils.js");
      vi.mocked(isGitRepository).mockReturnValue("Yes");
      await aiManager.sendAIMessage();

      expect(aiService.callAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("Is directory a git repo: Yes"),
        }),
      );
    });

    it("should include 'Is directory a git repo: No' in system prompt if .git does not exist", async () => {
      const { isGitRepository } = await import("../../src/utils/gitUtils.js");
      vi.mocked(isGitRepository).mockReturnValue("No");
      await aiManager.sendAIMessage();

      expect(aiService.callAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: expect.stringContaining("Is directory a git repo: No"),
        }),
      );
    });
  });
});
