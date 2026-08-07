import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
import { callAgent } from "../../src/services/aiService.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { TaskManager } from "../../src/services/taskManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";

vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("node:fs", () => ({ existsSync: vi.fn() }));
vi.mock("../../src/utils/gitUtils.js", () => ({ isGitRepository: vi.fn() }));

vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn(),
  compactMessages: vi.fn().mockResolvedValue({
    content: "Compacted content",
    usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
  }),
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
  convertMessagesForAPI: vi.fn().mockReturnValue([]),
}));

const mockGatewayConfig: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "https://test-gateway.com",
};

const mockModelConfig: ModelConfig = {
  model: "test-agent-model",
  fastModel: "test-fast-model",
};

const NOTIFICATION_XML =
  "<task-notification><task-id>bg-1</task-id><task-type>shell</task-type><status>completed</status><summary>Done</summary></task-notification>";

function buildMockMessageManager(): MessageManager {
  return {
    getSessionId: vi.fn().mockReturnValue("test-session-id"),
    getMessages: vi.fn().mockReturnValue([]),
    addAssistantMessage: vi.fn(),
    addUserMessage: vi.fn().mockReturnValue("msg-id"),
    addNotificationMessage: vi.fn(),
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
}

function buildMockToolManager(): ToolManager {
  return {
    getToolsConfig: vi.fn().mockReturnValue([]),
    getTools: vi.fn().mockReturnValue([]),
    list: vi.fn().mockReturnValue([]),
    execute: vi
      .fn()
      .mockResolvedValue({ success: true, content: "test result" }),
    isConcurrencySafe: vi.fn().mockReturnValue(true),
  } as unknown as ToolManager;
}

function buildHarness(loadingCalls: boolean[]) {
  const container = new Container();
  const messageQueue = new MessageQueue();
  container.register("MessageQueue", messageQueue);
  container.register("ConfigurationService", {
    resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
    resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
    resolveLanguage: vi.fn().mockReturnValue(undefined),
  });
  const messageManager = buildMockMessageManager();
  container.register("MessageManager", messageManager);
  container.register("ToolManager", buildMockToolManager());
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
    setHasExitedPlanMode: vi.fn(),
    hasExitedPlanModeInSession: vi.fn(() => false),
    setNeedsPlanModeExitAttachment: vi.fn(),
    getNeedsPlanModeExitAttachment: vi.fn(() => false),
  });
  container.register("SubagentManager", {
    getConfigurations: vi.fn().mockReturnValue([]),
  });
  container.register("SkillManager", {
    getAvailableSkills: vi.fn().mockReturnValue([]),
  });
  container.register("AgentOptions", {
    callbacks: {
      onLoadingChange: (loading: boolean) => loadingCalls.push(loading),
    },
  });

  const aiManager = new AIManager(container, {
    workdir: "/test/workdir",
    stream: false,
  });
  return { aiManager, messageQueue, messageManager };
}

describe("AIManager abort with queued notification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not resurrect an aborted turn via a queued notification", async () => {
    const loadingCalls: boolean[] = [];
    const { aiManager, messageQueue } = buildHarness(loadingCalls);

    const mockCallAgent = vi.mocked(callAgent);
    mockCallAgent.mockImplementation(async (options) => {
      // First turn: hang until the abort signal fires
      return new Promise<Awaited<ReturnType<typeof callAgent>>>(
        (_resolve, reject) => {
          options.abortSignal?.addEventListener(
            "abort",
            () => reject(new Error("Aborted")),
            { once: true },
          );
        },
      );
    });

    const sendPromise = aiManager.sendAIMessage();
    await vi.waitFor(() => expect(mockCallAgent).toHaveBeenCalledTimes(1));
    expect(aiManager.isLoading).toBe(true);

    // Background notification arrives while the turn is running, then abort
    messageQueue.enqueueNotification(NOTIFICATION_XML);
    aiManager.abortAIMessage();
    expect(aiManager.isLoading).toBe(false);

    // The aborted turn unwinds and ends — it must NOT fold the queued
    // notification in and restart itself (that would resurrect the turn the
    // user just interrupted and spawn a second, uninterruptible agent loop).
    await sendPromise;
    await vi.waitFor(() => expect(mockCallAgent).toHaveBeenCalledTimes(1));

    // The notification stays queued for the next user-initiated turn.
    expect(messageQueue.hasNotifications()).toBe(true);
    expect(aiManager.isLoading).toBe(false);
    expect(loadingCalls).toEqual([true, false]);
  });

  it("folds queued notifications into the next turn on normal completion", async () => {
    const loadingCalls: boolean[] = [];
    const { aiManager, messageQueue, messageManager } =
      buildHarness(loadingCalls);

    const mockCallAgent = vi.mocked(callAgent);
    let resolveFirstCall:
      | ((value: Awaited<ReturnType<typeof callAgent>>) => void)
      | undefined;
    let resolveSecondCall:
      | ((value: Awaited<ReturnType<typeof callAgent>>) => void)
      | undefined;
    mockCallAgent.mockImplementation(async () => {
      const callNumber = mockCallAgent.mock.calls.length;
      if (callNumber === 1) {
        // First turn: hold until the test enqueues the notification and
        // releases it, so the notification is pending when the turn ends
        return new Promise<Awaited<ReturnType<typeof callAgent>>>((resolve) => {
          resolveFirstCall = resolve;
        });
      }
      if (callNumber === 2) {
        // Continued turn: hold until the test releases it
        return new Promise<Awaited<ReturnType<typeof callAgent>>>((resolve) => {
          resolveSecondCall = resolve;
        });
      }
      return {
        content: "extra",
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        tool_calls: [],
      };
    });

    const sendPromise = aiManager.sendAIMessage();
    await vi.waitFor(() => expect(mockCallAgent).toHaveBeenCalledTimes(1));

    // Background notification arrives while the (non-aborted) turn is running
    messageQueue.enqueueNotification(NOTIFICATION_XML);

    // First turn completes normally
    resolveFirstCall!({
      content: "first turn",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      tool_calls: [],
    });

    // The turn drains the queued notification and continues the conversation
    // in a restarted loop iteration — loading stays active across the restart
    // so the webview keeps showing the streaming cursor / stop button.
    await vi.waitFor(() =>
      expect(mockCallAgent.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    expect(aiManager.isLoading).toBe(true);
    expect(loadingCalls).toEqual([true, true]);

    // Let the continued turn finish
    resolveSecondCall!({
      content: "Background task acknowledged",
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      tool_calls: [],
    });
    await sendPromise;

    // End-of-turn cleanup must release the loading state
    expect(aiManager.isLoading).toBe(false);
    expect(loadingCalls).toEqual([true, true, false]);
    expect(messageManager.addNotificationMessage).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: "bg-1" }),
    );
  });
});
