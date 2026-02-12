import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import { BackgroundTaskManager } from "@/managers/backgroundTaskManager.js";
import { BackgroundTask, BackgroundShell } from "@/types/processes.js";
import { ToolBlock } from "@/types/messaging.js";

// Mock AI Service
vi.mock("@/services/aiService");

// Mock tool registry
const { instance: mockToolManagerInstance, execute: mockToolExecute } =
  createMockToolManager();
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

describe("Agent Background Task Recursion Tests", () => {
  let agent: Agent;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Create Agent instance
    agent = await Agent.create({
      callbacks: {},
    });
  });

  it("should trigger recursion when a background task completes", async () => {
    const mockCallAgent = vi.mocked(aiService.callAgent);
    mockCallAgent.mockResolvedValue({
      content: "I see the task is finished.",
    });

    mockToolExecute.mockResolvedValue({
      success: true,
      content: "task output",
      shortResult: "task_1: completed",
    });

    // Access private backgroundTaskManager to simulate task change
    const bgManager = (
      agent as unknown as { backgroundTaskManager: BackgroundTaskManager }
    ).backgroundTaskManager;

    // Simulate a task starting and then completing
    const task: BackgroundShell = {
      id: "task_1",
      status: "running",
      type: "shell",
      command: "sleep 1",
      stdout: "",
      stderr: "",
      startTime: Date.now(),
      process: {
        pid: 123,
        killed: false,
      } as unknown as BackgroundShell["process"],
    };

    // 1. Task starts running
    (bgManager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(
      task.id,
      task,
    );
    (
      bgManager as unknown as { notifyTasksChange: () => void }
    ).notifyTasksChange();

    // 2. Task completes
    const completedTask: BackgroundShell = { ...task, status: "completed" };
    (bgManager as unknown as { tasks: Map<string, BackgroundTask> }).tasks.set(
      task.id,
      completedTask,
    );
    (
      bgManager as unknown as { notifyTasksChange: () => void }
    ).notifyTasksChange();

    // Wait for async operations in handleBackgroundTasksChange
    await vi.waitFor(() => {
      expect(mockToolExecute).toHaveBeenCalledWith(
        "TaskOutput",
        { task_id: "task_1", block: false },
        expect.any(Object),
      );
      expect(mockCallAgent).toHaveBeenCalled();
    });

    // Verify message history contains the TaskOutput tool call
    const messages = agent.messages;
    const assistantMessage = messages.find((m) => m.role === "assistant");
    expect(assistantMessage).toBeDefined();
    const toolBlock = assistantMessage?.blocks.find(
      (b) => b.type === "tool" && (b as ToolBlock).name === "TaskOutput",
    ) as ToolBlock | undefined;
    expect(toolBlock).toBeDefined();
    expect(toolBlock?.result).toBe("task output");
  });
});
