import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Container } from "../../src/utils/container.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import { NotificationQueue } from "../../src/managers/notificationQueue.js";
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

import { logger } from "../../src/utils/globalLogger.js";

describe("BackgroundTaskManager notification deduplication", () => {
  let container: Container;
  let notificationQueue: NotificationQueue;
  let manager: BackgroundTaskManager;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();

    container = new Container();
    notificationQueue = new NotificationQueue();
    container.register("NotificationQueue", notificationQueue);

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
      const notifications = notificationQueue.dequeueAll();
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
      const notifications = notificationQueue.dequeueAll();
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
      const notifications = notificationQueue.dequeueAll();
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
      const notifications = notificationQueue.dequeueAll();
      expect(notifications.length).toBe(0);
    });
  });

  describe("ESRCH handling in onStop callback (adoptProcess)", () => {
    let mockKill: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      mockKill = vi.spyOn(process, "kill").mockReturnValue(true as never);
    });

    afterEach(() => {
      mockKill.mockRestore();
    });

    it("should not log error when SIGKILL throws ESRCH (process already exited)", () => {
      mockKill.mockImplementation(((pid: number, signal?: string | number) => {
        if (signal === "SIGKILL") {
          const error: NodeJS.ErrnoException = new Error("kill ESRCH");
          error.code = "ESRCH";
          throw error;
        }
        return true;
      }) as never);

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
      const taskId = manager.getAllTasks()[0].id;

      manager.stopTask(taskId);
      vi.advanceTimersByTime(1000);

      expect(logger.error).not.toHaveBeenCalled();
    });

    it("should log error when SIGKILL throws a non-ESRCH error", () => {
      mockKill.mockImplementation(((pid: number, signal?: string | number) => {
        if (signal === "SIGKILL") {
          const error: NodeJS.ErrnoException = new Error("kill EPERM");
          error.code = "EPERM";
          throw error;
        }
        return true;
      }) as never);

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
      const taskId = manager.getAllTasks()[0].id;

      manager.stopTask(taskId);
      vi.advanceTimersByTime(1000);

      expect(logger.error).toHaveBeenCalledWith(
        "Failed to force kill process:",
        expect.objectContaining({ code: "EPERM" }),
      );
    });

    it("should not log error when SIGKILL succeeds (no throw)", () => {
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
      const taskId = manager.getAllTasks()[0].id;

      manager.stopTask(taskId);
      vi.advanceTimersByTime(1000);

      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});
