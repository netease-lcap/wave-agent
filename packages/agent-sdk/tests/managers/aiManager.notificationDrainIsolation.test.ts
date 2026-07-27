import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
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

// callAgent returns a no-tool response so sendAIMessage completes exactly one
// turn and reaches the end-of-turn notification-drain block.
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

function buildMockMessageManager(): MessageManager {
  return {
    getSessionId: vi.fn().mockReturnValue("test-session-id"),
    getMessages: vi.fn().mockReturnValue([]),
    addAssistantMessage: vi.fn(),
    addUserMessage: vi.fn().mockImplementation(function (this: MessageManager) {
      // no-op
      return "msg-id";
    }),
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

/**
 * Build a real AIManager whose `this.container` is a CHILD of a parent container
 * that owns `parentQueue` (pre-loaded with a sibling notification). When
 * `withLocalQueue` is true a local (empty) MessageQueue is registered on the
 * child — mirroring the post-fix createInstance() wiring, so the child resolves
 * its own queue and never touches the parent's. When false, the child has no
 * local queue, so `get("MessageQueue")` falls back to the parent — mirroring the
 * pre-fix behaviour where sibling notifications were stolen.
 */
function buildChildAIManager({ withLocalQueue }: { withLocalQueue: boolean }) {
  const parentQueue = new MessageQueue();
  parentQueue.enqueueNotification(
    "<task-notification><task-id>sibling-A</task-id></task-notification>",
  );
  const drainSpy = vi.spyOn(parentQueue, "drainNotifications");

  const parentContainer = new Container();
  parentContainer.register("MessageQueue", parentQueue);

  const child = parentContainer.createChild();
  child.register("ConfigurationService", {
    resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
    resolveMaxInputTokens: vi.fn().mockReturnValue(96000),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
    resolveLanguage: vi.fn().mockReturnValue(undefined),
  });
  child.register("MessageManager", buildMockMessageManager());
  child.register("ToolManager", buildMockToolManager());
  child.register("TaskManager", {
    on: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
  } as unknown as TaskManager);
  child.register("MemoryService", {
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  });
  child.register("PermissionManager", {
    getCurrentEffectiveMode: vi.fn().mockReturnValue("normal"),
    clearTemporaryRules: vi.fn(),
    getPlanFilePath: vi.fn().mockReturnValue(undefined),
    setHasExitedPlanMode: vi.fn(),
    hasExitedPlanModeInSession: vi.fn(() => false),
    setNeedsPlanModeExitAttachment: vi.fn(),
    getNeedsPlanModeExitAttachment: vi.fn(() => false),
  });
  child.register("SubagentManager", {
    getConfigurations: vi.fn().mockReturnValue([]),
  });
  child.register("SkillManager", {
    getAvailableSkills: vi.fn().mockReturnValue([]),
  });
  child.register("AgentOptions", { callbacks: {} });
  if (withLocalQueue) {
    child.register("MessageQueue", new MessageQueue());
  }

  const aiManager = new AIManager(child, {
    workdir: "/test/workdir",
    stream: false,
    subagentType: "explore",
  });
  return { aiManager, parentQueue, drainSpy };
}

describe("AIManager notification drain isolation (FR-043/FR-044)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does NOT drain the parent queue when the subagent has its own MessageQueue (post-fix)", async () => {
    const { aiManager, parentQueue, drainSpy } = buildChildAIManager({
      withLocalQueue: true,
    });

    await aiManager.sendAIMessage();

    // The sibling notification must remain in the parent queue, untouched.
    expect(drainSpy).not.toHaveBeenCalled();
    expect(parentQueue.hasNotifications()).toBe(true);
  });

  it("drains the parent queue via fallback when the subagent has no local MessageQueue (pre-fix harness)", async () => {
    const { aiManager, parentQueue, drainSpy } = buildChildAIManager({
      withLocalQueue: false,
    });

    await aiManager.sendAIMessage();

    // Confirms the harness actually exercises the fallback/drain path: without
    // a local queue the subagent steals the parent's notification.
    expect(drainSpy).toHaveBeenCalled();
    expect(parentQueue.hasNotifications()).toBe(false);
  });
});
