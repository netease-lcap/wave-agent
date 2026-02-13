import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskManager } from "../../src/services/taskManager.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";

// Mock dependencies
vi.mock("../../src/managers/messageManager.js");
vi.mock("../../src/managers/toolManager.js");
vi.mock("../../src/managers/backgroundTaskManager.js");
vi.mock("../../src/managers/aiManager.js", () => ({
  AIManager: vi.fn().mockImplementation(function () {
    return {
      sendAIMessage: vi.fn().mockImplementation(async () => {
        // Simulate some work
        await new Promise((resolve) => setTimeout(resolve, 100));
        return "Test response";
      }),
      abortAIMessage: vi.fn(),
    };
  }),
}));

describe("SubagentManager - Abort Logic", () => {
  let subagentManager: SubagentManager;
  let mockMessageManager: MessageManager;
  let mockToolManager: ToolManager;
  let mockBackgroundTaskManager: BackgroundTaskManager;

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

    mockMessageManager = {
      addSubagentBlock: vi.fn(),
      updateSubagentBlock: vi.fn(),
      getSessionId: vi.fn().mockReturnValue("parent-session-id"),
      addUserMessage: vi.fn(),
      getMessages: vi
        .fn()
        .mockReturnValue([
          { role: "assistant", blocks: [{ type: "text", content: "Done" }] },
        ]),
    } as unknown as MessageManager;

    mockToolManager = {
      list: vi.fn(() => [{ name: "Read" }]),
      getPermissionManager: vi.fn(),
    } as unknown as ToolManager;

    mockBackgroundTaskManager = {
      generateId: vi.fn().mockReturnValue("task_123"),
      addTask: vi.fn(),
      getTask: vi.fn(),
      stopTask: vi.fn(),
    } as unknown as BackgroundTaskManager;

    const taskManager = {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
    } as unknown as TaskManager;

    subagentManager = new SubagentManager({
      workdir: "/test",
      parentToolManager: mockToolManager,
      parentMessageManager: mockMessageManager,
      taskManager,
      backgroundTaskManager: mockBackgroundTaskManager,
      getGatewayConfig: () => ({ apiKey: "test", baseURL: "test" }),
      getModelConfig: () => ({
        agentModel: "test-model",
        fastModel: "test-fast-model",
      }),
      getMaxInputTokens: () => 1000,
      getLanguage: () => "en",
    });
  });

  it("should abort subagent when NOT in background and parent aborts", async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    const abortController = new AbortController();

    const executePromise = subagentManager.executeTask(
      instance,
      "test prompt",
      abortController.signal,
      false,
    );

    // Abort immediately
    abortController.abort();

    await expect(executePromise).rejects.toThrow("Task was aborted");

    const aiManager = instance.aiManager;
    expect(aiManager.abortAIMessage).toHaveBeenCalled();
    expect(mockMessageManager.updateSubagentBlock).toHaveBeenCalledWith(
      instance.subagentId,
      {
        status: "aborted",
      },
    );
  });

  it("should NOT abort subagent when in background and parent aborts", async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    const abortController = new AbortController();

    // Execute in background
    const taskId = await subagentManager.executeTask(
      instance,
      "test prompt",
      abortController.signal,
      true,
    );
    expect(taskId).toBe("task_123");

    // Abort the parent signal
    abortController.abort();

    // Wait a bit to ensure any async listeners would have fired
    await new Promise((resolve) => setTimeout(resolve, 50));

    const aiManager = instance.aiManager;
    // Should NOT have been called because it's in background
    expect(aiManager.abortAIMessage).not.toHaveBeenCalled();

    // Status should NOT be aborted in parent block
    // Note: updateSubagentBlock might have been called with status: 'active' earlier
    const abortedCalls = vi
      .mocked(mockMessageManager.updateSubagentBlock)
      .mock.calls.filter((call) => call[1].status === "aborted");
    expect(abortedCalls.length).toBe(0);
  });

  it("should abort subagent when stopTask is called on background task", async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    // Mock background task manager to actually store and retrieve the task
    const tasks = new Map();
    vi.mocked(mockBackgroundTaskManager.addTask).mockImplementation((task) => {
      tasks.set(task.id, task);
    });
    vi.mocked(mockBackgroundTaskManager.getTask).mockImplementation((id) =>
      tasks.get(id),
    );

    // Real BackgroundTaskManager for stopTask logic
    // Adopt the mock's behavior for stopTask
    vi.mocked(mockBackgroundTaskManager.stopTask).mockImplementation((id) => {
      const task = tasks.get(id);
      if (task && task.type === "subagent") {
        const subagentId = task.subagentId;
        const subagentManager = task.subagentManager;
        const instance = subagentManager.getInstance(subagentId);
        if (instance) {
          instance.aiManager.abortAIMessage();
        }
        task.status = "killed";
        return true;
      }
      return false;
    });

    await subagentManager.executeTask(instance, "test prompt", undefined, true);

    // Wait for background task to start
    await new Promise((resolve) => setTimeout(resolve, 10));

    mockBackgroundTaskManager.stopTask("task_123");

    const aiManager = instance.aiManager;
    expect(aiManager.abortAIMessage).toHaveBeenCalled();
    expect(tasks.get("task_123").status).toBe("killed");
  });
});
