import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskManager } from "../../src/services/taskManager.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
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
  let messageQueue: MessageQueue;
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
      notifyTasksChange: vi.fn(),
    } as unknown as BackgroundTaskManager;

    messageQueue = new MessageQueue();

    const taskManager = {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
      getTaskListId: vi.fn().mockReturnValue("test-task-list"),
    } as unknown as TaskManager;

    container = new Container();
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
      resolveContextWindow: () => 1000,
      resolveAutoMemoryEnabled: () => true,
      resolveLanguage: () => "en",
    });

    subagentManager = new SubagentManager(container, {
      workdir: "/test",
      stream: false,
    });
  });

  /**
   * 冲刷一轮事件循环（同 `tests/telemetry/events.test.ts` 的 `settleEmits`）。
   *
   * 通知是 fire-and-forget：`enqueueNotification` 之后不再 await，所以紧跟在
   * 「它发生过」之后断 `toHaveBeenCalledTimes(1)`，只能证明此刻恰好 1 条 ——
   * 同一批逻辑里追加的第二条还没轮到。冲刷之后，次数断言才是在证明
   * 「没有第二条」。
   */
  const settleNotifications = async () => {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
  };

  it("should enqueue exactly ONE completion notification for backgroundInstance path", async () => {
    const enqueueSpy = vi.spyOn(messageQueue, "enqueueNotification");

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

    // 不要用固定睡眠：机器忙时通知可能还没发出来，次数仍是 0 ⇒ 假红。
    // 等那条通知真的发生，交给 vitest 判超时，再冲刷一轮事件循环。
    await vi.waitFor(() => expect(enqueueSpy).toHaveBeenCalled());
    await settleNotifications();

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
    const enqueueSpy = vi.spyOn(messageQueue, "enqueueNotification");

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

    // 不要用固定睡眠：机器忙时通知可能还没发出来，次数仍是 0 ⇒ 假红。
    // 等那条通知真的发生，交给 vitest 判超时，再冲刷一轮事件循环。
    await vi.waitFor(() => expect(enqueueSpy).toHaveBeenCalled());
    await settleNotifications();

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
    const enqueueSpy = vi.spyOn(messageQueue, "enqueueNotification");

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

    // 后台 IIFE 是 fire-and-forget：`waitFor(called)` 首检即满足就返回，
    // 同一批逻辑里追加的第二条还没跑，「恰好 1 条」这半句就没被证明。
    await vi.waitFor(() => expect(enqueueSpy).toHaveBeenCalled());
    await settleNotifications();

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
    const enqueueSpy = vi.spyOn(messageQueue, "enqueueNotification");

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

    // 同上：先等通知发生，再冲刷事件循环，「没有第二条」才是被证明过的。
    await vi.waitFor(() => expect(enqueueSpy).toHaveBeenCalled());
    await settleNotifications();

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
