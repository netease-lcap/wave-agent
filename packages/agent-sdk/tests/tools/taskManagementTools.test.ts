import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import {
  taskCreateTool,
  taskGetTool,
  taskUpdateTool,
  taskListTool,
} from "../../src/tools/taskManagementTools.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { Task } from "../../src/types/tasks.js";
import type { ToolContext } from "../../src/tools/types.js";

// Mock TaskManager
vi.mock("../../src/services/taskManager.js", () => {
  const TaskManager = vi.fn();
  TaskManager.prototype.getNextTaskId = vi.fn();
  TaskManager.prototype.createTask = vi.fn();
  TaskManager.prototype.getTask = vi.fn();
  TaskManager.prototype.updateTask = vi.fn();
  TaskManager.prototype.listTasks = vi.fn();
  return { TaskManager };
});

// Get the mocked instance
const mockTaskManager = new TaskManager() as Mocked<TaskManager>;

describe("Task Management Tools", () => {
  const sessionId = "test-session-id";
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    context = {
      sessionId,
      taskManager: mockTaskManager,
      workdir: "/test/workdir",
    } as ToolContext;
  });

  describe("TaskCreate tool", () => {
    it("should create a task with provided arguments", async () => {
      const args = {
        subject: "Test Task",
        description: "Test Description",
        status: "in_progress",
      };
      mockTaskManager.getNextTaskId.mockResolvedValue("1");

      const result = await taskCreateTool.execute(args, context);

      expect(mockTaskManager.getNextTaskId).toHaveBeenCalledWith(sessionId);
      expect(mockTaskManager.createTask).toHaveBeenCalledWith(sessionId, {
        id: "1",
        subject: "Test Task",
        description: "Test Description",
        status: "in_progress",
        activeForm: undefined,
        owner: undefined,
        blocks: [],
        blockedBy: [],
        metadata: {},
      });
      expect(result.success).toBe(true);
      expect(result.content).toContain("Task created with ID: 1");
    });

    it("should use default values when optional arguments are missing", async () => {
      const args = {
        subject: "Minimal Task",
        description: "Minimal Description",
      };
      mockTaskManager.getNextTaskId.mockResolvedValue("2");

      const result = await taskCreateTool.execute(args, context);

      expect(mockTaskManager.createTask).toHaveBeenCalledWith(sessionId, {
        id: "2",
        subject: "Minimal Task",
        description: "Minimal Description",
        status: "pending",
        activeForm: undefined,
        owner: undefined,
        blocks: [],
        blockedBy: [],
        metadata: {},
      });
      expect(result.success).toBe(true);
    });

    it("should return error if sessionId is missing", async () => {
      const result = await taskCreateTool.execute({}, {
        taskManager: mockTaskManager,
        workdir: "/test/workdir",
      } as ToolContext);
      expect(result.success).toBe(false);
      expect(result.content).toBe("Session ID not found in context.");
    });
  });

  describe("TaskGet tool", () => {
    it("should retrieve a task by ID", async () => {
      const task: Task = {
        id: "1",
        subject: "Test Task",
        description: "Test Description",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: {},
      };
      mockTaskManager.getTask.mockResolvedValue(task);

      const result = await taskGetTool.execute({ id: "1" }, context);

      expect(mockTaskManager.getTask).toHaveBeenCalledWith(sessionId, "1");
      expect(result.success).toBe(true);
      expect(JSON.parse(result.content as string)).toEqual(task);
    });

    it("should return error if task is not found", async () => {
      mockTaskManager.getTask.mockResolvedValue(null);

      const result = await taskGetTool.execute({ id: "non-existent" }, context);

      expect(result.success).toBe(false);
      expect(result.content).toBe("Task with ID non-existent not found.");
    });
  });

  describe("TaskUpdate tool", () => {
    it("should update an existing task", async () => {
      const existingTask: Task = {
        id: "1",
        subject: "Old Subject",
        description: "Old Description",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: {},
      };
      mockTaskManager.getTask.mockResolvedValue(existingTask);

      const args = {
        id: "1",
        subject: "New Subject",
        status: "completed",
      };

      const result = await taskUpdateTool.execute(args, context);

      expect(mockTaskManager.getTask).toHaveBeenCalledWith(sessionId, "1");
      expect(mockTaskManager.updateTask).toHaveBeenCalledWith(sessionId, {
        ...existingTask,
        subject: "New Subject",
        status: "completed",
      });
      expect(result.success).toBe(true);
      expect(result.content).toBe("Task 1 updated successfully.");
    });

    it("should return error if task to update is not found", async () => {
      mockTaskManager.getTask.mockResolvedValue(null);

      const result = await taskUpdateTool.execute({ id: "2" }, context);

      expect(result.success).toBe(false);
      expect(result.content).toBe("Task with ID 2 not found.");
    });
  });

  describe("TaskList tool", () => {
    it("should list all tasks sorted by ID", async () => {
      const tasks: Task[] = [
        {
          id: "2",
          subject: "Task 2",
          description: "",
          status: "pending",
          blocks: [],
          blockedBy: [],
          metadata: {},
        },
        {
          id: "1",
          subject: "Task 1",
          description: "",
          status: "completed",
          blocks: [],
          blockedBy: [],
          metadata: {},
        },
      ];
      mockTaskManager.listTasks.mockResolvedValue(tasks);

      const result = await taskListTool.execute({}, context);

      expect(mockTaskManager.listTasks).toHaveBeenCalledWith(sessionId);
      expect(result.success).toBe(true);
      expect(result.content).toBe(
        "[1] Task 1 (completed)\n[2] Task 2 (pending)",
      );
    });

    it("should filter tasks by status", async () => {
      const tasks: Task[] = [
        {
          id: "1",
          subject: "Task 1",
          description: "",
          status: "completed",
          blocks: [],
          blockedBy: [],
          metadata: {},
        },
        {
          id: "2",
          subject: "Task 2",
          description: "",
          status: "pending",
          blocks: [],
          blockedBy: [],
          metadata: {},
        },
      ];
      mockTaskManager.listTasks.mockResolvedValue(tasks);

      const result = await taskListTool.execute({ status: "pending" }, context);

      expect(result.success).toBe(true);
      expect(result.content).toBe("[2] Task 2 (pending)");
    });

    it("should return 'No tasks found.' if list is empty", async () => {
      mockTaskManager.listTasks.mockResolvedValue([]);

      const result = await taskListTool.execute({}, context);

      expect(result.success).toBe(true);
      expect(result.content).toBe("No tasks found.");
    });
  });
});
