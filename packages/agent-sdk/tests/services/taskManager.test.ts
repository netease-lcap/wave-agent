import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskManager } from "../../src/services/taskManager.js";
import { Task } from "../../src/types/tasks.js";
import { promises as fs } from "fs";

vi.mock("fs", () => ({
  promises: {
    readdir: vi.fn(),
    mkdir: vi.fn(),
    open: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    unlink: vi.fn(),
  },
}));

vi.mock("os", () => ({
  homedir: vi.fn(() => "/mock/home"),
}));

// Mock logger to avoid noise
vi.mock("../../src/utils/globalLogger.js", () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("TaskManager", () => {
  let taskManager: TaskManager;
  const sessionId = "test-session";
  const mockTask: Task = {
    id: "1",
    subject: "Test Task",
    description: "Test Description",
    status: "pending",
    blocks: [],
    blockedBy: [],
    metadata: {},
  };

  beforeEach(() => {
    vi.clearAllMocks();
    taskManager = new TaskManager();
  });

  describe("Basic CRUD Operations", () => {
    it("should create a task", async () => {
      const mockFileHandle = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(fs.open).mockResolvedValue(
        mockFileHandle as unknown as Awaited<ReturnType<typeof fs.open>>,
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
      );

      await taskManager.createTask(sessionId, mockTask);

      expect(fs.mkdir).toHaveBeenCalledWith(
        expect.stringContaining(sessionId),
        { recursive: true },
      );
      expect(fs.open).toHaveBeenCalledWith(
        expect.stringMatching(/\/\.lock$/),
        "wx",
      );
      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("1.json"),
        expect.stringContaining('"subject": "Test Task"'),
        "utf8",
      );
      expect(mockFileHandle.close).toHaveBeenCalled();
      expect(fs.unlink).toHaveBeenCalledWith(
        expect.stringMatching(/\/\.lock$/),
      );
    });

    it("should get a task", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockTask));

      const task = await taskManager.getTask(sessionId, "1");

      expect(task).toEqual(mockTask);
      expect(fs.readFile).toHaveBeenCalledWith(
        expect.stringContaining("1.json"),
        "utf8",
      );
    });

    it("should return null if task does not exist", async () => {
      const error = new Error("File not found") as NodeJS.ErrnoException;
      error.code = "ENOENT";
      vi.mocked(fs.readFile).mockRejectedValue(error);

      const task = await taskManager.getTask(sessionId, "non-existent");

      expect(task).toBeNull();
    });

    it("should update a task", async () => {
      const mockFileHandle = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(fs.open).mockResolvedValue(
        mockFileHandle as unknown as Awaited<ReturnType<typeof fs.open>>,
      );
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);

      const updatedTask = { ...mockTask, status: "in_progress" as const };
      await taskManager.updateTask(sessionId, updatedTask);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining("1.json"),
        expect.stringContaining('"status": "in_progress"'),
        "utf8",
      );
    });

    it("should list tasks", async () => {
      vi.mocked(fs.readdir).mockResolvedValue([
        "1.json",
        "2.json",
      ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);
      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(mockTask))
        .mockResolvedValueOnce(JSON.stringify({ ...mockTask, id: "2" }));

      const tasks = await taskManager.listTasks(sessionId);

      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe("1");
      expect(tasks[1].id).toBe("2");
    });
  });

  describe("Validation Logic", () => {
    it("should throw error for invalid task ID", async () => {
      const invalidTask = { ...mockTask, id: "" };
      vi.mocked(fs.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
      );
      const mockFileHandle = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(fs.open).mockResolvedValue(
        mockFileHandle as unknown as Awaited<ReturnType<typeof fs.open>>,
      );

      const taskId = await taskManager.createTask(sessionId, invalidTask);
      expect(taskId).toBe("1");
    });

    it("should throw error for invalid task subject", async () => {
      const invalidTask = { ...mockTask, subject: "" };
      vi.mocked(fs.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
      );
      const mockFileHandle = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(fs.open).mockResolvedValue(
        mockFileHandle as unknown as Awaited<ReturnType<typeof fs.open>>,
      );
      await expect(
        taskManager.createTask(sessionId, invalidTask),
      ).rejects.toThrow("Invalid task subject");
    });

    it("should throw error for invalid task status", async () => {
      const invalidTask = {
        ...mockTask,
        status: "invalid" as unknown as Task["status"],
      };
      vi.mocked(fs.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
      );
      const mockFileHandle = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(fs.open).mockResolvedValue(
        mockFileHandle as unknown as Awaited<ReturnType<typeof fs.open>>,
      );
      await expect(
        taskManager.createTask(sessionId, invalidTask),
      ).rejects.toThrow("Invalid task status");
    });
  });

  describe("Concurrency and Locking", () => {
    it("should retry if lock exists and eventually succeed", async () => {
      const mockFileHandle = {
        close: vi.fn().mockResolvedValue(undefined),
      };

      const lockError = new Error("File exists") as NodeJS.ErrnoException;
      lockError.code = "EEXIST";

      vi.mocked(fs.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
      );

      // Fail twice, then succeed
      vi.mocked(fs.open)
        .mockRejectedValueOnce(lockError)
        .mockRejectedValueOnce(lockError)
        .mockResolvedValueOnce(
          mockFileHandle as unknown as Awaited<ReturnType<typeof fs.open>>,
        );

      await taskManager.createTask(sessionId, mockTask);

      expect(fs.open).toHaveBeenCalledTimes(3);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it("should throw error if lock retries exhausted", async () => {
      const lockError = new Error("File exists") as NodeJS.ErrnoException;
      lockError.code = "EEXIST";

      vi.mocked(fs.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
      );
      vi.mocked(fs.open).mockRejectedValue(lockError);

      await expect(taskManager.createTask(sessionId, mockTask)).rejects.toThrow(
        `Could not acquire lock for session ${sessionId} after 100 retries`,
      );
    });

    it("should ensure lock is released even if operation fails", async () => {
      const mockFileHandle = {
        close: vi.fn().mockResolvedValue(undefined),
      };
      vi.mocked(fs.readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof fs.readdir>>,
      );
      vi.mocked(fs.open).mockResolvedValue(
        mockFileHandle as unknown as Awaited<ReturnType<typeof fs.open>>,
      );
      vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error("Write failed"));

      await expect(taskManager.createTask(sessionId, mockTask)).rejects.toThrow(
        "Write failed",
      );

      expect(mockFileHandle.close).toHaveBeenCalled();
      expect(fs.unlink).toHaveBeenCalledWith(
        expect.stringMatching(/\/\.lock$/),
      );
    });

    it("should handle concurrent updates by waiting for lock", async () => {
      const mockFileHandle = {
        close: vi.fn().mockResolvedValue(undefined),
      };

      let lockAcquired = false;
      vi.mocked(fs.open).mockImplementation(async (path, flags) => {
        if (flags === "wx") {
          if (lockAcquired) {
            const error = new Error("EEXIST") as NodeJS.ErrnoException;
            error.code = "EEXIST";
            throw error;
          }
          lockAcquired = true;
          return mockFileHandle as unknown as Awaited<
            ReturnType<typeof fs.open>
          >;
        }
        return {} as unknown as Awaited<ReturnType<typeof fs.open>>;
      });

      vi.mocked(fs.unlink).mockImplementation(async () => {
        lockAcquired = false;
      });

      // Start two updates
      const p1 = taskManager.updateTask(sessionId, mockTask);
      // Small delay to ensure p1 starts first
      await new Promise((resolve) => setTimeout(resolve, 50));
      const p2 = taskManager.updateTask(sessionId, mockTask);

      await Promise.all([p1, p2]);

      expect(fs.writeFile).toHaveBeenCalledTimes(2);
    });
    it("should emit tasksChange when a task is created", async () => {
      const spy = vi.fn();
      taskManager.on("tasksChange", spy);

      await taskManager.createTask(sessionId, mockTask);

      expect(spy).toHaveBeenCalledWith(sessionId);
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it("should emit tasksChange when a task is updated", async () => {
      const spy = vi.fn();
      taskManager.on("tasksChange", spy);

      await taskManager.updateTask(sessionId, mockTask);

      expect(spy).toHaveBeenCalledWith(sessionId);
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });
});
