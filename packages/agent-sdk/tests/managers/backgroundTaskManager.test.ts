import { describe, it, expect, beforeEach, vi } from "vitest";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { BackgroundTask } from "../../src/types/processes.js";

describe("BackgroundTaskManager", () => {
  let manager: BackgroundTaskManager;
  let mockCallbacks: { onTasksChange: (tasks: BackgroundTask[]) => void };

  beforeEach(() => {
    mockCallbacks = { onTasksChange: vi.fn() };
    manager = new BackgroundTaskManager({
      callbacks: mockCallbacks,
      workdir: process.cwd(),
    });
  });

  it("should generate unique task IDs", () => {
    const id1 = manager.generateId();
    const id2 = manager.generateId();
    expect(id1).toBe("task_1");
    expect(id2).toBe("task_2");
  });

  it("should add and retrieve tasks", () => {
    const task: BackgroundTask = {
      id: "task_1",
      type: "subagent",
      status: "running",
      startTime: Date.now(),
      stdout: "",
      stderr: "",
    };
    manager.addTask(task);
    expect(manager.getTask("task_1")).toEqual(task);
    expect(manager.getAllTasks()).toContain(task);
    expect(mockCallbacks.onTasksChange).toHaveBeenCalledWith([task]);
  });

  it("should start a shell task", async () => {
    const id = manager.startShell("echo hello");
    expect(id).toBe("task_1");
    const task = manager.getTask(id);
    expect(task?.type).toBe("shell");
    expect(task?.status).toBe("running");
  });

  it("should stop a running task", () => {
    const task: BackgroundTask = {
      id: "task_1",
      type: "subagent",
      status: "running",
      startTime: Date.now(),
      stdout: "",
      stderr: "",
    };
    manager.addTask(task);
    const result = manager.stopTask("task_1");
    expect(result).toBe(true);
    expect(manager.getTask("task_1")?.status).toBe("killed");
  });

  it("should retrieve output with filter", () => {
    const task: BackgroundTask = {
      id: "task_1",
      type: "subagent",
      status: "running",
      startTime: Date.now(),
      stdout: "line1\nline2\nmatch",
      stderr: "error1\nerror2",
    };
    manager.addTask(task);
    const output = manager.getOutput("task_1", "match");
    expect(output?.stdout).toBe("match");
    expect(output?.stderr).toBe("");
  });

  it("should handle cleanup", () => {
    const task: BackgroundTask = {
      id: "task_1",
      type: "subagent",
      status: "running",
      startTime: Date.now(),
      stdout: "",
      stderr: "",
    };
    manager.addTask(task);
    manager.cleanup();
    expect(manager.getAllTasks().length).toBe(0);
    expect(mockCallbacks.onTasksChange).toHaveBeenCalled();
  });

  it("should handle invalid regex filter", () => {
    const task: BackgroundTask = {
      id: "task_1",
      type: "subagent",
      status: "running",
      startTime: Date.now(),
      stdout: "test",
      stderr: "",
    };
    manager.addTask(task);
    const output = manager.getOutput("task_1", "["); // Invalid regex
    expect(output?.stdout).toBe("test"); // Should return unfiltered
  });

  it("should return null for non-existent task output", () => {
    expect(manager.getOutput("invalid")).toBeNull();
  });

  it("should return false when stopping non-existent task", () => {
    expect(manager.stopTask("invalid")).toBe(false);
  });

  it("should return false when stopping already stopped task", () => {
    const task: BackgroundTask = {
      id: "task_1",
      type: "subagent",
      status: "completed",
      startTime: Date.now(),
      stdout: "",
      stderr: "",
    };
    manager.addTask(task);
    expect(manager.stopTask("task_1")).toBe(false);
  });
});
