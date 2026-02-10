import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubagentManager } from "../../src/managers/subagentManager.js";
import { MessageManager } from "../../src/managers/messageManager.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { AIManager } from "../../src/managers/aiManager.js";
import type { Logger } from "../../src/types/index.js";
import type { SubagentConfiguration } from "../../src/utils/subagentParser.js";
import type { SessionData } from "../../src/services/session.js";

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

describe("SubagentManager - Backgrounding Coverage", () => {
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
    } as unknown as MessageManager;

    mockToolManager = {
      list: vi.fn(() => [{ name: "Read" }]),
      getPermissionManager: vi.fn(),
    } as unknown as ToolManager;

    mockBackgroundTaskManager = {
      generateId: vi.fn().mockReturnValue("task_123"),
      addTask: vi.fn(),
      getTask: vi.fn(),
    } as unknown as BackgroundTaskManager;

    subagentManager = new SubagentManager({
      workdir: "/test",
      parentToolManager: mockToolManager,
      parentMessageManager: mockMessageManager,
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

  it("should handle backgroundInstance error when instance not found", async () => {
    await expect(
      subagentManager.backgroundInstance("non-existent"),
    ).rejects.toThrow("Subagent instance non-existent not found");
  });

  it("should handle backgroundInstance error when backgroundTaskManager is missing", async () => {
    const managerNoBG = new SubagentManager({
      workdir: "/test",
      parentToolManager: mockToolManager,
      parentMessageManager: mockMessageManager,
      getGatewayConfig: () => ({ apiKey: "test", baseURL: "test" }),
      getModelConfig: () => ({ agentModel: "m", fastModel: "f" }),
      getMaxInputTokens: () => 1000,
      getLanguage: () => "en",
    });

    const instance = await managerNoBG.createInstance(testConfig, {
      description: "d",
      prompt: "p",
      subagent_type: "t",
    });

    await expect(
      managerNoBG.backgroundInstance(instance.subagentId),
    ).rejects.toThrow("BackgroundTaskManager not available");
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
    // We can't easily trigger the internal private method, but we can call executeTask
    // which calls internalExecute.
    vi.mocked(instance.messageManager.getMessages).mockReturnValue([
      { role: "assistant", blocks: [{ type: "text", content: "Done" }] },
    ] as unknown as ReturnType<typeof instance.messageManager.getMessages>);
    await subagentManager.executeTask(instance, "test prompt");

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
      subagentManager.executeTask(instance, "test prompt"),
    ).rejects.toThrow("AI Error");

    expect(mockTask.status).toBe("failed");
    expect(mockTask.stderr).toBe("AI Error");
  });

  it("should cover restoreSubagentSessions error path", async () => {
    const logger = {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
    } as unknown as Logger;
    const manager = new SubagentManager({
      workdir: "/test",
      parentToolManager: mockToolManager,
      parentMessageManager: mockMessageManager,
      getGatewayConfig: () => ({ apiKey: "test", baseURL: "test" }),
      getModelConfig: () => ({ agentModel: "m", fastModel: "f" }),
      getMaxInputTokens: () => 1000,
      getLanguage: () => "en",
      logger: logger,
    });

    // Trigger error by passing invalid session data (e.g. missing configuration)
    await manager.restoreSubagentSessions([
      {
        subagentId: "sub_1",
        sessionData: {
          id: "s1",
          messages: [],
          metadata: {},
        } as unknown as SessionData,
        configuration: null as unknown as SubagentConfiguration, // This will cause error when accessing configuration.name
      },
    ]);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to restore subagent session sub_1"),
      expect.any(Error),
    );
  });

  it("should cover createSubagentCallbacks reasoning update", async () => {
    const onSubagentAssistantReasoningUpdated = vi.fn();
    const manager = new SubagentManager({
      workdir: "/test",
      parentToolManager: mockToolManager,
      parentMessageManager: mockMessageManager,
      callbacks: { onSubagentAssistantReasoningUpdated },
      getGatewayConfig: () => ({ apiKey: "test", baseURL: "test" }),
      getModelConfig: () => ({ agentModel: "m", fastModel: "f" }),
      getMaxInputTokens: () => 1000,
      getLanguage: () => "en",
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
    const passedCallbacks = lastCall[0].callbacks;
    passedCallbacks.onAssistantReasoningUpdated?.("chunk", "accumulated");

    expect(onSubagentAssistantReasoningUpdated).toHaveBeenCalledWith(
      instance.subagentId,
      "chunk",
      "accumulated",
    );
  });
});
