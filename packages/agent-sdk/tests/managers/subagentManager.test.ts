import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { NotificationQueue } from "../../src/managers/notificationQueue.js";
import type { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import type { BackgroundTask } from "../../src/types/processes.js";

vi.mock("../../src/utils/subagentParser.js", () => ({
  loadSubagentConfigurations: vi.fn().mockResolvedValue([
    {
      name: "test-agent",
      description: "Test agent",
      systemPrompt: "You are a test agent",
      tools: [],
      model: "test-model",
    },
  ]),
  findSubagentByName: vi.fn().mockResolvedValue(null),
}));

vi.mock("../../src/managers/messageManager.js", () => ({
  MessageManager: vi.fn().mockImplementation(function () {
    return {
      addUserMessage: vi.fn(),
      getMessages: vi
        .fn()
        .mockReturnValue([
          { role: "assistant", blocks: [{ type: "text", content: "done" }] },
        ]),
    };
  }),
}));

vi.mock("../../src/managers/toolManager.js", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return {
      initializeBuiltInTools: vi.fn(),
    };
  }),
}));

vi.mock("../../src/services/configurationService.js", () => ({
  ConfigurationService: vi.fn().mockImplementation(function () {
    return {};
  }),
}));

vi.mock("../../src/managers/permissionManager.js", () => ({
  PermissionManager: vi.fn().mockImplementation(function () {
    return {
      getAllowedRules: vi.fn().mockReturnValue([]),
      getDeniedRules: vi.fn().mockReturnValue(["agent"]),
      getInstanceDeniedRules: vi.fn().mockReturnValue([]),
      getInstanceAllowedRules: vi.fn().mockReturnValue([]),
      getAdditionalDirectories: vi.fn().mockReturnValue([]),
      getSystemAdditionalDirectories: vi.fn().mockReturnValue([]),
      getConfiguredPermissionMode: vi.fn().mockReturnValue("ask"),
      addTemporaryRules: vi.fn(),
    };
  }),
}));

// Mock AIManager constructor
const mockAbortAIMessage = vi.fn();
const mockSendAIMessage = vi.fn();

vi.mock("../../src/managers/aiManager.js", () => {
  const MockAIManager = vi.fn().mockImplementation(function () {
    return {
      abortAIMessage: mockAbortAIMessage,
      sendAIMessage: mockSendAIMessage,
    };
  });
  return { AIManager: MockAIManager };
});

describe("SubagentManager background notification deduplication", () => {
  let container: Container;
  let notificationQueue: NotificationQueue;
  let subagentManager: SubagentManager;
  let tasks: Map<string, BackgroundTask>;
  let stopTaskFn: (id: string) => boolean;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    container = new Container();
    notificationQueue = new NotificationQueue();
    container.register("NotificationQueue", notificationQueue);

    tasks = new Map();

    stopTaskFn = vi.fn().mockImplementation((id: string) => {
      const task = tasks.get(id);
      if (task && task.status === "running") {
        task.onStop?.();
        task.status = "killed";
        task.endTime = Date.now();
        task.runtime = task.endTime - (task.startTime ?? 0);
        notificationQueue.enqueue(
          `<task-notification>\n<task-id>${id}</task-id>\n<task-type>subagent</task-type>\n<status>killed</status>\n<summary>Agent task "${task.description}" was stopped</summary>\n</task-notification>`,
        );
        return true;
      }
      return false;
    });

    const mockBackgroundTaskManager: Partial<BackgroundTaskManager> = {
      generateId: vi.fn().mockReturnValue("task_1"),
      getTask: vi.fn().mockImplementation((id: string) => tasks.get(id)),
      addTask: vi.fn().mockImplementation((task: BackgroundTask) => {
        tasks.set(task.id, task);
      }),
      stopTask: stopTaskFn as unknown as (id: string) => boolean,
    };
    container.register(
      "BackgroundTaskManager",
      mockBackgroundTaskManager as unknown as BackgroundTaskManager,
    );

    container.register("ToolManager", {
      initializeBuiltInTools: vi.fn(),
    });

    subagentManager = new SubagentManager(container, {
      workdir: "/tmp/test",
      stream: false,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should not enqueue duplicate completion notification when task is killed before sendAIMessage resolves", async () => {
    mockSendAIMessage.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 100));
      return;
    });

    const config = (await subagentManager.loadConfigurations())[0];
    const instance = await subagentManager.createInstance(config, {
      description: "Test task",
      prompt: "Do something",
      subagent_type: "test",
    });

    // Start background execution
    const taskId = await subagentManager.executeAgent(
      instance,
      "Do something",
      undefined,
      true,
    );

    expect(tasks.has(taskId)).toBe(true);
    const task = tasks.get(taskId);
    expect(task?.status).toBe("running");

    // Kill the task before sendAIMessage resolves
    stopTaskFn(taskId);
    expect(task?.status).toBe("killed");

    // Advance timers to let the async execution complete
    await vi.advanceTimersByTimeAsync(200);

    // Should only have killed notification, not completed
    const notifications = notificationQueue.dequeueAll();
    const completedNotifications = notifications.filter((n) =>
      n.includes("status>completed"),
    );
    const killedNotifications = notifications.filter((n) =>
      n.includes("status>killed"),
    );

    expect(killedNotifications.length).toBe(1);
    expect(completedNotifications.length).toBe(0);
  });

  it("should enqueue completion notification when task completes normally without being killed", async () => {
    mockSendAIMessage.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return;
    });

    const config = (await subagentManager.loadConfigurations())[0];
    const instance = await subagentManager.createInstance(config, {
      description: "Test task",
      prompt: "Do something",
      subagent_type: "test",
    });

    // Start background execution without killing
    await subagentManager.executeAgent(
      instance,
      "Do something",
      undefined,
      true,
    );

    // Wait for completion
    await vi.advanceTimersByTimeAsync(100);

    // Should have completion notification
    const notifications = notificationQueue.dequeueAll();
    const completedNotifications = notifications.filter((n) =>
      n.includes("status>completed"),
    );
    const killedNotifications = notifications.filter((n) =>
      n.includes("status>killed"),
    );

    expect(completedNotifications.length).toBe(1);
    expect(killedNotifications.length).toBe(0);
  });
});

describe("SubagentManager registerPluginAgents", () => {
  let container: Container;
  let subagentManager: SubagentManager;

  beforeEach(() => {
    container = new Container();

    const mockBackgroundTaskManager: Partial<BackgroundTaskManager> = {
      generateId: vi.fn().mockReturnValue("task_1"),
    };
    container.register(
      "BackgroundTaskManager",
      mockBackgroundTaskManager as unknown as BackgroundTaskManager,
    );

    subagentManager = new SubagentManager(container, {
      workdir: "/tmp/test",
      stream: false,
    });
  });

  it("should namespace agent names with pluginName:agentName", async () => {
    await subagentManager.loadConfigurations();
    subagentManager.registerPluginAgents("my-plugin", [
      {
        name: "test-agent",
        description: "Test Agent",
        systemPrompt: "You are a test agent",
        filePath: "/plugin/agents/test-agent.md",
        scope: "plugin",
        priority: 2,
        pluginRoot: "/plugin",
      },
    ]);

    const configs = subagentManager.getConfigurations();
    const pluginAgent = configs.find((c) => c.name.includes("my-plugin"));
    expect(pluginAgent).toBeDefined();
    expect(pluginAgent!.name).toBe("my-plugin:test-agent");
  });

  it("should substitute WAVE_PLUGIN_ROOT in systemPrompt as safety net", () => {
    subagentManager.registerPluginAgents("my-plugin", [
      {
        name: "test-agent",
        description: "Test Agent",
        systemPrompt: "Read files from ${WAVE_PLUGIN_ROOT}/data",
        filePath: "/plugin/agents/test-agent.md",
        scope: "plugin",
        priority: 2,
        pluginRoot: "/plugin",
      },
    ]);

    const configs = subagentManager.getConfigurations();
    const pluginAgent = configs.find((c) => c.name === "my-plugin:test-agent");
    expect(pluginAgent).toBeDefined();
    expect(pluginAgent!.systemPrompt).toBe("Read files from /plugin/data");
  });

  it("should handle agents without WAVE_PLUGIN_ROOT in systemPrompt", () => {
    subagentManager.registerPluginAgents("my-plugin", [
      {
        name: "test-agent",
        description: "Test Agent",
        systemPrompt: "You are a test agent",
        filePath: "/plugin/agents/test-agent.md",
        scope: "plugin",
        priority: 2,
      },
    ]);

    const configs = subagentManager.getConfigurations();
    const pluginAgent = configs.find((c) => c.name === "my-plugin:test-agent");
    expect(pluginAgent).toBeDefined();
    expect(pluginAgent!.systemPrompt).toBe("You are a test agent");
  });

  it("should re-register agents with updated content on duplicate plugin registration", async () => {
    await subagentManager.loadConfigurations();

    subagentManager.registerPluginAgents("my-plugin", [
      {
        name: "test-agent",
        description: "Test Agent v1",
        systemPrompt: "v1 prompt",
        filePath: "/plugin/agents/test-agent.md",
        scope: "plugin",
        priority: 2,
        pluginRoot: "/plugin",
      },
    ]);

    const firstConfigs = subagentManager.getConfigurations();
    const firstAgent = firstConfigs.find(
      (c) => c.name === "my-plugin:test-agent",
    );
    expect(firstAgent!.description).toBe("Test Agent v1");

    // Re-register with updated content
    subagentManager.registerPluginAgents("my-plugin", [
      {
        name: "test-agent",
        description: "Test Agent v2",
        systemPrompt: "v2 prompt",
        filePath: "/plugin/agents/test-agent.md",
        scope: "plugin",
        priority: 2,
        pluginRoot: "/plugin",
      },
    ]);

    const secondConfigs = subagentManager.getConfigurations();
    const secondAgent = secondConfigs.find(
      (c) => c.name === "my-plugin:test-agent",
    );
    expect(secondAgent!.description).toBe("Test Agent v2");
    expect(
      secondConfigs.filter((c) => c.name === "my-plugin:test-agent"),
    ).toHaveLength(1);
  });

  it("should sort configurations by priority then name after registration", async () => {
    await subagentManager.loadConfigurations();

    subagentManager.registerPluginAgents("plugin-a", [
      {
        name: "agent-z",
        description: "Agent Z",
        systemPrompt: "Prompt",
        filePath: "/plugin-a/agents/agent-z.md",
        scope: "plugin",
        priority: 2,
        pluginRoot: "/plugin-a",
      },
    ]);

    subagentManager.registerPluginAgents("plugin-b", [
      {
        name: "agent-a",
        description: "Agent A",
        systemPrompt: "Prompt",
        filePath: "/plugin-b/agents/agent-a.md",
        scope: "plugin",
        priority: 2,
        pluginRoot: "/plugin-b",
      },
    ]);

    const configs = subagentManager.getConfigurations();
    const pluginAgents = configs.filter((c) => c.scope === "plugin");
    // plugin-a:agent-z should come before plugin-b:agent-a (same priority, alphabetical by namespaced name)
    expect(pluginAgents[0].name).toBe("plugin-a:agent-z");
    expect(pluginAgents[1].name).toBe("plugin-b:agent-a");
  });
});
