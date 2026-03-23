import { describe, it, expect, vi, beforeEach } from "vitest";
import * as fs from "fs";
import { TaskManager } from "../../src/services/taskManager.js";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
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

describe("SubagentManager - Backgrounding Coverage", () => {
  let subagentManager: SubagentManager;
  let mockToolManager: ToolManager;
  let mockBackgroundTaskManager: BackgroundTaskManager;
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

    const taskManager = {
      on: vi.fn(),
      listTasks: vi.fn().mockResolvedValue([]),
      getTaskListId: vi.fn().mockReturnValue("test-task-list"),
    } as unknown as TaskManager;

    container = new Container();
    container.register("ToolManager", mockToolManager);
    container.register("TaskManager", taskManager);
    container.register("BackgroundTaskManager", mockBackgroundTaskManager);

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

  it("should handle backgroundInstance error when backgroundTaskManager is missing", async () => {
    const managerNoBG = new SubagentManager(container, {
      workdir: "/test",
      stream: false,
    });
    // Remove BackgroundTaskManager from container for this test
    (
      container as unknown as { services: Map<string, unknown> }
    ).services.delete("BackgroundTaskManager");

    const instance = await managerNoBG.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    await expect(
      managerNoBG.backgroundInstance(instance.subagentId),
    ).rejects.toThrow("BackgroundTaskManager not available");
  });

  it("should handle backgroundInstance error when instance not found", async () => {
    await expect(
      subagentManager.backgroundInstance("non-existent"),
    ).rejects.toThrow("Subagent instance non-existent not found");
  });

  it("should update background task on completion", async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
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

    // Trigger internalExecute completion logic
    // We can't easily trigger the internal private method, but we can call executeAgent
    // which calls internalExecute.
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([
      { role: "assistant", blocks: [{ type: "text", content: "Done" }] },
    ] as unknown as ReturnType<typeof instance.messageManager.getMessages>);
    await subagentManager.executeAgent(instance, "test prompt");

    expect(mockTask.status).toBe("completed");
    expect(mockTask.endTime).toBeGreaterThan(0);
  });

  it("should update background task on error", async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
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

    // Mock internalExecute to throw by mocking aiManager.sendAIMessage
    const aiManager = (instance as unknown as { aiManager: AIManager })
      .aiManager;
    vi.spyOn(aiManager, "sendAIMessage").mockRejectedValue(
      new Error("AI Error"),
    );
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([]);

    await expect(
      subagentManager.executeAgent(instance, "test prompt"),
    ).rejects.toThrow("AI Error");

    expect(mockTask.status).toBe("failed");
    expect(mockTask.stderr).toBe("AI Error");
  });

  it("should cover createSubagentCallbacks reasoning update", async () => {
    const onSubagentAssistantReasoningUpdated = vi.fn();

    const manager = new SubagentManager(container, {
      workdir: "/test",
      stream: false,
      callbacks: { onSubagentAssistantReasoningUpdated },
    });

    const instance = await manager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    // In the test, MessageManager is mocked, so we need to make sure it has the callbacks
    // But wait, if it's mocked, (instance.messageManager as any).callbacks might be undefined
    // unless we set it.
    // Let's check how createInstance is implemented. It passes subagentCallbacks to MessageManager constructor.
    // Since MessageManager is mocked, we need to capture what was passed to the constructor.
    const MessageManagerMock = vi.mocked(MessageManager);
    const lastCall =
      MessageManagerMock.mock.calls[MessageManagerMock.mock.calls.length - 1];
    const passedCallbacks = lastCall[1].callbacks;
    passedCallbacks.onAssistantReasoningUpdated?.("chunk", "accumulated");

    expect(onSubagentAssistantReasoningUpdated).toHaveBeenCalledWith(
      instance.subagentId,
      "chunk",
      "accumulated",
    );
  });

  it("should create a log file and log tool execution for background subagent", async () => {
    const instance = await subagentManager.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    await subagentManager.backgroundInstance(instance.subagentId);

    expect(mockBackgroundTaskManager.addTask).toHaveBeenCalledWith(
      expect.objectContaining({
        outputPath: expect.stringContaining("wave-subagent-task_123.log"),
      }),
    );

    const addTaskMock = vi.mocked(mockBackgroundTaskManager.addTask);
    const outputPath = addTaskMock.mock.calls[0][0].outputPath!;
    await vi.waitFor(() => expect(fs.existsSync(outputPath)).toBe(true));

    // Capture callbacks passed to MessageManager
    const MessageManagerMock = vi.mocked(MessageManager);
    const lastCall =
      MessageManagerMock.mock.calls[MessageManagerMock.mock.calls.length - 1];
    const passedCallbacks = lastCall[1].callbacks;

    // Trigger tool block update
    passedCallbacks.onToolBlockUpdated?.({
      id: "tool_123",
      stage: "running",
      name: "Read",
      parameters: JSON.stringify({ file_path: "test.txt" }),
    });

    // Wait for file write
    await new Promise((resolve) => setTimeout(resolve, 100));

    const content = fs.readFileSync(outputPath, "utf8");
    expect(content).toContain("Running tool: Read");
    expect(content).toContain("test.txt");

    // Cleanup
    if (fs.existsSync(outputPath)) {
      fs.unlinkSync(outputPath);
    }
  });
});
