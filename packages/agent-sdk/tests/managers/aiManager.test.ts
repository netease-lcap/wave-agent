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
  compactMessages: vi.fn().mockResolvedValue({
    content: "Compacted content",
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
  transformMessagesForExplicitCache: vi.fn((m) => m),
  extendUsageWithCacheMetrics: vi.fn((u) => u),
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

/** Flatten systemPrompt (string or SystemPromptBlock[]) into a single string. */
function flattenSystemPrompt(sp: unknown): string {
  if (typeof sp === "string") return sp;
  if (Array.isArray(sp))
    return sp.map((b: { text: string }) => b.text).join("\n\n");
  return "";
}

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

    const taskManager = {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
    } as unknown as TaskManager;

    // Mock ConfigurationService
    const mockConfigurationService = {
      setOptions: vi.fn(),
      resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
      resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
      resolveLanguage: vi.fn().mockReturnValue(undefined),
      getEnvironmentVars: vi.fn().mockReturnValue({}),
    };

    const container = new Container();
    container.register("ConfigurationService", mockConfigurationService);
    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("TaskManager", taskManager);
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

    // Mock MessageQueue with no pending notifications
    container.register("MessageQueue", {
      hasNotifications: vi.fn().mockReturnValue(false),
      drainNotifications: vi.fn().mockReturnValue([]),
    });

    // Create AIManager instance
    aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
    });

    // Mock addUserMessage to save session (simulating real behavior)
    vi.mocked(mockMessageManager.addUserMessage).mockImplementation(() => {
      mockMessageManager.saveSession();
      return "msg-id";
    });

    // Reset mocks
    vi.mocked(aiService.callAgent).mockClear();
    vi.mocked(aiService.compactMessages).mockClear();
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
      container.register("ConfigurationService", {
        resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
        resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
        resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
        resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
        resolveLanguage: vi.fn().mockReturnValue("Chinese"),
      });
      container.register("MessageManager", mockMessageManager);
      container.register("ToolManager", mockToolManager);
      container.register("TaskManager", taskManager);
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
      container.register("MessageQueue", {
        hasNotifications: vi.fn().mockReturnValue(false),
        drainNotifications: vi.fn().mockReturnValue([]),
      });

      const aiManagerWithLanguage = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      await aiManagerWithLanguage.sendAIMessage();

      const langCallArgs = vi.mocked(aiService.callAgent).mock.calls[0][0];
      const langSpText = flattenSystemPrompt(langCallArgs.systemPrompt);
      expect(langSpText).toContain("# Language");
      expect(langSpText).toContain("Always respond in Chinese");
    });

    it("should NOT inject language prompt when language is undefined", async () => {
      await aiManager.sendAIMessage();

      const noLangCallArgs = vi.mocked(aiService.callAgent).mock.calls[0][0];
      const noLangSpText = flattenSystemPrompt(noLangCallArgs.systemPrompt);
      expect(noLangSpText).not.toContain("# Language");
    });

    it("should NOT inject dontAsk permission mode into system prompt", async () => {
      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

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
      container.register("TaskManager", taskManager);
      container.register("MemoryService", {
        getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
        getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
        ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
        getAutoMemoryContent: vi.fn().mockResolvedValue(""),
      });
      container.register("PermissionManager", {
        getCurrentEffectiveMode: vi.fn().mockReturnValue("dontAsk"),
        clearTemporaryRules: vi.fn(),
        getPlanFilePath: vi.fn().mockReturnValue(undefined),
        setHasExitedPlanMode: vi.fn(),
        hasExitedPlanModeInSession: vi.fn(() => false),
        setNeedsPlanModeExitAttachment: vi.fn(),
        getNeedsPlanModeExitAttachment: vi.fn(() => false),
      } as unknown as Record<string, unknown>);

      const aiManagerWithDontAsk = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      await aiManagerWithDontAsk.sendAIMessage();

      const dontAskCallArgs = vi.mocked(aiService.callAgent).mock.calls[0][0];
      const dontAskSpText = flattenSystemPrompt(dontAskCallArgs.systemPrompt);
      expect(dontAskSpText).not.toContain("# Permission Mode");
      expect(dontAskSpText).not.toContain("dontAsk");
    });

    it("should preserve technical terms instruction in language prompt", async () => {
      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      const container = new Container();
      container.register("ConfigurationService", {
        resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
        resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
        resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
        resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
        resolveLanguage: vi.fn().mockReturnValue("Spanish"),
      });
      container.register("MessageManager", mockMessageManager);
      container.register("ToolManager", mockToolManager);
      container.register("TaskManager", taskManager);
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
      container.register("MessageQueue", {
        hasNotifications: vi.fn().mockReturnValue(false),
        drainNotifications: vi.fn().mockReturnValue([]),
      });

      const aiManagerWithLanguage = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      await aiManagerWithLanguage.sendAIMessage();

      const techCallArgs = vi.mocked(aiService.callAgent).mock.calls[0][0];
      const techSpText = flattenSystemPrompt(techCallArgs.systemPrompt);
      expect(techSpText).toContain(
        "Use Spanish for all explanations, comments, and communications with the user. Technical terms and code identifiers should remain in their original form.",
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

    it("finalizes streaming blocks when AI call fails (abort stops reasoning timer)", async () => {
      const aiService = await import("../../src/services/aiService.js");
      vi.spyOn(aiService, "callAgent").mockRejectedValue(
        new Error("Request was aborted"),
      );

      await aiManager.sendAIMessage({ recursionDepth: 0 });

      // Streaming blocks must be finalized so the UI stops its in-progress timer.
      expect(mockMessageManager.finalizeStreamingBlocks).toHaveBeenCalled();
      expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
        "Request was aborted",
      );
    });

    it("finalizes aborted tool blocks when AI call fails (abort stops tool spinner)", async () => {
      const aiService = await import("../../src/services/aiService.js");
      vi.spyOn(aiService, "callAgent").mockRejectedValue(
        new Error("Request was aborted"),
      );

      await aiManager.sendAIMessage({ recursionDepth: 0 });

      // Tool blocks stuck in start/streaming/running must be finalized so the
      // UI stops showing the yellow "running" spinner.
      expect(mockMessageManager.finalizeAbortedToolBlocks).toHaveBeenCalled();
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
          content: expect.stringContaining("Output token limit hit"),
          isMeta: true,
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
        setHasExitedPlanMode: vi.fn(),
        hasExitedPlanModeInSession: vi.fn(() => false),
        setNeedsPlanModeExitAttachment: vi.fn(),
        getNeedsPlanModeExitAttachment: vi.fn(() => false),
      };

      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

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
      container.register("TaskManager", taskManager);
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
      container.register(
        "PermissionManager",
        mockPermissionManager as unknown as PermissionManager,
      );
      container.register("MessageQueue", {
        hasNotifications: vi.fn().mockReturnValue(false),
        drainNotifications: vi.fn().mockReturnValue([]),
      });

      const aiManagerWithPermissions = new AIManager(container, {
        workdir: "/test/workdir",
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
        setHasExitedPlanMode: vi.fn(),
        hasExitedPlanModeInSession: vi.fn(() => false),
        setNeedsPlanModeExitAttachment: vi.fn(),
        getNeedsPlanModeExitAttachment: vi.fn(() => false),
      };

      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

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
      container.register("TaskManager", taskManager);
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
      container.register(
        "PermissionManager",
        mockPermissionManager as unknown as PermissionManager,
      );
      container.register("MessageQueue", {
        hasNotifications: vi.fn().mockReturnValue(false),
        drainNotifications: vi.fn().mockReturnValue([]),
      });

      const aiManagerWithPermissions = new AIManager(container, {
        workdir: "/test/workdir",
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
        setHasExitedPlanMode: vi.fn(),
        hasExitedPlanModeInSession: vi.fn(() => false),
        setNeedsPlanModeExitAttachment: vi.fn(),
        getNeedsPlanModeExitAttachment: vi.fn(() => false),
      };

      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

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
      container.register("TaskManager", taskManager);
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
      container.register(
        "PermissionManager",
        mockPermissionManager as unknown as PermissionManager,
      );
      container.register("MessageQueue", {
        hasNotifications: vi.fn().mockReturnValue(false),
        drainNotifications: vi.fn().mockReturnValue([]),
      });

      const aiManagerWithPermissions = new AIManager(container, {
        workdir: "/test/workdir",
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

  describe("Auto-Memory Injection", () => {
    it("should inject auto-memory content when enabled", async () => {
      const memoryService = {
        getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
        getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
        ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
        getAutoMemoryContent: vi.fn().mockResolvedValue("Auto-memory content"),
      };

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
      container.register("TaskManager", {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      });
      container.register("MemoryService", memoryService);
      container.register("PermissionManager", {
        getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
        clearTemporaryRules: vi.fn(),
        getPlanFilePath: vi.fn().mockReturnValue(undefined),
        setHasExitedPlanMode: vi.fn(),
        hasExitedPlanModeInSession: vi.fn(() => false),
        setNeedsPlanModeExitAttachment: vi.fn(),
        getNeedsPlanModeExitAttachment: vi.fn(() => false),
      });
      container.register("MessageQueue", {
        hasNotifications: vi.fn().mockReturnValue(false),
        drainNotifications: vi.fn().mockReturnValue([]),
      });

      const aiManagerWithAutoMemory = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      await aiManagerWithAutoMemory.sendAIMessage();

      const memCallArgs = vi.mocked(aiService.callAgent).mock.calls[0][0];
      const memSpText = flattenSystemPrompt(memCallArgs.systemPrompt);
      expect(memSpText).toContain("Auto-memory content");
    });

    it("should NOT inject auto-memory content when disabled", async () => {
      const memoryService = {
        getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
        getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
        ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
        getAutoMemoryContent: vi.fn().mockResolvedValue("Auto-memory content"),
      };

      const container = new Container();
      container.register("ConfigurationService", {
        resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
        resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
        resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
        resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
        resolveLanguage: vi.fn().mockReturnValue(undefined),
      });
      container.register("MessageManager", mockMessageManager);
      container.register("ToolManager", mockToolManager);
      container.register("TaskManager", {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      });
      container.register("MemoryService", memoryService);
      container.register("PermissionManager", {
        getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
        clearTemporaryRules: vi.fn(),
        getPlanFilePath: vi.fn().mockReturnValue(undefined),
        setHasExitedPlanMode: vi.fn(),
        hasExitedPlanModeInSession: vi.fn(() => false),
        setNeedsPlanModeExitAttachment: vi.fn(),
        getNeedsPlanModeExitAttachment: vi.fn(() => false),
      });
      container.register("MessageQueue", {
        hasNotifications: vi.fn().mockReturnValue(false),
        drainNotifications: vi.fn().mockReturnValue([]),
      });

      const aiManagerDisabledAutoMemory = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      await aiManagerDisabledAutoMemory.sendAIMessage();

      const disabledMemCallArgs = vi.mocked(aiService.callAgent).mock
        .calls[0][0];
      const disabledMemSpText = flattenSystemPrompt(
        disabledMemCallArgs.systemPrompt,
      );
      expect(disabledMemSpText).not.toContain("Auto-memory content");
    });
  });

  describe("isGitRepository", () => {
    it("should include 'Is directory a git repo: Yes' in system prompt if .git exists", async () => {
      const { isGitRepository } = await import("../../src/utils/gitUtils.js");
      vi.mocked(isGitRepository).mockReturnValue("Yes");
      await aiManager.sendAIMessage();

      const gitYesCallArgs = vi.mocked(aiService.callAgent).mock.calls[0][0];
      const gitYesSpText = flattenSystemPrompt(gitYesCallArgs.systemPrompt);
      expect(gitYesSpText).toContain("Is directory a git repo: Yes");
    });

    it("should include 'Is directory a git repo: No' in system prompt if .git does not exist", async () => {
      const { isGitRepository } = await import("../../src/utils/gitUtils.js");
      vi.mocked(isGitRepository).mockReturnValue("No");
      await aiManager.sendAIMessage();

      const gitNoCallArgs = vi.mocked(aiService.callAgent).mock.calls[0][0];
      const gitNoSpText = flattenSystemPrompt(gitNoCallArgs.systemPrompt);
      expect(gitNoSpText).toContain("Is directory a git repo: No");
    });
  });

  describe("File Mention Scanning", () => {
    it("should scan for file mentions in the last user message and call triggerFileRead", async () => {
      const messages = [
        {
          id: "msg-1",
          role: "user",
          blocks: [
            {
              type: "text",
              content: "Please check @src/main.ts and @package.json",
            },
          ],
        },
      ];
      vi.mocked(mockMessageManager.getMessages).mockReturnValue(
        messages as unknown as ReturnType<
          typeof mockMessageManager.getMessages
        >,
      );

      await aiManager.sendAIMessage();

      expect(mockMessageManager.triggerFileRead).toHaveBeenCalledWith(
        "src/main.ts",
      );
      expect(mockMessageManager.triggerFileRead).toHaveBeenCalledWith(
        "package.json",
      );
    });

    it("should only scan for file mentions at recursionDepth 0", async () => {
      const messages = [
        {
          id: "msg-1",
          role: "user",
          blocks: [
            {
              type: "text",
              content: "Please check @src/main.ts",
            },
          ],
        },
      ];
      vi.mocked(mockMessageManager.getMessages).mockReturnValue(
        messages as unknown as ReturnType<
          typeof mockMessageManager.getMessages
        >,
      );

      await aiManager.sendAIMessage({ recursionDepth: 1 });

      expect(mockMessageManager.triggerFileRead).not.toHaveBeenCalled();
    });
  });

  describe("setIsLoading", () => {
    it("should call onLoadingChange callback when loading state changes", async () => {
      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      const onLoadingChange = vi.fn();

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
      container.register("TaskManager", taskManager);
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
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
      });
      container.register("AgentOptions", {
        callbacks: { onLoadingChange },
      });

      const testAIManager = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      testAIManager.setIsLoading(true);
      expect(onLoadingChange).toHaveBeenCalledWith(true);

      testAIManager.setIsLoading(false);
      expect(onLoadingChange).toHaveBeenCalledWith(false);
    });

    it("should handle missing onLoadingChange callback gracefully", () => {
      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

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
      container.register("TaskManager", taskManager);
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
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
      });
      container.register("AgentOptions", {
        callbacks: {},
      });

      const testAIManager = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      // Should not throw
      testAIManager.setIsLoading(true);
      expect(testAIManager.isLoading).toBe(true);
    });
  });

  describe("Notification injection in finally block", () => {
    it("should inject notifications as user messages when pending", async () => {
      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      const mockMessageQueue = {
        hasNotifications: vi
          .fn()
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false),
        drainNotifications: vi
          .fn()
          .mockReturnValue([
            "<task-notification><task-id>test</task-id></task-notification>",
          ]),
      };

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
      container.register("TaskManager", taskManager);
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
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
      });
      container.register("MessageQueue", mockMessageQueue);
      container.register("AgentOptions", {
        callbacks: {},
      });

      const testAIManager = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      await testAIManager.sendAIMessage();
      expect(mockMessageQueue.hasNotifications).toHaveBeenCalled();
    });

    it("should inject and process pending notifications in finally block", async () => {
      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      // First call returns true (pending), second call returns false (after dequeue)
      const mockMessageQueue = {
        hasNotifications: vi
          .fn()
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false),
        drainNotifications: vi
          .fn()
          .mockReturnValue([
            "<task-notification><task-id>test</task-id></task-notification>",
          ]),
      };

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
      container.register("TaskManager", taskManager);
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
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
      });
      container.register("MessageQueue", mockMessageQueue);
      container.register("AgentOptions", {
        callbacks: {},
      });

      const testAIManager = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      await testAIManager.sendAIMessage();
      expect(mockMessageQueue.drainNotifications).toHaveBeenCalled();
    });

    it("should execute Stop hooks even when notifications are pending", async () => {
      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      // First call returns true (pending), second call returns false (after dequeue)
      const mockMessageQueue = {
        hasNotifications: vi
          .fn()
          .mockReturnValueOnce(true)
          .mockReturnValueOnce(false)
          .mockReturnValueOnce(false),
        drainNotifications: vi
          .fn()
          .mockReturnValue([
            "<task-notification><task-id>test</task-id></task-notification>",
          ]),
      };

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
      container.register("TaskManager", taskManager);
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
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
      });
      container.register("MessageQueue", mockMessageQueue);
      container.register("AgentOptions", {
        callbacks: {},
      });

      const testAIManager = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      // Spy on executeStopHooks to verify it is called
      const stopHookSpy = vi
        .spyOn(
          testAIManager as unknown as {
            executeStopHooks: () => Promise<boolean>;
          },
          "executeStopHooks",
        )
        .mockResolvedValue(false);

      await testAIManager.sendAIMessage();

      // Stop hooks should have been called despite pending notifications
      expect(stopHookSpy).toHaveBeenCalled();
      // Notifications should also have been dequeued
      expect(mockMessageQueue.drainNotifications).toHaveBeenCalled();
    });
  });

  describe("Stop hook background_tasks and session_crons (User Story 17)", () => {
    it("should inject background_tasks from BackgroundTaskManager and session_crons from CronManager into Stop hook context", async () => {
      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      const mockMessageQueue = {
        hasNotifications: vi.fn().mockReturnValue(false),
        drainNotifications: vi.fn().mockReturnValue([]),
      };

      const mockHookManager = {
        executeHooks: vi.fn().mockResolvedValue([]),
        processHookResults: vi.fn().mockReturnValue({
          shouldBlock: false,
          errorMessage: "",
        }),
        hasHooks: vi.fn().mockReturnValue(true),
      };

      const container = new Container();
      container.register("ConfigurationService", {
        resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
        resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
        resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
        resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
        resolveLanguage: vi.fn().mockReturnValue(undefined),
      });
      container.register("MessageManager", mockMessageManager);
      container.register("ToolManager", mockToolManager);
      container.register("TaskManager", taskManager);
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
      // BackgroundTaskManager: 3 running tasks (shell+subagent+workflow) + 1 completed (filtered out)
      container.register("BackgroundTaskManager", {
        getAllTasks: vi.fn().mockReturnValue([
          {
            id: "task-shell-1",
            type: "shell",
            status: "running",
            command: "tail -f /var/log/syslog",
            description: undefined,
          },
          {
            id: "task-sub-1",
            type: "subagent",
            status: "running",
            subagentId: "sub-1",
            description: "refactor module",
          },
          {
            id: "task-wf-1",
            type: "workflow",
            status: "running",
            description: "Workflow: audit",
            runId: "run-1",
          },
          {
            id: "task-done-1",
            type: "shell",
            status: "completed",
            command: "echo done",
          },
        ]),
      });
      // SubagentManager: one active instance matching task-sub-1's subagentId
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
        getActiveInstances: vi
          .fn()
          .mockReturnValue([
            { subagentId: "sub-1", subagentType: "general-purpose" },
          ]),
      });
      // CronManager: one job
      container.register("CronManager", {
        listJobs: vi.fn().mockReturnValue([
          {
            id: "cron-001",
            cron: "0 9 * * 1-5",
            recurring: true,
            prompt: "check the build",
          },
        ]),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
      });
      container.register("MessageQueue", mockMessageQueue);
      container.register("HookManager", mockHookManager);
      container.register("AgentOptions", { callbacks: {} });

      const testAIManager = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      await testAIManager.sendAIMessage();

      // Stop hook should receive background_tasks with 3 running tasks
      // (completed task filtered out), with per-type conditional fields,
      // and session_crons with 1 cron job.
      expect(mockHookManager.executeHooks).toHaveBeenCalledWith(
        "Stop",
        expect.objectContaining({
          event: "Stop",
          backgroundTasks: [
            {
              id: "task-shell-1",
              type: "shell",
              status: "running",
              description: "",
              command: "tail -f /var/log/syslog",
            },
            {
              id: "task-sub-1",
              type: "subagent",
              status: "running",
              description: "refactor module",
              agent_type: "general-purpose",
            },
            {
              id: "task-wf-1",
              type: "workflow",
              status: "running",
              description: "Workflow: audit",
              name: "audit",
            },
          ],
          sessionCrons: [
            {
              id: "cron-001",
              schedule: "0 9 * * 1-5",
              recurring: true,
              prompt: "check the build",
            },
          ],
        }),
      );
    });

    it("should inject empty background_tasks and session_crons when nothing in flight", async () => {
      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      const mockMessageQueue = {
        hasNotifications: vi.fn().mockReturnValue(false),
        drainNotifications: vi.fn().mockReturnValue([]),
      };

      const mockHookManager = {
        executeHooks: vi.fn().mockResolvedValue([]),
        processHookResults: vi.fn().mockReturnValue({
          shouldBlock: false,
          errorMessage: "",
        }),
        hasHooks: vi.fn().mockReturnValue(true),
      };

      const container = new Container();
      container.register("ConfigurationService", {
        resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
        resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
        resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
        resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
        resolveLanguage: vi.fn().mockReturnValue(undefined),
      });
      container.register("MessageManager", mockMessageManager);
      container.register("ToolManager", mockToolManager);
      container.register("TaskManager", taskManager);
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
      // No background tasks
      container.register("BackgroundTaskManager", {
        getAllTasks: vi.fn().mockReturnValue([]),
      });
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
        getActiveInstances: vi.fn().mockReturnValue([]),
      });
      // No CronManager registered → cronManager getter returns undefined
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
      });
      container.register("MessageQueue", mockMessageQueue);
      container.register("HookManager", mockHookManager);
      container.register("AgentOptions", { callbacks: {} });

      const testAIManager = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      await testAIManager.sendAIMessage();

      expect(mockHookManager.executeHooks).toHaveBeenCalledWith(
        "Stop",
        expect.objectContaining({
          event: "Stop",
          backgroundTasks: [],
          sessionCrons: [],
        }),
      );
    });

    it("should truncate shell command exceeding 1000 chars with marker", async () => {
      const taskManager = {
        on: vi.fn(),
        listTasks: vi.fn().mockResolvedValue([]),
      } as unknown as TaskManager;

      const mockMessageQueue = {
        hasNotifications: vi.fn().mockReturnValue(false),
        drainNotifications: vi.fn().mockReturnValue([]),
      };

      const mockHookManager = {
        executeHooks: vi.fn().mockResolvedValue([]),
        processHookResults: vi.fn().mockReturnValue({
          shouldBlock: false,
          errorMessage: "",
        }),
        hasHooks: vi.fn().mockReturnValue(true),
      };

      const longCommand = "a".repeat(1500);

      const container = new Container();
      container.register("ConfigurationService", {
        resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
        resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
        resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
        resolveAutoMemoryEnabled: vi.fn().mockReturnValue(false),
        resolveLanguage: vi.fn().mockReturnValue(undefined),
      });
      container.register("MessageManager", mockMessageManager);
      container.register("ToolManager", mockToolManager);
      container.register("TaskManager", taskManager);
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
      container.register("BackgroundTaskManager", {
        getAllTasks: vi.fn().mockReturnValue([
          {
            id: "task-long",
            type: "shell",
            status: "running",
            command: longCommand,
            description: undefined,
          },
        ]),
      });
      container.register("SubagentManager", {
        getConfigurations: vi.fn().mockReturnValue([]),
        getActiveInstances: vi.fn().mockReturnValue([]),
      });
      container.register("SkillManager", {
        getAvailableSkills: vi.fn().mockReturnValue([]),
      });
      container.register("MessageQueue", mockMessageQueue);
      container.register("HookManager", mockHookManager);
      container.register("AgentOptions", { callbacks: {} });

      const testAIManager = new AIManager(container, {
        workdir: "/test/workdir",
        stream: false,
      });

      await testAIManager.sendAIMessage();

      const callArgs = vi.mocked(mockHookManager.executeHooks).mock.calls[0][1];
      const task = callArgs.backgroundTasks?.[0];
      expect(task?.command).toBe("a".repeat(1000) + "… [+500 chars]");
      expect(task?.command?.length).toBe(1000 + "… [+500 chars]".length);
    });
  });

  describe("Tool Call Partitioning and Serialization", () => {
    it("should run concurrency-safe tools in parallel and non-safe tools serially", async () => {
      const aiServiceMod = await import("../../src/services/aiService.js");

      let callCount = 0;
      vi.spyOn(aiServiceMod, "callAgent").mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          // Return 4 tool calls: 2 safe (Read, Grep) then 2 non-safe (Edit, Edit)
          return {
            content: "Running tools",
            usage: {
              prompt_tokens: 10,
              completion_tokens: 20,
              total_tokens: 30,
            },
            tool_calls: [
              {
                type: "function" as const,
                id: "call-read",
                function: { name: "Read", arguments: "{}" },
              },
              {
                type: "function" as const,
                id: "call-grep",
                function: { name: "Grep", arguments: "{}" },
              },
              {
                type: "function" as const,
                id: "call-edit-1",
                function: { name: "Edit", arguments: "{}" },
              },
              {
                type: "function" as const,
                id: "call-edit-2",
                function: { name: "Edit", arguments: "{}" },
              },
            ],
          };
        }
        return {
          content: "Done",
          usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
          tool_calls: [],
        };
      });

      // isConcurrencySafe: Read/Grep = true, Edit = false
      vi.mocked(mockToolManager.isConcurrencySafe).mockImplementation(
        (name: string) => name !== "Edit",
      );

      // Track execution intervals
      const intervals: { name: string; start: number; end: number }[] = [];
      vi.mocked(mockToolManager.execute).mockImplementation(
        async (name: string) => {
          const start = Date.now();
          await new Promise((r) => setTimeout(r, 50));
          const end = Date.now();
          intervals.push({ name, start, end });
          return { success: true, content: `${name} done` };
        },
      );

      await aiManager.sendAIMessage({ recursionDepth: 0 });

      // 4 tool executions should have occurred
      expect(intervals).toHaveLength(4);

      // Safe tools (Read, Grep) should overlap (parallel)
      const readInterval = intervals.find((i) => i.name === "Read")!;
      const grepInterval = intervals.find((i) => i.name === "Grep")!;
      expect(readInterval).toBeDefined();
      expect(grepInterval).toBeDefined();
      // They overlap if grep starts before read ends
      expect(grepInterval.start).toBeLessThan(readInterval.end);

      // Non-safe tools (Edit, Edit) should NOT overlap (serial)
      const editIntervals = intervals.filter((i) => i.name === "Edit");
      expect(editIntervals).toHaveLength(2);
      // Second edit starts after first edit ends
      expect(editIntervals[1].start).toBeGreaterThanOrEqual(
        editIntervals[0].end,
      );
    });
  });
});
