import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import * as fs from "fs";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { BackgroundTask, BackgroundShell } from "../../src/types/processes.js";
import { Container } from "../../src/utils/container.js";

describe("BackgroundTaskManager", () => {
  let manager: BackgroundTaskManager;
  let mockCallbacks: {
    onBackgroundTasksChange: (tasks: BackgroundTask[]) => void;
  };

  beforeEach(() => {
    mockCallbacks = { onBackgroundTasksChange: vi.fn() };
    const container = new Container();
    manager = new BackgroundTaskManager(container, {
      callbacks: mockCallbacks,
      workdir: process.cwd(),
    });
  });

  afterEach(() => {
    const tasks = manager.getAllTasks();
    manager.cleanup();
    for (const task of tasks) {
      if (
        "outputPath" in task &&
        task.outputPath &&
        fs.existsSync(task.outputPath)
      ) {
        try {
          fs.unlinkSync(task.outputPath);
        } catch {
          // Ignore errors
        }
      }
    }
  });

  it("should generate unique task IDs", () => {
    const id1 = manager.generateId();
    const id2 = manager.generateId();
    expect(id1).toMatch(/^task_\d+_1-/);
    expect(id2).toMatch(/^task_\d+_2-/);
  });

  it("should add and retrieve tasks", () => {
    const id = manager.generateId();
    const task: BackgroundTask = {
      id,
      type: "subagent",
      status: "running",
      startTime: Date.now(),
      stdout: "",
      stderr: "",
    };
    manager.addTask(task);
    expect(manager.getTask(id)).toEqual(task);
    expect(manager.getAllTasks()).toContain(task);
    expect(mockCallbacks.onBackgroundTasksChange).toHaveBeenCalledWith([task]);
  });

  it("should start a shell task", async () => {
    const { id } = manager.startShell("echo hello");
    expect(id).toMatch(/^task_\d+_1-/);
    const task = manager.getTask(id);
    expect(task?.type).toBe("shell");
    expect(task?.status).toBe("running");
  });

  it("should stop a running task", () => {
    const id = manager.generateId();
    const task: BackgroundTask = {
      id,
      type: "subagent",
      status: "running",
      startTime: Date.now(),
      stdout: "",
      stderr: "",
    };
    manager.addTask(task);
    const result = manager.stopTask(id);
    expect(result).toBe(true);
    expect(manager.getTask(id)?.status).toBe("killed");
  });

  it("should retrieve output with filter", () => {
    const id = manager.generateId();
    const task: BackgroundTask = {
      id,
      type: "subagent",
      status: "running",
      startTime: Date.now(),
      stdout: "line1\nline2\nmatch",
      stderr: "error1\nerror2",
    };
    manager.addTask(task);
    const output = manager.getOutput(id, "match");
    expect(output?.stdout).toBe("match");
    expect(output?.stderr).toBe("");
  });

  it("should handle cleanup", () => {
    const id = manager.generateId();
    const task: BackgroundTask = {
      id,
      type: "subagent",
      status: "running",
      startTime: Date.now(),
      stdout: "",
      stderr: "",
    };
    manager.addTask(task);
    manager.cleanup();
    expect(manager.getAllTasks().length).toBe(0);
    expect(mockCallbacks.onBackgroundTasksChange).toHaveBeenCalled();
  });

  it("should handle invalid regex filter", () => {
    const id = manager.generateId();
    const task: BackgroundTask = {
      id,
      type: "subagent",
      status: "running",
      startTime: Date.now(),
      stdout: "test",
      stderr: "",
    };
    manager.addTask(task);
    const output = manager.getOutput(id, "["); // Invalid regex
    expect(output?.stdout).toBe("test"); // Should return unfiltered
  });

  it("should return null for non-existent task output", () => {
    expect(manager.getOutput("invalid")).toBeNull();
  });

  it("should return false when stopping non-existent task", () => {
    expect(manager.stopTask("invalid")).toBe(false);
  });

  it("should return false when stopping already stopped task", () => {
    const id = manager.generateId();
    const task: BackgroundTask = {
      id,
      type: "subagent",
      status: "completed",
      startTime: Date.now(),
      stdout: "",
      stderr: "",
    };
    manager.addTask(task);
    expect(manager.stopTask(id)).toBe(false);
  });

  it("should handle shell process error", async () => {
    const { id } = manager.startShell("non-existent-command");
    const task = manager.getTask(id) as BackgroundShell;

    // Manually trigger error event
    task.process.emit("error", new Error("Spawn error"));

    expect(task.status).toBe("failed");
    expect(task.stderr).toContain("Process error: Spawn error");
  });

  it("should handle shell process exit with non-zero code", async () => {
    const { id } = manager.startShell("exit 1");
    const task = manager.getTask(id) as BackgroundShell;

    // Manually trigger exit event
    task.process.emit("exit", 1);

    expect(task.status).toBe("failed");
    expect(task.exitCode).toBe(1);
  });

  it("should handle shell process timeout", async () => {
    vi.useFakeTimers();
    const { id } = manager.startShell("sleep 10", 100);
    const task = manager.getTask(id) as BackgroundShell;

    vi.advanceTimersByTime(150);

    expect(task.status).toBe("killed");
    vi.useRealTimers();
  });

  it("should handle process kill failure", () => {
    const { id } = manager.startShell("sleep 10");
    const task = manager.getTask(id) as BackgroundShell;

    // Mock process.kill to throw
    const originalKill = process.kill;
    process.kill = vi.fn().mockImplementation(() => {
      throw new Error("Kill failed");
    });

    // Mock shell.process.kill to throw
    task.process.kill = vi.fn().mockImplementation(() => {
      throw new Error("Direct kill failed");
    });

    // Even if kill fails, stopTask returns true because it marks the task as killed
    const result = manager.stopTask(id);
    expect(result).toBe(true);

    process.kill = originalKill;
  });

  it("should create a log file and write output to it", async () => {
    const uniqueId = `task_unique_${Math.random().toString(36).substring(7)}`;
    vi.spyOn(manager, "generateId").mockReturnValue(uniqueId);
    const { id } = manager.startShell("sleep 10");
    expect(id).toBe(uniqueId);
    const task = manager.getTask(id) as BackgroundShell;
    expect(task.outputPath).toBeDefined();

    await vi.waitFor(() => expect(fs.existsSync(task.outputPath!)).toBe(true));

    // Manually trigger stdout event
    task.process.stdout?.emit("data", Buffer.from("hello world\n"));

    // Wait for file write
    await vi.waitFor(
      () => {
        const content = fs.readFileSync(task.outputPath!, "utf8");
        return content.includes("hello world");
      },
      { timeout: 1000 },
    );

    // Cleanup
    manager.stopTask(id);
  });
});
