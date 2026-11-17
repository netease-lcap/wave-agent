import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { Container } from "../../src/utils/container.js";
import type { SubagentManagerCallbacks } from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
import type { BackgroundShell } from "../../src/types/processes.js";
import type { ToolContext } from "../../src/tools/types.js";

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
vi.mock("../../src/utils/subagentParser.js", () => ({
  loadSubagentConfigurations: vi.fn().mockResolvedValue([]),
  findSubagentByName: vi.fn().mockResolvedValue(null),
}));
// 真跑一轮子代理（下面那条端到端用例）时模型这一层答一句话就够了：要验的是收尾
// 事件在谁手里派发、派发几次，不是回答内容。
vi.mock("../../src/services/aiService.js", () => ({
  callAgent: vi.fn().mockResolvedValue({
    content: "查完了",
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    tool_calls: [],
  }),
  compactMessages: vi.fn().mockResolvedValue({
    content: "",
    usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
  }),
  transformMessagesForExplicitCache: vi.fn((messages) => messages),
  extendUsageWithCacheMetrics: vi.fn((usage) => usage),
}));

describe("SubagentManager instance lifecycle and tool tracking", () => {
  let subagentManager: SubagentManager;
  let parentToolManager: ToolManager;
  let callbacks: SubagentManagerCallbacks;
  let notifyMods: ReturnType<typeof vi.fn>;
  let collectSubagentStopContext: ReturnType<typeof vi.fn>;
  let mockGatewayConfig: GatewayConfig;
  let mockModelConfig: ModelConfig;
  let container: Container;

  beforeEach(async () => {
    callbacks = {
      onSubagentToolBlockUpdated: vi.fn(),
    };

    container = new Container();
    container.register("PermissionManager", {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
      getConfiguredPermissionMode: vi.fn().mockReturnValue("default"),
      getAllowedRules: vi.fn().mockReturnValue([]),
      getDeniedRules: vi.fn().mockReturnValue([]),
      getAdditionalDirectories: vi.fn().mockReturnValue([]),
      getSystemAdditionalDirectories: vi.fn().mockReturnValue([]),
      getPlanFilePath: vi.fn().mockReturnValue(undefined),
    } as unknown as Record<string, unknown>);
    container.register("TaskManager", {} as unknown as Record<string, unknown>);
    container.register("MemoryService", {
      getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
      getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
      ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
      getAutoMemoryContent: vi.fn().mockResolvedValue(""),
    } as unknown as Record<string, unknown>);
    container.register("SkillManager", {
      getAvailableSkills: vi.fn().mockReturnValue([]),
      listSkillSources: vi.fn().mockReturnValue([]),
    } as unknown as Record<string, unknown>);
    container.register(
      "ReversionManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "BackgroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "ForegroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register("LspManager", {} as unknown as Record<string, unknown>);

    const mockMcpManager = {
      listTools: vi.fn().mockReturnValue([]),
      callTool: vi.fn().mockResolvedValue({ result: "mock result" }),
      isMcpTool: vi.fn().mockReturnValue(false),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
    };
    container.register(
      "McpManager",
      mockMcpManager as unknown as Record<string, unknown>,
    );

    // 影子事件 `classic.SubagentStart` / `SubagentStop` 的观察点（spec「影子
    // 事件」）：子代理的结束路径最后都会走 `releaseInstance`。
    notifyMods = vi.fn();
    // 真跑一轮子代理时 AIManager 会调这一套（提示词分段、上下文块、收尾通道…）：
    // 少了任何一个，请求就会在构造提示词时抛错、走不到收尾。
    collectSubagentStopContext = vi.fn(async () => []);
    container.register("ModManager", {
      notifyMods,
      collectStopContext: vi.fn(async () => []),
      collectSubagentStopContext,
      collectSessionContextBlocks: vi.fn(async () => []),
      collectPromptSections: vi.fn(async (sections) => sections),
      collectPromptSection: vi.fn(async (section) => section.text),
      rewritePromptAttachment: vi.fn(async (attachment) => attachment.text),
      dispatchTurnStep: vi.fn(async (event) => event),
      clearToolNotices: vi.fn(),
    } as unknown as Record<string, unknown>);

    parentToolManager = new ToolManager({
      container,
    });
    container.register("ToolManager", parentToolManager);

    mockGatewayConfig = {
      apiKey: "test-key",
      baseURL: "https://api.anthropic.com",
    };
    mockModelConfig = {
      model: "claude-3-sonnet",
      fastModel: "claude-3-haiku",
    };

    container.register("ConfigurationService", {
      resolveGatewayConfig: () => mockGatewayConfig,
      resolveModelConfig: () => mockModelConfig,
      resolveContextWindow: () => 1000,
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => undefined,
      resolveMaxOutputTokens: () => 4096,
      getMergedEnv: () => ({}),
    });

    subagentManager = new SubagentManager(container, {
      workdir: "/tmp/test",
      callbacks,
      stream: false,
    });

    await subagentManager.initialize();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Register a running background shell task in the subagent's *isolated*
   * manager, the way a `Bash run_in_background` executed inside that subagent
   * would leave one. `cleanup()` only looks at `status`/`onStop`, so the stub
   * process handle is never touched.
   */
  const addRunningBackgroundShell = (
    instance: Awaited<ReturnType<SubagentManager["createInstance"]>>,
  ) => {
    const onStop = vi.fn();
    const task: BackgroundShell = {
      id: "task_orphaned_shell",
      type: "shell",
      status: "running",
      startTime: Date.now(),
      command: "npm run test",
      stdout: "",
      stderr: "",
      onStop,
      process: {} as BackgroundShell["process"],
    };
    instance.backgroundTaskManager.addTask(task);
    return onStop;
  };

  it("实例建好发 classic.SubagentStart，没走到收尾就释放时补报一次 classic.SubagentStop", async () => {
    const config: SubagentConfiguration = {
      name: "reporter",
      description: "报道",
      systemPrompt: "...",
      tools: [],
      model: "inherit",
      filePath: "/tmp/reporter.md",
      scope: "project",
      priority: 1,
    };

    const instance = await subagentManager.createInstance(config, {
      description: "查资料",
      prompt: "查一下",
      subagent_type: "reporter",
    });

    const starts = notifyMods.mock.calls
      .filter((call) => call[0] === "classic.SubagentStart")
      .map((call) => call[1]);
    expect(starts).toEqual([
      {
        agent_id: instance.subagentId,
        agent_type: "reporter",
      },
    ]);

    // 完成路径先把实例置成终态，再释放它（`releaseInstance` 是所有结束路径的
    // 汇合点：完成、出错、中止、用户停掉）。
    instance.status = "completed";
    subagentManager.cleanupInstance(instance.subagentId);

    const stops = notifyMods.mock.calls
      .filter((call) => call[0] === "classic.SubagentStop")
      .map((call) => call[1]);
    // 收尾事件由子代理自己的 AIManager 在收尾点派发（可多次、能续跑），这里走的
    // 是「没走到收尾」的兜底补报：终局通知，`stop_hook_active` 恒 false；没有产出、
    // 也没有日志流时那两个可选字段不出现。
    expect(stops).toEqual([
      {
        agent_id: instance.subagentId,
        agent_type: "reporter",
        stop_hook_active: false,
      },
    ]);
  });

  it("收尾事件已经派发过：释放时不再补报一次", async () => {
    // 正常答完的子代理在收尾点报过 `classic.SubagentStop`（那一次可以续跑），实例
    // 释放只是清理现场，不该再给插件一次「结束了」。补报只留给没走到收尾的出错 /
    // 中止路径。
    const config: SubagentConfiguration = {
      name: "reporter",
      description: "报道",
      systemPrompt: "...",
      tools: [],
      model: "inherit",
      filePath: "/tmp/reporter.md",
      scope: "project",
      priority: 1,
    };
    const instance = await subagentManager.createInstance(config, {
      description: "查资料",
      prompt: "查一下",
      subagent_type: "reporter",
    });
    instance.modStopDispatched = true;
    // 终态才允许释放（`cleanupInstance` 的守卫），否则这条路根本不会走到
    // `releaseInstance` —— 断言会变成「什么都没发生」的假绿。
    instance.status = "completed";

    subagentManager.cleanupInstance(instance.subagentId);

    const stops = notifyMods.mock.calls.filter(
      (call) => call[0] === "classic.SubagentStop",
    );
    expect(stops).toEqual([]);
  });

  it("真答完的子代理：收尾问一次 classic.SubagentStop，释放时不再补报", async () => {
    // 端到端把三处接线一起钉住：`agent_id` / `agent_type` 传到了子代理的 AIManager、
    // 收尾点真的问了这条通道（带最后一条正文）、收尾回调让 `SubagentManager` 记下
    // 「报过了」所以释放时不再补报。真正的派发（→ `notifyMods("classic.SubagentStop")`）
    // 由 modManager.test.ts 用真 ModManager 覆盖，这里用 stub 记参数。
    const config: SubagentConfiguration = {
      name: "reporter",
      description: "报道",
      systemPrompt: "...",
      tools: [],
      model: "inherit",
      filePath: "/tmp/reporter.md",
      scope: "project",
      priority: 1,
    };
    const instance = await subagentManager.createInstance(config, {
      description: "查资料",
      prompt: "查一下",
      subagent_type: "reporter",
    });
    notifyMods.mockClear();

    await subagentManager.executeAgent(instance, "查一下");

    expect(
      collectSubagentStopContext.mock.calls.map((call) => call[0]),
    ).toEqual([
      {
        agent_id: instance.subagentId,
        agent_type: "reporter",
        stop_hook_active: false,
        last_assistant_message: "查完了",
      },
    ]);

    // 收尾已经报过 ⇒ 释放只剩清理现场，不再补一次「结束了」。
    instance.status = "completed";
    subagentManager.cleanupInstance(instance.subagentId);
    expect(
      notifyMods.mock.calls.filter(
        (call) => call[0] === "classic.SubagentStop",
      ),
    ).toEqual([]);
  });

  it("classic.SubagentStop 带上最后一条正文（插件不必自己去读转录）", async () => {
    // CC 同名字段 `last_assistant_message`：读实例自己的 messageManager（`instance.messages`
    // 那条记录一直是空的）。
    const config: SubagentConfiguration = {
      name: "reporter",
      description: "报道",
      systemPrompt: "...",
      tools: [],
      model: "inherit",
      filePath: "/tmp/reporter.md",
      scope: "project",
      priority: 1,
    };
    const instance = await subagentManager.createInstance(config, {
      description: "查资料",
      prompt: "查一下",
      subagent_type: "reporter",
    });
    vi.spyOn(instance.messageManager, "getMessages").mockReturnValue([
      {
        id: "m1",
        role: "assistant",
        blocks: [{ type: "text", content: "查到了，三条线索" }],
        timestamp: "2026-08-19T00:00:00.000Z",
      },
    ] as unknown as ReturnType<typeof instance.messageManager.getMessages>);

    instance.status = "completed";
    subagentManager.cleanupInstance(instance.subagentId);

    const stops = notifyMods.mock.calls
      .filter((call) => call[0] === "classic.SubagentStop")
      .map((call) => call[1]);
    expect(stops).toEqual([
      expect.objectContaining({
        agent_id: instance.subagentId,
        last_assistant_message: "查到了，三条线索",
      }),
    ]);
  });

  it("should track last two tool names in subagent instance (ad85945f)", async () => {
    const mockConfig: SubagentConfiguration = {
      name: "tool-tracker",
      description: "Tracks tools",
      systemPrompt: "...",
      tools: ["ToolA", "ToolB", "ToolC"],
      model: "inherit",
      filePath: "/tmp/tool-tracker.md",
      scope: "project",
      priority: 1,
    };

    const onUpdate = vi.fn();
    const instance = await subagentManager.createInstance(
      mockConfig,
      {
        description: "Test",
        prompt: "Test",
        subagent_type: "tool-tracker",
      },
      false,
      onUpdate,
    );

    // Simulate messages with tool blocks (usedTools is computed from messages)
    // msg1: ToolA starts
    instance.messageManager.addAssistantMessage("", [
      {
        id: "1",
        type: "function",
        function: { name: "ToolA", arguments: "" },
      },
    ]);
    expect(instance.usedTools).toEqual([
      {
        name: "ToolA",
        parameters: "",
        compactParams: undefined,
        stage: "start",
      },
    ]);
    expect(onUpdate).toHaveBeenCalled();

    // msg2: ToolA completes, ToolB starts
    instance.messageManager.updateToolBlock({ id: "1", stage: "end" });
    instance.messageManager.addToolBlockToMessage(
      instance.messageManager.getMessages().slice(-1)[0].id,
      { name: "ToolB", parameters: "", stage: "start" },
    );
    expect(instance.usedTools).toEqual([
      {
        name: "ToolA",
        parameters: "",
        compactParams: undefined,
        stage: "end",
      },
      {
        name: "ToolB",
        parameters: "",
        compactParams: undefined,
        stage: "start",
      },
    ]);

    // msg3: ToolC starts
    instance.messageManager.addAssistantMessage("", [
      {
        id: "3",
        type: "function",
        function: { name: "ToolC", arguments: "" },
      },
    ]);
    expect(instance.usedTools).toEqual([
      {
        name: "ToolB",
        parameters: "",
        compactParams: undefined,
        stage: "start",
      },
      {
        name: "ToolC",
        parameters: "",
        compactParams: undefined,
        stage: "start",
      },
    ]); // Should only keep last 2
  });

  it("should cleanup subagent instance on completion (7b412d33)", async () => {
    const mockConfig: SubagentConfiguration = {
      name: "cleanup-test",
      description: "Cleanup test",
      systemPrompt: "...",
      tools: [],
      model: "inherit",
      filePath: "/tmp/cleanup.md",
      scope: "project",
      priority: 1,
    };

    const instance = await subagentManager.createInstance(mockConfig, {
      description: "Test",
      prompt: "Test",
      subagent_type: "cleanup-test",
    });

    const subagentId = instance.subagentId;
    expect(subagentManager.getInstance(subagentId)).toBe(instance);

    // A background shell the subagent left running must not outlive it: its
    // manager is isolated per instance, so only this release path can stop it
    // (issue #2742).
    const onStop = addRunningBackgroundShell(instance);

    // Set status to completed and cleanup
    subagentManager.updateInstanceStatus(subagentId, "completed");
    subagentManager.cleanupInstance(subagentId);

    expect(subagentManager.getInstance(subagentId)).toBeNull();
    expect(onStop).toHaveBeenCalledTimes(1);
    expect(instance.backgroundTaskManager.getTask("task_orphaned_shell")).toBe(
      undefined,
    );
  });

  it("should cleanup subagent instance on error (7b412d33)", async () => {
    const mockConfig: SubagentConfiguration = {
      name: "cleanup-error-test",
      description: "Cleanup error test",
      systemPrompt: "...",
      tools: [],
      model: "inherit",
      filePath: "/tmp/cleanup-error.md",
      scope: "project",
      priority: 1,
    };

    const instance = await subagentManager.createInstance(mockConfig, {
      description: "Test",
      prompt: "Test",
      subagent_type: "cleanup-error-test",
    });

    const subagentId = instance.subagentId;
    const onStop = addRunningBackgroundShell(instance);
    subagentManager.updateInstanceStatus(subagentId, "error");
    subagentManager.cleanupInstance(subagentId);

    expect(subagentManager.getInstance(subagentId)).toBeNull();
    // A subagent that fails *and* leaves background shells behind is exactly
    // the shape that produced unattributable orphans (issue #2742).
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("should update shortResult with tool names and count (ad85945f)", async () => {
    const mockConfig: SubagentConfiguration = {
      name: "short-result-test",
      description: "Tests short result",
      systemPrompt: "...",
      tools: ["ToolA"],
      model: "inherit",
      filePath: "/tmp/short-result.md",
      scope: "project",
      priority: 1,
    };

    // Use spyOn instead of vi.mocked for instance methods
    vi.spyOn(subagentManager, "findSubagent").mockResolvedValue(mockConfig);

    // Use agent tool
    const { agentTool } = await import("../../src/tools/agentTool.js");
    // Set subagent manager in context
    const onShortResultUpdate = vi.fn();
    const context = {
      onShortResultUpdate,
      abortSignal: new AbortController().signal,
      subagentManager,
    } as unknown as ToolContext;

    // We need to mock executeAgent to not actually run AI
    vi.spyOn(subagentManager, "executeAgent").mockResolvedValue("Done");

    await agentTool.execute(
      {
        description: "Test",
        prompt: "Test",
        subagent_type: "short-result-test",
      },
      context,
    );

    // Get the instance created during execute
    const activeInstances = subagentManager.getActiveInstances();
    const instance = activeInstances.find(
      (i) => i.configuration.name === "short-result-test",
    )!;

    // Simulate tool updates via the callback (which pushes to usedTools)
    instance.messageManager.updateToolBlock({
      id: "1",
      name: "ToolA",
      stage: "running",
    });
    instance.messageManager.addAssistantMessage("Thinking", [
      {
        id: "1",
        type: "function",
        function: { name: "ToolA", arguments: "{}" },
      },
    ]);

    // Trigger the update callback that was passed to createInstance
    instance.onUpdate?.();

    expect(onShortResultUpdate).toHaveBeenCalledWith(
      expect.stringContaining("(1 tools"),
    );
  });

  it("should create isolated BackgroundTaskManager in child container", async () => {
    const parentBackgroundTaskManager = new BackgroundTaskManager(container, {
      workdir: "/tmp/test",
    });
    container.register("BackgroundTaskManager", parentBackgroundTaskManager);

    const mockConfig: SubagentConfiguration = {
      name: "isolation-test",
      description: "Tests isolation",
      systemPrompt: "...",
      tools: [],
      model: "inherit",
      filePath: "/tmp/isolation.md",
      scope: "project",
      priority: 1,
    };

    const instance = await subagentManager.createInstance(mockConfig, {
      description: "Test",
      prompt: "Test",
      subagent_type: "isolation-test",
    });

    // Verify the instance's managers resolve to isolated instances, not parent's
    const subContainer = (
      instance.toolManager as unknown as { container: Container }
    ).container;
    const subBgManager = subContainer.get<BackgroundTaskManager>(
      "BackgroundTaskManager",
    );

    expect(subBgManager).not.toBe(parentBackgroundTaskManager);
    expect(subBgManager).toBeInstanceOf(BackgroundTaskManager);
  });
});
