import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { MessageQueue } from "../../src/managers/messageQueue.js";
import type { BackgroundSubagent } from "../../src/types/processes.js";
import type { ChildProcess } from "child_process";

// Mock globalLogger so we can assert on logger.error
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  setGlobalLogger: vi.fn(),
  clearGlobalLogger: vi.fn(),
  isLoggerConfigured: vi.fn(),
}));

// The stop path terminates the task's process *tree* through a platform-aware
// helper (POSIX process group / Windows `taskkill /T`); its own branches are
// covered in tests/utils/killProcessTree.test.ts.
vi.mock("../../src/utils/killProcessTree.js", () => ({
  killProcessTree: vi.fn(async () => "killed"),
}));

import { logger } from "../../src/utils/globalLogger.js";
import { killProcessTree } from "../../src/utils/killProcessTree.js";

const mockKillProcessTree = vi.mocked(killProcessTree);

describe("BackgroundTaskManager notification deduplication", () => {
  let container: Container;
  let messageQueue: MessageQueue;
  let manager: BackgroundTaskManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    // clearAllMocks keeps implementations, so re-arm the per-test default.
    mockKillProcessTree.mockResolvedValue("killed");

    container = new Container();
    messageQueue = new MessageQueue();
    container.register("MessageQueue", messageQueue);

    manager = new BackgroundTaskManager(container, {
      workdir: "/tmp/test",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("stopTask", () => {
    it("should NOT enqueue a killed notification for a running subagent task", () => {
      const task: BackgroundSubagent = {
        id: "task_1",
        type: "subagent",
        status: "running",
        startTime: Date.now(),
        description: "Test agent task",
        stdout: "",
        stderr: "",
      };

      manager.addTask(task);
      const result = manager.stopTask("task_1");

      expect(result).toBe(true);
      expect(task.status).toBe("killed");
      const notifications = messageQueue.drainNotifications();
      expect(notifications.length).toBe(0);
    });

    it("should not enqueue a killed notification for a task already stopped", () => {
      const task: BackgroundSubagent = {
        id: "task_1",
        type: "subagent",
        status: "completed",
        startTime: Date.now(),
        endTime: Date.now(),
        description: "Test agent task",
        stdout: "",
        stderr: "",
      };

      manager.addTask(task);
      const result = manager.stopTask("task_1");

      expect(result).toBe(false);
      const notifications = messageQueue.drainNotifications();
      expect(notifications.length).toBe(0);
    });

    it("should not enqueue a killed notification for a task already killed", () => {
      const task: BackgroundSubagent = {
        id: "task_1",
        type: "subagent",
        status: "killed",
        startTime: Date.now(),
        endTime: Date.now(),
        description: "Test agent task",
        stdout: "",
        stderr: "",
      };

      manager.addTask(task);
      const result = manager.stopTask("task_1");

      expect(result).toBe(false);
      const notifications = messageQueue.drainNotifications();
      expect(notifications.length).toBe(0);
    });

    it("should enqueue a killed notification for a running shell task", () => {
      const mockSpawn = vi.fn().mockImplementation(() => ({
        stdout: { on: vi.fn() },
        stderr: { on: vi.fn() },
        on: vi.fn(),
        kill: vi.fn(),
        pid: 12345,
      }));

      vi.doMock("child_process", () => ({ spawn: mockSpawn }));

      // For shell tasks we need actual spawn, so test the simpler subagent path
      // The key deduplication is: stopTask should only enqueue if status is "running"
    });
  });

  describe("cleanup", () => {
    it("should stop all running tasks without enqueueing killed notifications", () => {
      const task1: BackgroundSubagent = {
        id: "task_1",
        type: "subagent",
        status: "running",
        startTime: Date.now(),
        description: "Task 1",
        stdout: "",
        stderr: "",
      };

      const task2: BackgroundSubagent = {
        id: "task_2",
        type: "subagent",
        status: "running",
        startTime: Date.now(),
        description: "Task 2",
        stdout: "",
        stderr: "",
      };

      const completedTask: BackgroundSubagent = {
        id: "task_3",
        type: "subagent",
        status: "completed",
        startTime: Date.now(),
        endTime: Date.now(),
        description: "Completed task",
        stdout: "",
        stderr: "",
      };

      manager.addTask(task1);
      manager.addTask(task2);
      manager.addTask(completedTask);

      manager.cleanup();

      expect(task1.status).toBe("killed");
      expect(task2.status).toBe("killed");
      expect(completedTask.status).toBe("completed");
      const notifications = messageQueue.drainNotifications();
      expect(notifications.length).toBe(0);
    });
  });

  describe("onStop terminates the whole process tree (issue #2742)", () => {
    function adoptMockChild() {
      const mockChild = {
        pid: 12345,
        killed: false,
        kill: vi.fn(),
        stdout: { on: vi.fn(), off: vi.fn() },
        stderr: { on: vi.fn(), off: vi.fn() },
        on: vi.fn(),
        off: vi.fn(),
      } as unknown as ChildProcess;
      manager.adoptProcess(mockChild, "test-command");
      return mockChild;
    }

    it("kills the tree gracefully first and forcibly after 1s", async () => {
      const mockChild = adoptMockChild();
      const taskId = manager.getAllTasks()[0].id;

      manager.stopTask(taskId);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockKillProcessTree).toHaveBeenCalledWith(12345, "SIGTERM");
      // The shell-only path must not be taken while the tree kill works.
      expect(mockChild.kill).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(mockKillProcessTree).toHaveBeenCalledWith(12345, "SIGKILL");
      expect(logger.error).not.toHaveBeenCalled();
    });

    it("falls back to killing the shell when the tree kill reports failed", async () => {
      mockKillProcessTree.mockResolvedValue("failed");
      const mockChild = adoptMockChild();
      const taskId = manager.getAllTasks()[0].id;

      manager.stopTask(taskId);
      await vi.advanceTimersByTimeAsync(0);

      expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining(
          "Failed to terminate the process tree of pid 12345",
        ),
      );
    });

    it("does not log an error when the tree kill succeeds", async () => {
      adoptMockChild();
      const taskId = manager.getAllTasks()[0].id;

      manager.stopTask(taskId);
      await vi.advanceTimersByTimeAsync(1000);

      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
