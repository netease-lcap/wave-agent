import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskManager } from "../../src/services/taskManager.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { NotificationQueue } from "../../src/managers/notificationQueue.js";
import { Container } from "../../src/utils/container.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

// Mock dependencies
vi.mock("../../src/managers/messageManager.js");
vi.mock("../../src/managers/toolManager.js");
vi.mock("../../src/managers/backgroundTaskManager.js");
vi.mock("../../src/managers/aiManager.js", () => ({
  AIManager: vi.fn().mockImplementation(function () {
    return {
      sendAIMessage: vi.fn().mockResolvedValue("Test response"),
      abortAIMessage: vi.fn(),
    };
  }),
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

describe("SubagentManager - Notification Deduplication", () => {
  let subagentManager: SubagentManager;
  let mockToolManager: ToolManager;
  let mockBackgroundTaskManager: BackgroundTaskManager;
  let notificationQueue: NotificationQueue;
  let container: Container;

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

  beforeEach(() => {
    vi.clearAllMocks();

    mockToolManager = {
      list: vi.fn(() => [{ name: "Read" }]),
      getPermissionManager: vi.fn(),
    } as unknown as ToolManager;

    mockBackgroundTaskManager = {
      generateId: vi.fn().mockReturnValue("task_123"),
      addTask: vi.fn(),
      getTask: vi.fn(),
    } as unknown as BackgroundTaskManager;

    notificationQueue = new NotificationQueue();

    const taskManager = {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
      getTaskListId: vi.fn().mockReturnValue("test-task-list"),
    } as unknown as TaskManager;

    container = new Container();
    container.register("ToolManager", mockToolManager);
    container.register("TaskManager", taskManager);
    container.register("BackgroundTaskManager", mockBackgroundTaskManager);
    container.register("NotificationQueue", notificationQueue);

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

    subagentManager = new SubagentManager(container, {
      workdir: "/test",
      stream: false,
    });
  });

  it("should enqueue exactly ONE completion notification for backgroundInstance path", async () => {
    const enqueueSpy = vi.spyOn(notificationQueue, "enqueue");

    const instance = await subagentManager.createInstance(testConfig, {
      description: "Test background task",
      prompt: "p",
      subagent_type: "t",
    });

    const mockTask = {
      id: "task_123",
      status: "running",
      startTime: Date.now(),
      stdout: "",
      endTime: 0,
      runtime: 0,
    };
    vi.mocked(mockBackgroundTaskManager.getTask).mockReturnValue(
      mockTask as unknown as ReturnType<
        typeof mockBackgroundTaskManager.getTask
      >,
    );

    await subagentManager.backgroundInstance(instance.subagentId);

    vi.mocked(instance.messageManager.getMessages).mockReturnValue([
      { role: "assistant", blocks: [{ type: "text", content: "Done" }] },
    ] as unknown as ReturnType<typeof instance.messageManager.getMessages>);

    await subagentManager.executeAgent(instance, "test prompt");

    // Wait for async operations to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should enqueue exactly one notification, not two
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.stringContaining("<status>completed</status>"),
    );
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.stringContaining("task_123"),
    );
  });

  it("should enqueue exactly ONE error notification for backgroundInstance path", async () => {
    const enqueueSpy = vi.spyOn(notificationQueue, "enqueue");

    const instance = await subagentManager.createInstance(testConfig, {
      description: "Failing background task",
      prompt: "p",
      subagent_type: "t",
    });

    const mockTask = {
      id: "task_123",
      status: "running",
      startTime: Date.now(),
      stderr: "",
      endTime: 0,
      runtime: 0,
    };
    vi.mocked(mockBackgroundTaskManager.getTask).mockReturnValue(
      mockTask as unknown as ReturnType<
        typeof mockBackgroundTaskManager.getTask
      >,
    );

    await subagentManager.backgroundInstance(instance.subagentId);

    const aiManager = (instance as unknown as { aiManager: AIManager })
      .aiManager;
    vi.spyOn(aiManager, "sendAIMessage").mockRejectedValue(
      new Error("Build failed"),
    );
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([]);

    await expect(
      subagentManager.executeAgent(instance, "test prompt"),
    ).rejects.toThrow("Build failed");

    // Wait for async operations to settle
    await new Promise((resolve) => setTimeout(resolve, 50));

    // Should enqueue exactly one error notification, not two
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.stringContaining("<status>failed</status>"),
    );
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.stringContaining("Build failed"),
    );
  });

  it("should enqueue exactly ONE completion notification for executeAgent with runInBackground", async () => {
    const enqueueSpy = vi.spyOn(notificationQueue, "enqueue");

    const instance = await subagentManager.createInstance(testConfig, {
      description: "Test background task",
      prompt: "p",
      subagent_type: "t",
    });

    // Mock getTask to return a running task (so internalExecute enters notification block)
    vi.mocked(mockBackgroundTaskManager.getTask).mockReturnValue({
      id: "task_123",
      status: "running",
      startTime: Date.now(),
      stdout: "",
      stderr: "",
      endTime: undefined,
      runtime: undefined,
    } as unknown as ReturnType<typeof mockBackgroundTaskManager.getTask>);

    // Mock getMessages to return a successful response before executeAgent runs
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([
      { role: "assistant", blocks: [{ type: "text", content: "Done" }] },
    ] as unknown as ReturnType<typeof instance.messageManager.getMessages>);

    const taskId = await subagentManager.executeAgent(
      instance,
      "test prompt",
      undefined,
      true,
    );

    // Wait for the background async IIFE to complete
    await vi.waitFor(() => expect(enqueueSpy).toHaveBeenCalled());

    // Should enqueue exactly one notification, not two
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.stringContaining("<status>completed</status>"),
    );
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.stringContaining(`<task-id>${String(taskId)}</task-id>`),
    );
  });

  it("should enqueue exactly ONE error notification for executeAgent with runInBackground", async () => {
    const enqueueSpy = vi.spyOn(notificationQueue, "enqueue");

    const instance = await subagentManager.createInstance(testConfig, {
      description: "Failing background task",
      prompt: "p",
      subagent_type: "t",
    });

    // Mock getTask to return a running task (so internalExecute enters notification block)
    vi.mocked(mockBackgroundTaskManager.getTask).mockReturnValue({
      id: "task_123",
      status: "running",
      startTime: Date.now(),
      stdout: "",
      stderr: "",
      endTime: undefined,
      runtime: undefined,
    } as unknown as ReturnType<typeof mockBackgroundTaskManager.getTask>);

    const aiManager = (instance as unknown as { aiManager: AIManager })
      .aiManager;
    vi.spyOn(aiManager, "sendAIMessage").mockRejectedValue(
      new Error("AI failure"),
    );

    await subagentManager.executeAgent(
      instance,
      "test prompt",
      undefined,
      true,
    );

    // Wait for the background async IIFE to complete with error
    await vi.waitFor(() => expect(enqueueSpy).toHaveBeenCalled());

    // Should enqueue exactly one error notification, not two
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.stringContaining("<status>failed</status>"),
    );
    expect(enqueueSpy).toHaveBeenCalledWith(
      expect.stringContaining("AI failure"),
    );
  });
});
