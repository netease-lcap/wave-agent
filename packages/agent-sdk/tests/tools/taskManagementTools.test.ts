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
const mockTaskManager = new TaskManager(
  "test-session-id",
) as Mocked<TaskManager>;

describe("Task Management Tools", () => {
  const sessionId = "test-session-id";
  let context: ToolContext;

  it("should have correct tool configurations and prompts", () => {
    expect(taskCreateTool.prompt?.(context)).toContain(
      "Use this tool to create a structured task list",
    );

    expect(taskGetTool.prompt?.(context)).toContain(
      "Use this tool to retrieve a task by its ID",
    );

    expect(taskUpdateTool.prompt?.(context)).toContain(
      "Use this tool to update a task in the task list",
    );

    expect(taskListTool.prompt?.(context)).toContain(
      "Use this tool to list all tasks in the task list",
    );
  });

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
      mockTaskManager.createTask.mockResolvedValue("1");

      const result = await taskCreateTool.execute(args, context);

      expect(mockTaskManager.createTask).toHaveBeenCalledWith({
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
      mockTaskManager.createTask.mockResolvedValue("2");

      const result = await taskCreateTool.execute(args, context);

      expect(mockTaskManager.createTask).toHaveBeenCalledWith({
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

    it("should work without sessionId in context", async () => {
      const args = {
        subject: "Test Task",
        description: "Test Description",
      };
      mockTaskManager.createTask.mockResolvedValue("1");
      const result = await taskCreateTool.execute(args, {
        taskManager: mockTaskManager,
        workdir: "/test/workdir",
      } as ToolContext);
      expect(result.success).toBe(true);
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

      const result = await taskGetTool.execute({ taskId: "1" }, context);

      expect(mockTaskManager.getTask).toHaveBeenCalledWith("1");
      expect(result.success).toBe(true);
      expect(JSON.parse(result.content as string)).toEqual(task);
    });

    it("should return error if task is not found", async () => {
      mockTaskManager.getTask.mockResolvedValue(null);

      const result = await taskGetTool.execute(
        { taskId: "non-existent" },
        context,
      );

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
        taskId: "1",
        subject: "New Subject",
        status: "completed",
      };

      const result = await taskUpdateTool.execute(args, context);

      expect(mockTaskManager.getTask).toHaveBeenCalledWith("1");
      expect(mockTaskManager.updateTask).toHaveBeenCalledWith({
        ...existingTask,
        subject: "New Subject",
        status: "completed",
      });
      expect(result.success).toBe(true);
      expect(result.content).toContain("Updated task #1 subject, status");
      expect(result.content).toContain("Task completed");
    });

    it("should update activeForm and owner", async () => {
      const existingTask: Task = {
        id: "1",
        subject: "Subject",
        description: "Description",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: {},
      };
      mockTaskManager.getTask.mockResolvedValue(existingTask);

      const args = {
        taskId: "1",
        activeForm: "New Active Form",
        owner: "New Owner",
      };

      const result = await taskUpdateTool.execute(args, context);

      expect(mockTaskManager.updateTask).toHaveBeenCalledWith({
        ...existingTask,
        activeForm: "New Active Form",
        owner: "New Owner",
      });
      expect(result.success).toBe(true);
      expect(result.content).toContain("Updated task #1 activeForm, owner");
    });

    it("should return error if task to update is not found", async () => {
      mockTaskManager.getTask.mockResolvedValue(null);

      const result = await taskUpdateTool.execute({ taskId: "2" }, context);

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

      expect(mockTaskManager.listTasks).toHaveBeenCalled();
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

  describe("TaskUpdate tool - reciprocal dependencies", () => {
    it("should update blockedBy of target task when adding to blocks", async () => {
      const task1: Task = {
        id: "1",
        subject: "Task 1",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: {},
      };
      const task2: Task = {
        id: "2",
        subject: "Task 2",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: {},
      };

      mockTaskManager.getTask.mockImplementation(async (id) => {
        if (id === "1") return task1;
        if (id === "2") return task2;
        return null;
      });

      await taskUpdateTool.execute({ taskId: "1", addBlocks: ["2"] }, context);

      expect(mockTaskManager.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "1",
          blocks: ["2"],
        }),
      );
      expect(mockTaskManager.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "2",
          blockedBy: ["1"],
        }),
      );
    });

    it("should update blocks of target task when adding to blockedBy", async () => {
      const task1: Task = {
        id: "1",
        subject: "Task 1",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: {},
      };
      const task2: Task = {
        id: "2",
        subject: "Task 2",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: {},
      };

      mockTaskManager.getTask.mockImplementation(async (id) => {
        if (id === "1") return task1;
        if (id === "2") return task2;
        return null;
      });

      await taskUpdateTool.execute(
        { taskId: "1", addBlockedBy: ["2"] },
        context,
      );

      expect(mockTaskManager.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "1",
          blockedBy: ["2"],
        }),
      );
      expect(mockTaskManager.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "2",
          blocks: ["1"],
        }),
      );
    });
  });

  describe("TaskUpdate tool - metadata merging", () => {
    it("should merge metadata and delete keys with null values", async () => {
      const existingTask: Task = {
        id: "1",
        subject: "Task 1",
        description: "",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: { key1: "val1", key2: "val2" },
      };
      mockTaskManager.getTask.mockResolvedValue(existingTask);

      await taskUpdateTool.execute(
        {
          taskId: "1",
          metadata: { key1: "newVal", key2: null, key3: "val3" },
        },
        context,
      );

      expect(mockTaskManager.updateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          metadata: { key1: "newVal", key3: "val3" },
        }),
      );
    });
  });
});
