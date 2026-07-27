import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskManager } from "../../src/services/taskManager.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
import { Container } from "../../src/utils/container.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

// Capture the subagent container passed to each AIManager constructor so we can
// assert it resolves its OWN MessageQueue (not the parent's via fallback).
const { capturedContainers } = vi.hoisted(() => ({
  capturedContainers: [] as Container[],
}));

// Mock dependencies. AIManager is mocked only to capture the subagent container;
// createInstance() does the real container wiring we are testing.
vi.mock("../../src/managers/messageManager.js");
vi.mock("../../src/managers/toolManager.js");
vi.mock("../../src/managers/backgroundTaskManager.js");
vi.mock("../../src/managers/aiManager.js", () => ({
  AIManager: vi.fn().mockImplementation(function (container: Container) {
    capturedContainers.push(container);
    return {
      sendAIMessage: vi.fn().mockResolvedValue("done"),
      abortAIMessage: vi.fn(),
    };
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

vi.mock("../../src/services/memory.js", () => ({
  MemoryService: vi.fn().mockImplementation(() => ({
    getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
    getAutoMemoryDirectory: vi.fn().mockReturnValue("/mock/auto-memory"),
    ensureAutoMemoryDirectory: vi.fn().mockResolvedValue(undefined),
    getAutoMemoryContent: vi.fn().mockResolvedValue(""),
  })),
  getCombinedMemoryContent: vi.fn().mockResolvedValue(""),
}));

const testConfig: SubagentConfiguration = {
  name: "TestAgent",
  description: "Test agent",
  systemPrompt: "System prompt",
  tools: ["Read"],
  model: "inherit",
  filePath: "/test/agent.md",
  scope: "user",
  priority: 1,
};

function buildParentContainer(messageQueue: MessageQueue): Container {
  const mockToolManager = {
    list: vi.fn(() => [{ name: "Read" }]),
    getPermissionManager: vi.fn(),
  } as unknown as ToolManager;

  const mockBackgroundTaskManager = {
    generateId: vi.fn().mockReturnValue("task_123"),
    addTask: vi.fn(),
    getTask: vi.fn(),
  } as unknown as BackgroundTaskManager;

  const taskManager = {
    on: vi.fn(),
    listTasks: vi.fn().mockResolvedValue([]),
    getTaskListId: vi.fn().mockReturnValue("test-task-list"),
  } as unknown as TaskManager;

  const container = new Container();
  container.register("ToolManager", mockToolManager);
  container.register("TaskManager", taskManager);
  container.register("BackgroundTaskManager", mockBackgroundTaskManager);
  container.register("MessageQueue", messageQueue);
  container.register("ConfigurationService", {
    resolveGatewayConfig: () => ({ apiKey: "test", baseURL: "test" }),
    resolveModelConfig: () => ({
      model: "test-model",
      fastModel: "test-fast-model",
    }),
    resolveMaxInputTokens: () => 1000,
    resolveAutoMemoryEnabled: () => true,
    resolveLanguage: () => "en",
  });
  return container;
}

describe("SubagentManager - MessageQueue isolation (FR-042)", () => {
  let subagentManager: SubagentManager;
  let parentQueue: MessageQueue;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedContainers.length = 0;

    parentQueue = new MessageQueue();
    // Pre-enqueue a sibling completion notification in the parent queue.
    parentQueue.enqueueNotification(
      "<task-notification><task-id>sibling-A</task-id></task-notification>",
    );

    const container = buildParentContainer(parentQueue);
    subagentManager = new SubagentManager(container, {
      workdir: "/test",
      stream: false,
    });
  });

  it("registers an independent MessageQueue in the subagent container", async () => {
    await subagentManager.createInstance(testConfig, {
      description: "isolated subagent",
      prompt: "p",
      subagent_type: "t",
    });

    expect(capturedContainers).toHaveLength(1);
    const childQueue = capturedContainers[0].get<MessageQueue>("MessageQueue");

    // The subagent must resolve its OWN queue, not the parent's via fallback.
    expect(childQueue).toBeInstanceOf(MessageQueue);
    expect(childQueue).not.toBe(parentQueue);
    // The subagent's queue is empty — it must NOT see the parent's notification.
    expect(childQueue?.hasNotifications()).toBe(false);
    // The parent's notification is untouched.
    expect(parentQueue.hasNotifications()).toBe(true);
  });

  it("gives each concurrent subagent a distinct MessageQueue", async () => {
    const N = 5;
    for (let i = 0; i < N; i++) {
      await subagentManager.createInstance(testConfig, {
        description: `subagent-${i}`,
        prompt: "p",
        subagent_type: "t",
      });
    }

    expect(capturedContainers).toHaveLength(N);
    const childQueues = capturedContainers.map(
      (c) => c.get<MessageQueue>("MessageQueue")!,
    );

    // Every child queue is a real MessageQueue distinct from the parent...
    for (const q of childQueues) {
      expect(q).toBeInstanceOf(MessageQueue);
      expect(q).not.toBe(parentQueue);
      expect(q.hasNotifications()).toBe(false);
    }
    // ...and distinct from every other child queue.
    const uniqueQueues = new Set(childQueues);
    expect(uniqueQueues.size).toBe(N);

    // The parent's single notification is never stolen by any subagent.
    expect(parentQueue.hasNotifications()).toBe(true);
  });
});
