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
  options: {
    subagentType?: string;
    withMods?: boolean;
    /** `turn.step` 上那个 mod 的答复：默认原样带回来（没人改模型）。 */
    onTurnStep?: (event: {
      turnId: string;
      index: number;
      messageCount: number;
      model: string;
    }) => { model?: string } | void;
  } = {},
) {
  const { subagentType, withMods = true } = options;
  const container = new Container();
  const messageQueue = new MessageQueue();
  container.register("MessageQueue", messageQueue);
  const configurationService = {
    resolveGatewayConfig: vi.fn().mockReturnValue(mockGatewayConfig),
    resolveModelConfig: vi.fn().mockReturnValue(mockModelConfig),
    resolveContextWindow: vi.fn().mockReturnValue(96000),
    resolveMaxOutputTokens: vi.fn().mockReturnValue(4096),
    resolveAutoMemoryEnabled: vi.fn().mockReturnValue(true),
    resolveLanguage: vi.fn().mockReturnValue(undefined),
  };
  container.register("ConfigurationService", configurationService);
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
  // `classic.Stop` 走的是要等返回值的 `collectStopContext`（spec「一轮收尾时的
  // 非错误反馈」）：默认「没人说话」，这一轮照常收尾。
  const collectStopContext = vi.fn(async () => {
    events.push("mods:classic.Stop");
    return [] as string[];
  });
  // `turn.step` 是生成器事件，宿主等它答完才知道这次请求用哪个模型：没人改就
  // 原样带回来。
  const dispatchTurnStep = vi.fn(
    async (event: { turnId: string; model: string }) => {
      events.push("mods:turn.step");
      const patched = options.onTurnStep?.(event as never);
      return patched ? { ...event, ...patched } : event;
    },
  );
  if (withMods) {
    container.register("ModManager", {
      notifyMods,
      collectStopContext,
      dispatchTurnStep,
      // 提示词类钩子原样放行 = 「没有插件改东西」，与不挂 ModManager 时同形。
      collectPromptSections: vi.fn(async (sections) => sections),
      collectPromptSection: vi.fn(async (section) => section.text),
      collectSessionContextBlocks: vi.fn(async () => []),
      rewritePromptAttachment: vi.fn(async (attachment) => attachment.text),
    } as unknown as ModManager);
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
  return {
    aiManager,
    messageQueue,
    messageManager,
    notifyMods,
    collectStopContext,
    dispatchTurnStep,
    configurationService,
    events,
  };
}

/**
 * 按事件名取载荷：同一轮除 `turn.complete` 还会发 `turn.start` / `turn.step`，
 * 「只发一次」的断言必须落在具体事件上，否则数到的是这一整轮的所有事件。
 */
function modCalls(
  notifyMods: ReturnType<typeof vi.fn>,
  event: string,
): unknown[] {
  return notifyMods.mock.calls
    .filter((call) => call[0] === event)
    .map((call) => call[1]);
}

/** `turn.step` 的载荷（它走的是要等返回值的 `dispatchTurnStep`）。 */
function stepCalls(dispatchTurnStep: ReturnType<typeof vi.fn>): unknown[] {
  return dispatchTurnStep.mock.calls.map((call) => call[0]);
}

describe("AIManager 的 turn.complete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("答完时派发一次，且在 loading 释放之后", async () => {
    const { aiManager, notifyMods, dispatchTurnStep, events } = buildHarness();
    vi.mocked(callAgent).mockResolvedValue(REPLY);

    await aiManager.sendAIMessage();

    expect(modCalls(notifyMods, "turn.complete")).toHaveLength(1);
    expect(notifyMods).toHaveBeenCalledWith("turn.complete", {
      turnId: expect.any(String),
      isAborted: false,
      durationMs: expect.any(Number),
      answer: "",
      usage: { prompt: 1, completion: 1, cacheRead: 0, cacheCreation: 0 },
    });
    // 一轮一条 turn.start、每个请求一条 turn.step（step 从 0 起数）。
    expect(modCalls(notifyMods, "turn.start")).toEqual([
      { turnId: expect.any(String) },
    ]);
    expect(stepCalls(dispatchTurnStep)).toEqual([
      {
        turnId: expect.any(String),
        index: 0,
        messageCount: 0,
        model: mockModelConfig.model,
      },
    ]);
    expect(events).toEqual([
      "loading:true",
      "mods:turn.start",
      "mods:turn.step",
      "mods:session.measure",
      // `classic.Stop` 要拿返回值才知道这一轮算不算收尾，所以它在释放 loading
      // 之前、`turn.complete` 之前发（spec「一轮收尾时的非错误反馈」）。
      "mods:classic.Stop",
      "loading:false",
      "mods:turn.complete",
    ]);
  });

  it("同一轮里 turn.start / turn.step / turn.complete 用同一个 turnId，两轮各不相同", async () => {
    // `$.turn.abort({ turnId })` 就是拿这个 id 认「要收的是哪一轮」（spec
    // 「`$.turn`」），所以一轮之内必须稳定、跨轮必须不同。
    const { aiManager, notifyMods, dispatchTurnStep } = buildHarness();
    vi.mocked(callAgent).mockResolvedValue(REPLY);

    await aiManager.sendAIMessage();
    await aiManager.sendAIMessage();

    const ids = (event: string) =>
      (modCalls(notifyMods, event) as { turnId: string }[]).map(
        (payload) => payload.turnId,
      );
    const stepIds = stepCalls(dispatchTurnStep).map(
      (payload) => (payload as { turnId: string }).turnId,
    );
    const [first, second] = ids("turn.start");
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    expect(stepIds).toEqual([first, second]);
    expect(ids("turn.complete")).toEqual([first, second]);
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

    expect(modCalls(notifyMods, "turn.complete")).toHaveLength(1);
    expect(notifyMods).toHaveBeenCalledWith("turn.complete", {
      turnId: expect.any(String),
      isAborted: true,
      durationMs: expect.any(Number),
      answer: "",
      usage: { prompt: 0, completion: 0, cacheRead: 0, cacheCreation: 0 },
    });
  });

  it("影子事件 classic.Stop：答完/中断都发，在 turn.complete 之前", async () => {
    // spec「影子事件」：`classic.Stop` 是「这一轮可能要收尾了」的镜像，因为插件
    // 可以返回 `additionalContext` 要求续跑，宿主必须先拿到返回值才知道这一轮算
    // 不算真的结束 —— 所以它在 `turn.complete` **之前**发；`background_tasks` 是
    // 还在跑的后台任务（没有时 `[]`）。
    const { aiManager, collectStopContext, notifyMods } = buildHarness();
    vi.mocked(callAgent).mockResolvedValue(REPLY);

    await aiManager.sendAIMessage();

    expect(collectStopContext).toHaveBeenCalledWith({
      background_tasks: [],
      stop_hook_active: false,
    });
    expect(modCalls(notifyMods, "classic.Stop")).toEqual([]);
    expect(modCalls(notifyMods, "classic.StopFailure")).toEqual([]);
    expect(modCalls(notifyMods, "turn.complete")).toHaveLength(1);
  });

  it("影子事件 classic.Stop：已经有答案时把最后一条正文一起交出去", async () => {
    // CC 同名字段 `last_assistant_message`：插件（hud 这类）不必自己去读转录解
    // JSONL。中断的一轮可能没有答案，那时字段整个省略。
    const { aiManager, collectStopContext, messageManager } = buildHarness();
    vi.mocked(callAgent).mockResolvedValue(REPLY);
    vi.mocked(messageManager.getMessages).mockReturnValue([
      {
        id: "m1",
        role: "assistant",
        blocks: [{ type: "text", content: "改好了，测试也过了" }],
        timestamp: "2026-08-19T00:00:00.000Z",
      },
    ] as unknown as ReturnType<typeof messageManager.getMessages>);

    await aiManager.sendAIMessage();

    expect(collectStopContext).toHaveBeenCalledWith({
      background_tasks: [],
      stop_hook_active: false,
      last_assistant_message: "改好了，测试也过了",
    });
  });

  it("影子事件 classic.StopFailure：因错误结束的一轮只发它，kind 取错误分类", async () => {
    const { aiManager, notifyMods } = buildHarness();
    vi.mocked(callAgent).mockRejectedValue(
      Object.assign(new Error("rate limited"), { status: 429 }),
    );

    await aiManager.sendAIMessage();

    expect(modCalls(notifyMods, "classic.Stop")).toEqual([]);
    expect(modCalls(notifyMods, "classic.StopFailure")).toEqual([
      { error: { kind: "rate_limit", message: "rate limited" } },
    ]);
  });

  it("注入通知把循环重开一次时仍算同一轮，只派发一次", async () => {
    const { aiManager, messageQueue, notifyMods, dispatchTurnStep } =
      buildHarness();
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
    // 重开的那一段还没结束：`turn.complete` 一次都不该派发。
    expect(modCalls(notifyMods, "turn.complete")).toEqual([]);

    resolveSecondCall!(REPLY);
    await sendPromise;

    expect(modCalls(notifyMods, "turn.complete")).toHaveLength(1);
    // 两次请求都算进这一轮：重开不是新的一轮，用量也不该从头再算；步数倒是
    // 一步一步往上走（index 1 表示这一轮的第 2 次请求）。
    expect(
      stepCalls(dispatchTurnStep).map(
        (payload) => (payload as { index: number }).index,
      ),
    ).toEqual([0, 1]);
    expect(notifyMods).toHaveBeenCalledWith("turn.complete", {
      turnId: expect.any(String),
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

describe("AIManager 的 session.measure", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("一次带 usage 的响应发一次，载荷只有 changed", async () => {
    const { aiManager, notifyMods } = buildHarness();
    vi.mocked(callAgent).mockResolvedValue(REPLY);

    await aiManager.sendAIMessage();

    // 其余字段（context / tokens / startedAt / rateLimits）由 ModManager 用它
    // 自己的数据源补齐 —— AIManager 只报「刚量到一次」。
    expect(modCalls(notifyMods, "session.measure")).toEqual([
      { changed: ["context", "tokens"] },
    ]);
  });

  it("响应里没有 usage 时不发（没量到东西）", async () => {
    const { aiManager, notifyMods } = buildHarness();
    vi.mocked(callAgent).mockResolvedValue({ ...REPLY, usage: undefined });

    await aiManager.sendAIMessage();

    expect(modCalls(notifyMods, "session.measure")).toEqual([]);
  });

  it("子代理的嵌套轮次不报（mod 只关心主会话）", async () => {
    const { aiManager, notifyMods } = buildHarness({
      subagentType: "general-purpose",
    });
    vi.mocked(callAgent).mockResolvedValue(REPLY);

    await aiManager.sendAIMessage();

    expect(modCalls(notifyMods, "session.measure")).toEqual([]);
  });
});

describe("AIManager 的 classic.Stop 续跑", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("插件返回 additionalContext：注入一条 meta 消息并再跑一轮", async () => {
    const {
      aiManager,
      messageManager,
      notifyMods,
      collectStopContext,
      events,
    } = buildHarness();
    vi.mocked(callAgent).mockResolvedValue(REPLY);
    collectStopContext.mockResolvedValueOnce(["改动里还有一处没跑测试"]);

    await aiManager.sendAIMessage();

    // 两次请求 = 第一次答完 + 插件要求续跑的那一轮。
    expect(vi.mocked(callAgent)).toHaveBeenCalledTimes(2);
    expect(messageManager.addUserMessage).toHaveBeenCalledWith({
      content: expect.stringContaining("改动里还有一处没跑测试"),
      isMeta: true,
    });
    // 续跑那一轮里 `stop_hook_active` 是 true（插件据此收手）。
    expect(
      collectStopContext.mock.calls.map((call) => (call as unknown[])[0]),
    ).toEqual([
      { background_tasks: [], stop_hook_active: false },
      { background_tasks: [], stop_hook_active: true },
    ]);
    // 续跑不新开一轮：`turn.complete` 仍然只报一次，且在真正收尾之后。
    expect(modCalls(notifyMods, "turn.complete")).toHaveLength(1);
    expect(events.slice(-2)).toEqual(["loading:false", "mods:turn.complete"]);
  });

  it("续跑到上限就不再续，第 9 次的反馈被丢弃", async () => {
    const { aiManager, notifyMods, collectStopContext } = buildHarness();
    vi.mocked(callAgent).mockResolvedValue(REPLY);
    // 无条件要求继续：只有上限能停住它。
    collectStopContext.mockResolvedValue(["还没完"]);

    await aiManager.sendAIMessage();

    // 1 次模型请求 + 8 次续跑 = 9 次；第 9 次收尾时已达上限，反馈丢弃。
    expect(collectStopContext).toHaveBeenCalledTimes(9);
    expect(vi.mocked(callAgent)).toHaveBeenCalledTimes(9);
    expect(modCalls(notifyMods, "turn.complete")).toHaveLength(1);
  });

  it("收尾时队列里已有用户消息：不续跑，那条消息下一轮先跑", async () => {
    const { aiManager, messageQueue, notifyMods, collectStopContext } =
      buildHarness();
    vi.mocked(callAgent).mockResolvedValue(REPLY);
    collectStopContext.mockResolvedValue(["还没完"]);
    messageQueue.enqueue({ content: "下一个问题", type: "message" });

    await aiManager.sendAIMessage();

    expect(vi.mocked(callAgent)).toHaveBeenCalledTimes(1);
    expect(modCalls(notifyMods, "turn.complete")).toHaveLength(1);
    expect(messageQueue.getQueue()).toHaveLength(1);
  });
});

describe("AIManager 的 classic.MessageDisplay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** 让这条 assistant 消息带着 id 出现在历史里（钩子按 id 去找正文）。 */
  function withAssistantMessage(
    messageManager: MessageManager,
    id: string,
    text: string,
  ) {
    vi.mocked(messageManager.addAssistantMessage).mockReturnValue(id);
    vi.mocked(messageManager.getMessages).mockReturnValue([
      {
        id,
        role: "assistant",
        blocks: [{ type: "text", content: text }],
        timestamp: "2026-08-19T00:00:00.000Z",
      },
    ] as unknown as ReturnType<typeof messageManager.getMessages>);
  }

  it("一条 assistant 消息报一次全文：index 恒 0、final 恒真", async () => {
    // spec「影子事件」：我们不分 flush，所以 `index` / `final` 这两档没有意义，
    // 只给一次完整正文（按 `$.ui.log` 的限额截断）。
    const { aiManager, messageManager, notifyMods } = buildHarness();
    vi.mocked(callAgent).mockResolvedValue(REPLY);
    withAssistantMessage(messageManager, "m-1", "答完了");

    await aiManager.sendAIMessage();

    expect(modCalls(notifyMods, "classic.MessageDisplay")).toEqual([
      {
        turn_id: expect.any(String),
        message_id: "m-1",
        index: 0,
        final: true,
        delta: "答完了",
      },
    ]);
  });

  it("只带工具调用、没有正文的不报（空 delta 只会让透明类插件画一行空白）", async () => {
    const { aiManager, messageManager, notifyMods } = buildHarness();
    // 先要一次工具调用（那条消息没有正文），再正常答完。
    vi.mocked(callAgent)
      .mockResolvedValueOnce({
        ...REPLY,
        content: "",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "Read", arguments: '{"file_path":"a.ts"}' },
          },
        ],
      })
      .mockResolvedValue(REPLY);
    withAssistantMessage(messageManager, "m-2", "");

    await aiManager.sendAIMessage();

    expect(modCalls(notifyMods, "classic.MessageDisplay")).toEqual([]);
  });

  it("子代理的嵌套轮次不报（mod 只关心用户眼前那条会话）", async () => {
    const { aiManager, messageManager, notifyMods } = buildHarness({
      subagentType: "general-purpose",
    });
    vi.mocked(callAgent).mockResolvedValue(REPLY);
    withAssistantMessage(messageManager, "m-3", "子代理的答案");

    await aiManager.sendAIMessage();

    expect(notifyMods).not.toHaveBeenCalled();
  });
});

describe("AIManager 的 abortTurn（$.turn.abort 的落点）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /** 一轮卡在模型请求上：拿到 turnId，等测试决定它怎么结束。 */
  async function startPendingTurn(aiManager: AIManager) {
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
    // 包一层，别让 async 函数把这一轮 adopt 掉（那样 await 就一直等下去了）。
    return { sendPromise };
  }

  it("turnId 对上就和按 Esc 走同一条路：这一轮按中断收尾", async () => {
    const { aiManager, notifyMods } = buildHarness();
    const { sendPromise } = await startPendingTurn(aiManager);
    const [{ turnId }] = modCalls(notifyMods, "turn.start") as {
      turnId: string;
    }[];

    aiManager.abortTurn(turnId);
    await sendPromise;

    expect(notifyMods).toHaveBeenCalledWith(
      "turn.complete",
      expect.objectContaining({ turnId, isAborted: true }),
    );
  });

  it("没有一轮在跑时抛错，不静默吞掉", () => {
    const { aiManager } = buildHarness();

    expect(() => aiManager.abortTurn("turn-x")).toThrow(/没有正在跑的一轮/);
  });

  it("turnId 对不上时抛错，正在跑的那轮不受影响", async () => {
    const { aiManager, notifyMods } = buildHarness();
    const { sendPromise } = await startPendingTurn(aiManager);
    const [{ turnId }] = modCalls(notifyMods, "turn.start") as {
      turnId: string;
    }[];

    expect(() => aiManager.abortTurn(`${turnId}-stale`)).toThrow(/对不上/);
    // 那一轮还挂着：没人 abort 过它。
    expect(modCalls(notifyMods, "turn.complete")).toEqual([]);

    aiManager.abortTurn(turnId);
    await sendPromise;
  });
});

describe("AIManager 的 turn.step", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("mod 换了模型：这次请求与整份配置都换成新模型", async () => {
    const { aiManager, dispatchTurnStep, configurationService } = buildHarness({
      onTurnStep: () => ({ model: "claude-opus-4" }),
    });
    vi.mocked(callAgent).mockResolvedValue(REPLY);

    await aiManager.sendAIMessage();

    expect(dispatchTurnStep).toHaveBeenCalledTimes(1);
    // 请求本身用新模型。
    expect(vi.mocked(callAgent).mock.calls[0]![0].model).toBe("claude-opus-4");
    // 配置按新名字重解析一遍：apiType / 上下文窗口 / 输出上限都是按模型名查的，
    // 只换请求里的名字会让限额按旧模型算。
    expect(configurationService.resolveModelConfig).toHaveBeenCalledWith(
      "claude-opus-4",
      undefined,
      undefined,
    );
  });

  it("子代理的嵌套轮次不派发 turn.step", async () => {
    const { aiManager, dispatchTurnStep } = buildHarness({
      subagentType: "Explore",
    });
    vi.mocked(callAgent).mockResolvedValue(REPLY);

    await aiManager.sendAIMessage();

    expect(dispatchTurnStep).not.toHaveBeenCalled();
  });
});
