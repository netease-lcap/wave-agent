import { describe, it, expect, vi, beforeEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
import { callAgent } from "../../src/services/aiService.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import type { ToolManager } from "../../src/managers/toolManager.js";
import type { TaskManager } from "../../src/services/taskManager.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { ModManager } from "../../src/managers/modManager.js";

/**
 * `turn.complete`（spec ecosystem/plugin-mods.md「完成与审批的观察」）：mod 只
 * 收到一个只读的「这一轮结束了」通知，用来往自己的服务端上报。
 *
 * 这里钉三件容易做错的事：派发在**释放 loading 之后**（mod 的上报不能把人卡在
 * 「还在回答」状态里）、中断与通知注入重开都只算一轮、子代理的嵌套轮次不算用户
 * 眼里的「答完了」。
 */

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

const REPLY = {
  content: "answer",
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  tool_calls: [],
};

function buildMockMessageManager(): MessageManager {
  return {
    getSessionId: vi.fn().mockReturnValue("test-session-id"),
    getMessages: vi.fn().mockReturnValue([]),
    addAssistantMessage: vi.fn(),
    addUserMessage: vi.fn().mockReturnValue("msg-id"),
    addNotificationMessage: vi.fn(),
    appendCurrentMessageContent: vi.fn(),
    updateToolBlock: vi.fn(),
    mergeAssistantAdditionalFields: vi.fn(),
    setMessages: vi.fn(),
    getLatestTotalTokens: vi.fn().mockReturnValue(0),
    getCombinedMemory: vi.fn().mockResolvedValue(""),
    getMemoryForInjection: vi.fn().mockResolvedValue({ prependContent: "" }),
    processTriggeredRules: vi.fn().mockReturnValue([]),
    addNoticeBlock: vi.fn(),
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

function buildHarness(
  options: { subagentType?: string; withMods?: boolean } = {},
) {
  const { subagentType, withMods = true } = options;
  const container = new Container();
  const messageQueue = new MessageQueue();
  container.register("MessageQueue", messageQueue);
  container.register("ConfigurationService", {
    resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
    resolveContextWindow: vi.fn().mockReturnValue(96000),
    resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
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

  // 观测顺序用：loading 的两次翻转与 mod 事件落在同一个序列里，才能钉住「先
  // 回到可输入状态，再通知 mod」。
  const events: string[] = [];
  const notifyMods = vi.fn((event: string) => {
    events.push(`mods:${event}`);
  });
  if (withMods) {
    container.register("ModManager", { notifyMods } as unknown as ModManager);
  }
  container.register("AgentOptions", {
    callbacks: {
      onLoadingChange: (loading: boolean) => events.push(`loading:${loading}`),
    },
  });

  const aiManager = new AIManager(container, {
    workdir: "/test/workdir",
    stream: false,
    subagentType,
  });
  return { aiManager, messageQueue, messageManager, notifyMods, events };
}

describe("AIManager 的 turn.complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("答完时派发一次，且在 loading 释放之后", async () => {
    const { aiManager, notifyMods, events } = buildHarness();
    vi.mocked(callAgent).mockResolvedValue(REPLY);

    await aiManager.sendAIMessage();

    expect(notifyMods).toHaveBeenCalledTimes(1);
    expect(notifyMods).toHaveBeenCalledWith("turn.complete", {
      isAborted: false,
      durationMs: expect.any(Number),
      answer: "",
      usage: { prompt: 1, completion: 1, cacheRead: 0, cacheCreation: 0 },
    });
    expect(events).toEqual([
      "loading:true",
      "loading:false",
      "mods:turn.complete",
    ]);
  });

  it("被中断的轮次报 isAborted: true，同样只一次", async () => {
    const { aiManager, notifyMods } = buildHarness();
    vi.mocked(callAgent).mockImplementation(
      async (options) =>
        new Promise<Awaited<ReturnType<typeof callAgent>>>(
          (_resolve, reject) => {
            options.abortSignal?.addEventListener(
              "abort",
              () => reject(new Error("Aborted")),
              { once: true },
            );
          },
        ),
    );

    const sendPromise = aiManager.sendAIMessage();
    await vi.waitFor(() => expect(callAgent).toHaveBeenCalledTimes(1));
    aiManager.abortAIMessage();
    await sendPromise;

    expect(notifyMods).toHaveBeenCalledTimes(1);
    expect(notifyMods).toHaveBeenCalledWith("turn.complete", {
      isAborted: true,
      durationMs: expect.any(Number),
      answer: "",
      usage: { prompt: 0, completion: 0, cacheRead: 0, cacheCreation: 0 },
    });
  });

  it("注入通知把循环重开一次时仍算同一轮，只派发一次", async () => {
    const { aiManager, messageQueue, notifyMods } = buildHarness();
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
        return new Promise<Awaited<ReturnType<typeof callAgent>>>((resolve) => {
          resolveFirstCall = resolve;
        });
      }
      if (callNumber === 2) {
        return new Promise<Awaited<ReturnType<typeof callAgent>>>((resolve) => {
          resolveSecondCall = resolve;
        });
      }
      return REPLY;
    });

    const sendPromise = aiManager.sendAIMessage();
    await vi.waitFor(() => expect(mockCallAgent).toHaveBeenCalledTimes(1));
    messageQueue.enqueueNotification(NOTIFICATION_XML);
    resolveFirstCall!(REPLY);

    await vi.waitFor(() =>
      expect(mockCallAgent.mock.calls.length).toBeGreaterThanOrEqual(2),
    );
    // 重开的那一段还没结束：一次都不该派发。
    expect(notifyMods).not.toHaveBeenCalled();

    resolveSecondCall!(REPLY);
    await sendPromise;

    expect(notifyMods).toHaveBeenCalledTimes(1);
    // 两次请求都算进这一轮：重开不是新的一轮，用量也不该从头再算。
    expect(notifyMods).toHaveBeenCalledWith("turn.complete", {
      isAborted: false,
      durationMs: expect.any(Number),
      answer: "",
      usage: { prompt: 2, completion: 2, cacheRead: 0, cacheCreation: 0 },
    });
  });

  it("answer 取最后一条 assistant 消息的正文", async () => {
    const { aiManager, notifyMods, messageManager } = buildHarness();
    vi.mocked(callAgent).mockResolvedValue(REPLY);
    vi.mocked(messageManager.getMessages).mockReturnValue([
      {
        id: "m1",
        role: "user",
        blocks: [{ type: "text", content: "问题" }],
        timestamp: "2026-08-19T00:00:00.000Z",
      },
      {
        id: "m2",
        role: "assistant",
        blocks: [
          { type: "text", content: "第一段" },
          { type: "text", content: "第二段" },
        ],
        timestamp: "2026-08-19T00:00:01.000Z",
      },
    ] as unknown as ReturnType<typeof messageManager.getMessages>);

    await aiManager.sendAIMessage();

    expect(notifyMods).toHaveBeenCalledWith(
      "turn.complete",
      expect.objectContaining({ answer: "第一段\n第二段" }),
    );
  });

  it("子代理的嵌套轮次不派发（用户眼里这一轮还没答完）", async () => {
    const { aiManager, notifyMods } = buildHarness({
      subagentType: "general-purpose",
    });
    vi.mocked(callAgent).mockResolvedValue(REPLY);

    await aiManager.sendAIMessage();

    expect(notifyMods).not.toHaveBeenCalled();
  });

  it("容器里没有 ModManager 时不抛错", async () => {
    const { aiManager } = buildHarness({ withMods: false });
    vi.mocked(callAgent).mockResolvedValue(REPLY);

    await expect(aiManager.sendAIMessage()).resolves.toBeUndefined();
  });
});
