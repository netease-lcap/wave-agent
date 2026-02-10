import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { taskOutputTool } from "../../src/tools/taskOutputTool.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import type { ToolContext } from "../../src/tools/types.js";
import type { BackgroundTask } from "../../src/types/processes.js";

describe("TaskOutput Tool Abort Handling", () => {
  let backgroundTaskManager: BackgroundTaskManager;
  let context: ToolContext;
  let abortController: AbortController;

  beforeEach(() => {
    vi.useFakeTimers();
    backgroundTaskManager = new BackgroundTaskManager({
      workdir: "/test/workdir",
    });
    abortController = new AbortController();
    context = {
      backgroundTaskManager,
      workdir: "/test/workdir",
      abortSignal: abortController.signal,
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should abort polling when abortSignal is triggered", async () => {
    const taskId = "test_task";
    backgroundTaskManager.addTask({
      id: taskId,
      type: "shell",
      status: "running",
      startTime: Date.now(),
      command: "sleep 100",
      stdout: "",
      stderr: "",
    });

    const executePromise = taskOutputTool.execute(
      {
        task_id: taskId,
        block: true,
      },
      context,
    );

    // Advance timers to ensure it's polling
    await vi.advanceTimersByTimeAsync(1000);

    // Trigger abort
    abortController.abort();

    const result = await executePromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe("Task output retrieval was aborted");
  });

  it("should return immediately if abortSignal is already aborted", async () => {
    const taskId = "test_task";
    backgroundTaskManager.addTask({
      id: taskId,
      type: "shell",
      status: "running",
      startTime: Date.now(),
      command: "sleep 100",
      stdout: "",
      stderr: "",
    });

    abortController.abort();

    const result = await taskOutputTool.execute(
      {
        task_id: taskId,
        block: true,
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("Task output retrieval was aborted");
  });

  it("should clean up listeners when task completes normally", async () => {
    const taskId = "test_task";
    const task = {
      id: taskId,
      type: "shell" as const,
      status: "running" as const,
      startTime: Date.now(),
      command: "echo hello",
      stdout: "hello",
      stderr: "",
    };
    backgroundTaskManager.addTask(task);

    const removeEventListenerSpy = vi.spyOn(
      abortController.signal,
      "removeEventListener",
    );

    const executePromise = taskOutputTool.execute(
      {
        task_id: taskId,
        block: true,
      },
      context,
    );

    // Simulate task completion
    (task as BackgroundTask).status = "completed";

    await vi.advanceTimersByTimeAsync(600);
    const result = await executePromise;

    expect(result.success).toBe(true);
    expect(result.content).toBe("hello");
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );
  });

  it("should clean up listeners when task is not found during polling", async () => {
    const taskId = "test_task";
    backgroundTaskManager.addTask({
      id: taskId,
      type: "shell",
      status: "running",
      startTime: Date.now(),
      command: "sleep 100",
      stdout: "",
      stderr: "",
    });

    const removeEventListenerSpy = vi.spyOn(
      abortController.signal,
      "removeEventListener",
    );

    const executePromise = taskOutputTool.execute(
      {
        task_id: taskId,
        block: true,
      },
      context,
    );

    // Simulate task removal
    vi.spyOn(backgroundTaskManager, "getTask").mockReturnValue(undefined);

    await vi.advanceTimersByTimeAsync(600);
    const result = await executePromise;

    expect(result.success).toBe(false);
    expect(result.error).toBe(`Task with ID ${taskId} not found`);
    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );
  });
});
