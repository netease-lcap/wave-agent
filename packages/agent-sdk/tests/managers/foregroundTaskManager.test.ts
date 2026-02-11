import { describe, it, expect, vi } from "vitest";
import { ForegroundTaskManager } from "../../src/managers/foregroundTaskManager.js";
import { ForegroundTask } from "../../src/types/processes.js";

describe("ForegroundTaskManager", () => {
  it("should register and unregister foreground tasks", () => {
    const manager = new ForegroundTaskManager();
    const task: ForegroundTask = {
      id: "test-task",
      backgroundHandler: vi.fn().mockResolvedValue(undefined),
    };

    manager.registerForegroundTask(task);
    // Internal state is private, but we can test behavior via backgroundCurrentTask

    manager.unregisterForegroundTask("test-task");
    // After unregistering, backgrounding should do nothing
  });

  it("should background the current task and remove it from the stack", async () => {
    const manager = new ForegroundTaskManager();
    const backgroundHandler = vi.fn().mockResolvedValue(undefined);
    const task: ForegroundTask = {
      id: "test-task",
      backgroundHandler,
    };

    manager.registerForegroundTask(task);
    await manager.backgroundCurrentTask();

    expect(backgroundHandler).toHaveBeenCalledTimes(1);

    // Calling it again should not call the handler again (task was popped)
    await manager.backgroundCurrentTask();
    expect(backgroundHandler).toHaveBeenCalledTimes(1);
  });

  it("should background all tasks in the stack", async () => {
    const manager = new ForegroundTaskManager();
    const handler1 = vi.fn().mockResolvedValue(undefined);
    const handler2 = vi.fn().mockResolvedValue(undefined);

    manager.registerForegroundTask({
      id: "task1",
      backgroundHandler: handler1,
    });
    manager.registerForegroundTask({
      id: "task2",
      backgroundHandler: handler2,
    });

    await manager.backgroundCurrentTask();
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler1).toHaveBeenCalledTimes(1);

    // Calling it again should not call handlers again (tasks were popped)
    await manager.backgroundCurrentTask();
    expect(handler2).toHaveBeenCalledTimes(1);
    expect(handler1).toHaveBeenCalledTimes(1);
  });

  it("should do nothing if no tasks are registered", async () => {
    const manager = new ForegroundTaskManager();
    await expect(manager.backgroundCurrentTask()).resolves.not.toThrow();
  });

  it("should not fail when unregistering non-existent task", () => {
    const manager = new ForegroundTaskManager();
    expect(() =>
      manager.unregisterForegroundTask("non-existent"),
    ).not.toThrow();
  });

  it("should handle race condition where task is unregistered while backgrounding is requested", async () => {
    const manager = new ForegroundTaskManager();
    const handler = vi.fn().mockResolvedValue(undefined);
    const task: ForegroundTask = {
      id: "test-task",
      backgroundHandler: handler,
    };

    manager.registerForegroundTask(task);

    // Simulate task finishing (unregistering) just before backgrounding logic processes it
    manager.unregisterForegroundTask("test-task");

    await manager.backgroundCurrentTask();

    // Handler should not be called because the task was already removed from the stack by unregister
    expect(handler).not.toHaveBeenCalled();
  });
});
