import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { NotificationQueue } from "../../src/managers/notificationQueue.js";
import { Container } from "../../src/utils/container.js";
import type { SubagentManagerCallbacks } from "../../src/managers/subagentManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { GatewayConfig, ModelConfig } from "../../src/types/index.js";
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

describe("SubagentManager - Recent Changes Coverage", () => {
  let subagentManager: SubagentManager;
  let parentToolManager: ToolManager;
  let callbacks: SubagentManagerCallbacks;
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
      resolveMaxInputTokens: () => 1000,
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => undefined,
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

    // Simulate tool block updates
    instance.messageManager.updateToolBlock({
      id: "1",
      name: "ToolA",
      stage: "start",
    });
    expect(instance.usedTools).toEqual([
      {
        name: "ToolA",
        parameters: "",
        compactParams: undefined,
        stage: "start",
      },
    ]);
    expect(onUpdate).toHaveBeenCalled();

    instance.messageManager.updateToolBlock({
      id: "2",
      name: "ToolB",
      stage: "start",
    });
    expect(instance.usedTools).toEqual([
      {
        name: "ToolA",
        parameters: "",
        compactParams: undefined,
        stage: "start",
      },
      {
        name: "ToolB",
        parameters: "",
        compactParams: undefined,
        stage: "start",
      },
    ]);

    instance.messageManager.updateToolBlock({
      id: "3",
      name: "ToolC",
      stage: "start",
    });
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

    // Set status to completed and cleanup
    subagentManager.updateInstanceStatus(subagentId, "completed");
    subagentManager.cleanupInstance(subagentId);

    expect(subagentManager.getInstance(subagentId)).toBeNull();
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
    subagentManager.updateInstanceStatus(subagentId, "error");
    subagentManager.cleanupInstance(subagentId);

    expect(subagentManager.getInstance(subagentId)).toBeNull();
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

  it("should create isolated NotificationQueue and BackgroundTaskManager in child container", async () => {
    const parentNotificationQueue = new NotificationQueue();
    const parentBackgroundTaskManager = new BackgroundTaskManager(container, {
      workdir: "/tmp/test",
    });
    container.register("NotificationQueue", parentNotificationQueue);
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
    const subNotificationQueue =
      subContainer.get<NotificationQueue>("NotificationQueue");

    expect(subBgManager).not.toBe(parentBackgroundTaskManager);
    expect(subNotificationQueue).not.toBe(parentNotificationQueue);
    expect(subBgManager).toBeInstanceOf(BackgroundTaskManager);
    expect(subNotificationQueue).toBeInstanceOf(NotificationQueue);
  });
});
