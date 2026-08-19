import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import * as aiService from "../../src/services/aiService.js";
import { persistToolImages } from "../../src/utils/toolImagePersistence.js";

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

// Mock the image persistence util so the unit-level file writes are isolated
// in tests/utils/toolImagePersistence.test.ts
vi.mock("../../src/utils/toolImagePersistence.js", () => ({
  persistToolImages: vi.fn((images) =>
    images.map((image: { data: string }) => ({
      ...image,
      path: `/tmp/wave-mcp-images/mcp-image_1_abc123.png`,
    })),
  ),
}));

const mockImages = [{ data: "aGVsbG8=", mediaType: "image/png" }];

function createAIManager(modelConfig: ModelConfig) {
  const container = new Container();

  const mockMessageManager = {
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

  const mockToolManager = {
    getToolsConfig: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
    execute: vi.fn().mockResolvedValue({
      success: true,
      content: "test result",
      images: mockImages,
    }),
    isConcurrencySafe: vi.fn().mockReturnValue(true),
  } as unknown as ToolManager;

  const taskManager = {
    on: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
  } as unknown as TaskManager;

  const mockConfigurationService = {
    setOptions: vi.fn(),
    resolveGatewayConfig: vi.fn().mockReturnValue({
      apiKey: "test-api-key",
      baseURL: "https://test-gateway.com",
    } as GatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(modelConfig),
    resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
    resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
    resolveLanguage: vi.fn().mockReturnValue(undefined),
    getEnvironmentVars: vi.fn().mockReturnValue({}),
  };

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
  container.register("SubagentManager", {
    getConfigurations: vi.fn().mockReturnValue([]),
  });
  container.register("SkillManager", {
    getAvailableSkills: vi.fn().mockReturnValue([]),
  });
  container.register("MessageQueue", {
    hasNotifications: vi.fn().mockReturnValue(false),
    drainNotifications: vi.fn().mockReturnValue([]),
  });

  const aiManager = new AIManager(container, {
    workdir: "/test/workdir",
    stream: false,
  });

  // Mock addUserMessage to save session (simulating real behavior)
  vi.mocked(mockMessageManager.addUserMessage).mockImplementation(() => {
    mockMessageManager.saveSession();
    return "msg-id";
  });

  return { aiManager, mockMessageManager, mockToolManager };
}

function triggerToolExecution() {
  let callCount = 0;
  vi.mocked(aiService.callAgent).mockImplementation(async () => {
    callCount++;
    if (callCount === 1) {
      return {
        content: "Test response with tools",
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
        tool_calls: [
          {
            type: "function" as const,
            id: "test-tool-call",
            function: { name: "test-tool", arguments: "{}" },
          },
        ],
      };
    }
    return {
      content: "Test response without tools",
      usage: { prompt_tokens: 5, completion_tokens: 10, total_tokens: 15 },
      tool_calls: [],
    };
  });
}

describe("AIManager MCP image persistence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should persist tool images when the model does not support vision", async () => {
    const { aiManager, mockMessageManager } = createAIManager({
      model: "test-agent-model",
      fastModel: "test-fast-model",
      capabilities: { vision: false },
    });
    triggerToolExecution();

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(persistToolImages).toHaveBeenCalledWith(mockImages);
    const updateCall = vi
      .mocked(mockMessageManager.updateToolBlock)
      .mock.calls.find((call) => call[0].stage === "end");
    expect(updateCall).toBeDefined();
    expect(updateCall![0].images).toEqual([
      {
        data: "aGVsbG8=",
        mediaType: "image/png",
        path: "/tmp/wave-mcp-images/mcp-image_1_abc123.png",
      },
    ]);
  });

  it("should not persist tool images when the model supports vision (default)", async () => {
    const { aiManager, mockMessageManager } = createAIManager({
      model: "test-agent-model",
      fastModel: "test-fast-model",
    });
    triggerToolExecution();

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(persistToolImages).not.toHaveBeenCalled();
    const updateCall = vi
      .mocked(mockMessageManager.updateToolBlock)
      .mock.calls.find((call) => call[0].stage === "end");
    expect(updateCall).toBeDefined();
    expect(updateCall![0].images).toEqual(mockImages);
  });

  it("should not call persistToolImages when the tool result has no images", async () => {
    const { aiManager, mockToolManager } = createAIManager({
      model: "test-agent-model",
      fastModel: "test-fast-model",
      capabilities: { vision: false },
    });
    vi.mocked(mockToolManager.execute).mockResolvedValue({
      success: true,
      content: "test result",
    });
    triggerToolExecution();

    await aiManager.sendAIMessage({ recursionDepth: 0 });

    expect(persistToolImages).not.toHaveBeenCalled();
  });
});
