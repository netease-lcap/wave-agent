import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
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

vi.mock("node:fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("../../src/utils/gitUtils.js", () => ({
  isGitRepository: vi.fn(),
}));

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
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/utils/messageOperations.js", () => ({}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

describe("AIManager maxTurns", () => {
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

  function createContainer() {
    const container = new Container();
    container.register("ConfigurationService", {
      setOptions: vi.fn(),
      resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
      resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
      resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
      resolveLanguage: vi.fn().mockReturnValue(undefined),
      getEnvironmentVars: vi.fn().mockReturnValue({}),
    });
    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("TaskManager", {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
    } as unknown as TaskManager);
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
    } as unknown as Record<string, unknown>);
    container.register("SubagentManager", {
      getConfigurations: vi.fn().mockReturnValue([]),
    });
    container.register("SkillManager", {
      getAvailableSkills: vi.fn().mockReturnValue([]),
    });
    container.register("NotificationQueue", {
      hasPending: vi.fn().mockReturnValue(false),
    });
    return container;
  }

  beforeEach(() => {
    vi.clearAllMocks();

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
      addErrorBlock: vi.fn(),
      setlatestTotalTokens: vi.fn(),
      saveSession: vi.fn().mockResolvedValue(undefined),
      compactMessagesAndUpdateSession: vi.fn(),
      getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.md"),
      touchFile: vi.fn(),
      finalizeStreamingBlocks: vi.fn(),
    } as unknown as MessageManager;

    mockToolManager = {
      getToolsConfig: vi.fn().mockReturnValue([]),
      getTools: vi.fn().mockReturnValue([]),
      list: vi.fn().mockReturnValue([]),
      execute: vi
        .fn()
        .mockResolvedValue({ success: true, content: "test result" }),
    } as unknown as ToolManager;
  });

  it("should stop recursion when maxTurns is reached", async () => {
    let callCount = 0;
    vi.mocked(aiService.callAgent).mockImplementation(async () => {
      callCount++;
      // Always return tool_calls to trigger infinite recursion
      return {
        content: "Tool response",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [
          {
            type: "function" as const,
            id: `call-${callCount}`,
            function: { name: "test-tool", arguments: "{}" },
          },
        ],
      };
    });

    const container = createContainer();
    const aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
      maxTurns: 2,
    });

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    // maxTurns: 2 means depth 0 + depth 1 = 2 calls, then stopped
    expect(aiService.callAgent).toHaveBeenCalledTimes(2);
  });

  it("should not affect behavior when maxTurns is unset", async () => {
    let callCount = 0;
    vi.mocked(aiService.callAgent).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First call returns tool_calls (triggers recursion)
        return {
          content: "Tool response",
          usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
          tool_calls: [
            {
              type: "function" as const,
              id: "call-1",
              function: { name: "test-tool", arguments: "{}" },
            },
          ],
        };
      }
      // Second call returns no tool_calls (stops recursion naturally)
      return {
        content: "Final response",
        usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
        tool_calls: [],
      };
    });

    const container = createContainer();
    const aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
      // No maxTurns specified
    });

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    // Normal recursion: 2 calls
    expect(aiService.callAgent).toHaveBeenCalledTimes(2);
  });

  it("should stop at exact maxTurns boundary (maxTurns: 1)", async () => {
    vi.mocked(aiService.callAgent).mockImplementation(async () => {
      // Always return tool_calls to trigger recursion
      return {
        content: "Tool response",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [
          {
            type: "function" as const,
            id: "call-1",
            function: { name: "test-tool", arguments: "{}" },
          },
        ],
      };
    });

    const container = createContainer();
    const aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
      maxTurns: 1,
    });

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    // maxTurns: 1 means only the initial call, no recursion
    expect(aiService.callAgent).toHaveBeenCalledTimes(1);
  });

  it("should log when maxTurns stops recursion", async () => {
    vi.mocked(aiService.callAgent).mockImplementation(async () => {
      // Always return tool_calls to trigger recursion
      return {
        content: "Tool response",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [
          {
            type: "function" as const,
            id: "call-1",
            function: { name: "test-tool", arguments: "{}" },
          },
        ],
      };
    });

    const container = createContainer();
    const aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
      maxTurns: 2,
    });

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(logger.debug).toHaveBeenCalledWith(
      expect.stringContaining("Max turns"),
    );
  });
});
