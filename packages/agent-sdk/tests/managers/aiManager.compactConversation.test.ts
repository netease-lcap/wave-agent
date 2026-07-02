import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
import type { HookManager } from "../../src/managers/hookManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";

const { compactMessagesMock } = vi.hoisted(() => ({
  compactMessagesMock: vi.fn().mockResolvedValue({
    content: "Compacted content",
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
}));

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

vi.mock("node:fs/promises", () => ({
  default: { access: vi.fn() },
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
  compactMessages: compactMessagesMock,
  isClaudeModel: vi.fn().mockReturnValue(false),
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
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

vi.mock("../../src/utils/messageOperations.js", () => ({}));

vi.mock("../../src/utils/convertMessagesForAPI.js", () => ({
  convertMessagesForAPI: vi
    .fn()
    .mockReturnValue([{ role: "user", content: "hello" }]),
}));

vi.mock("../../src/telemetry/events.js", () => ({
  logOTelEvent: vi.fn().mockResolvedValue(undefined),
}));

describe("AIManager - compactConversation", () => {
  let aiManager: AIManager;
  let mockMessageManager: MessageManager;
  let mockHookManager: HookManager;

  const mockGatewayConfig: GatewayConfig = {
    apiKey: "test-api-key",
    baseURL: "https://test-gateway.com",
  };

  const mockModelConfig: ModelConfig = {
    model: "test-agent-model",
    fastModel: "test-fast-model",
    maxTokens: 4096,
    permissionMode: "default",
  };

  beforeEach(() => {
    vi.clearAllMocks();

    // Re-establish mock implementations after clearAllMocks
    compactMessagesMock.mockResolvedValue({
      content: "Compacted content",
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    });

    const container = new Container();

    mockMessageManager = {
      getMessages: vi.fn().mockReturnValue([{ role: "user", blocks: [] }]),
      getSessionId: vi.fn().mockReturnValue("test-session-id"),
      getTranscriptPath: vi.fn().mockReturnValue("/test/transcript.json"),
      saveSession: vi.fn().mockResolvedValue(undefined),
      compactMessagesAndUpdateSession: vi.fn(),
      addErrorBlock: vi.fn(),
      addUserMessage: vi.fn(),
      getRecentFileReads: vi.fn().mockReturnValue([]),
      getInvokedSkillNames: vi.fn().mockReturnValue([]),
      setlatestTotalTokens: vi.fn(),
    } as unknown as MessageManager;

    mockHookManager = {
      executePreCompactHooks: vi.fn().mockResolvedValue({
        results: [],
        additionalInstructions: undefined,
      }),
      executePostCompactHooks: vi.fn().mockResolvedValue([]),
      executeSessionStartHooks: vi.fn().mockResolvedValue({
        results: [],
        additionalContext: undefined,
        initialUserMessage: undefined,
      }),
    } as unknown as HookManager;

    const mockToolManager = {
      list: vi.fn().mockReturnValue([]),
      get: vi.fn(),
    } as unknown as ToolManager;

    const mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
      getPlanFilePath: vi.fn().mockReturnValue(undefined),
    } as unknown as PermissionManager;

    container.register("MessageManager", mockMessageManager);
    container.register("ToolManager", mockToolManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register("HookManager", mockHookManager);
    container.register("BackgroundTaskManager", {
      getAllTasks: vi.fn().mockReturnValue([]),
    });
    container.register("SubagentManager", {});
    container.register("SkillManager", undefined);
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
      ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
      getAutoMemoryContent: vi.fn().mockResolvedValue(""),
    });
    container.register("TaskManager", { syncWithSession: vi.fn() });
    container.register("MergedEnv", { PATH: "/usr/bin" });
    container.register("ConfigurationService", {
      resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
      resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
      resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
    });

    aiManager = new AIManager(container, {
      workdir: "/test/workdir",
      stream: false,
      callbacks: {
        onCompactionStateChange: vi.fn(),
        onUsageAdded: vi.fn(),
      },
    });
  });

  it("should call compactMessages and compactMessagesAndUpdateSession", async () => {
    await aiManager.compactConversation();

    expect(compactMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gatewayConfig: mockGatewayConfig,
        modelConfig: mockModelConfig,
        model: "test-fast-model",
      }),
    );
    expect(
      mockMessageManager.compactMessagesAndUpdateSession,
    ).toHaveBeenCalled();
  });

  it("should pass custom instructions to compactMessages", async () => {
    await aiManager.compactConversation({
      customInstructions: "Focus on the bug fix discussion",
    });

    expect(compactMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customInstructions: "Focus on the bug fix discussion",
      }),
    );
  });

  it("should fire PreCompact hooks before compaction", async () => {
    await aiManager.compactConversation({
      customInstructions: "user instructions",
    });

    expect(mockHookManager.executePreCompactHooks).toHaveBeenCalledWith(
      "test-session-id",
      "/test/transcript.json",
      "user instructions",
    );
  });

  it("should merge PreCompact hook stdout into custom instructions", async () => {
    vi.mocked(mockHookManager.executePreCompactHooks).mockResolvedValueOnce({
      results: [],
      additionalInstructions: "hook instructions",
    });

    await aiManager.compactConversation({
      customInstructions: "user instructions",
    });

    expect(compactMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        customInstructions: "user instructions\nhook instructions",
      }),
    );
  });

  it("should fire PostCompact hooks after compaction", async () => {
    await aiManager.compactConversation();

    expect(mockHookManager.executePostCompactHooks).toHaveBeenCalledWith(
      "test-session-id",
      "/test/transcript.json",
      "Compacted content",
    );
  });

  it("should fire SessionStart hooks with source='compact'", async () => {
    await aiManager.compactConversation();

    expect(mockHookManager.executeSessionStartHooks).toHaveBeenCalledWith(
      "compact",
      "test-session-id",
      "/test/transcript.json",
      undefined,
    );
  });

  it("should skip if already compacting", async () => {
    let resolveFirst: () => void;
    const firstCompact = new Promise<void>(
      (resolve) => (resolveFirst = resolve),
    );
    compactMessagesMock.mockImplementationOnce(async () => {
      await firstCompact;
      return { content: "compacted", usage: undefined };
    });

    const firstCall = aiManager.compactConversation();

    // Wait for the first compaction to actually start (isCompacting = true)
    await vi.waitFor(() => {
      expect(aiManager.getIsCompacting()).toBe(true);
    });

    // Try a second compaction while the first is running - should be skipped
    await aiManager.compactConversation();

    // Only one compactMessages call should have happened
    expect(compactMessagesMock).toHaveBeenCalledTimes(1);

    resolveFirst!();
    await firstCall;
  });

  it("should return early when messages are empty", async () => {
    vi.mocked(mockMessageManager.getMessages).mockReturnValueOnce([]);

    await aiManager.compactConversation();

    expect(compactMessagesMock).not.toHaveBeenCalled();
  });

  it("should increment consecutiveCompactionFailures and add error block on failure", async () => {
    compactMessagesMock.mockRejectedValueOnce(new Error("API error"));

    await aiManager.compactConversation();

    expect(mockMessageManager.addErrorBlock).toHaveBeenCalledWith(
      expect.stringContaining("Failed to compact conversation history"),
    );
  });
});
