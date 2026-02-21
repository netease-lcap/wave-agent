import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import {
  taskCreateTool,
  taskUpdateTool,
} from "../../src/tools/taskManagementTools.js";
import { TaskManager } from "../../src/services/taskManager.js";
import { Task } from "../../src/types/tasks.js";
import type { ToolContext } from "../../src/tools/types.js";
import { ReversionService } from "../../src/services/reversionService.js";
import { ReversionManager } from "../../src/managers/reversionManager.js";

// Mock TaskManager
vi.mock("../../src/services/taskManager.js", () => {
  const TaskManager = vi.fn();
  TaskManager.prototype.createTask = vi.fn();
  TaskManager.prototype.getTask = vi.fn();
  TaskManager.prototype.updateTask = vi.fn();
  TaskManager.prototype.getTaskPath = vi.fn();
  return { TaskManager };
});

// Mock ReversionManager
vi.mock("../../src/managers/reversionManager.js", () => {
  const ReversionManager = vi.fn();
  ReversionManager.prototype.recordSnapshot = vi.fn();
  return { ReversionManager };
});

describe("Task Management Tools - Rewind Support", () => {
  const sessionId = "test-session-id";
  const messageId = "test-message-id";
  let context: ToolContext;
  let mockTaskManager: Mocked<TaskManager>;
  let mockReversionManager: Mocked<ReversionManager>;
  let mockReversionService: Mocked<ReversionService>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockTaskManager = new TaskManager(sessionId) as Mocked<TaskManager>;
    mockReversionService = new ReversionService(
      sessionId,
    ) as Mocked<ReversionService>;
    mockReversionManager = new ReversionManager(
      mockReversionService,
    ) as Mocked<ReversionManager>;

    context = {
      sessionId,
      messageId,
      taskManager: mockTaskManager,
      reversionManager: mockReversionManager,
      workdir: "/test/workdir",
    } as ToolContext;
  });

  describe("TaskCreate tool rewind support", () => {
    it("should record a 'create' snapshot when a task is created", async () => {
      const args = {
        subject: "Test Task",
        description: "Test Description",
      };
      const taskId = "1";
      const taskPath = "/path/to/task/1.json";

      mockTaskManager.createTask.mockResolvedValue(taskId);
      mockTaskManager.getTaskPath.mockReturnValue(taskPath);

      const result = await taskCreateTool.execute(args, context);

      expect(result.success).toBe(true);
      expect(mockTaskManager.createTask).toHaveBeenCalled();
      expect(mockReversionManager.recordSnapshot).toHaveBeenCalledWith(
        messageId,
        taskPath,
        "create",
      );
    });

    it("should not fail if reversionManager is missing", async () => {
      const args = {
        subject: "Test Task",
        description: "Test Description",
      };
      mockTaskManager.createTask.mockResolvedValue("1");

      const contextWithoutReversion = {
        ...context,
        reversionManager: undefined,
      };
      const result = await taskCreateTool.execute(
        args,
        contextWithoutReversion,
      );

      expect(result.success).toBe(true);
      expect(mockTaskManager.createTask).toHaveBeenCalled();
    });
  });

  describe("TaskUpdate tool rewind support", () => {
    it("should record a 'modify' snapshot before a task is updated", async () => {
      const taskId = "1";
      const taskPath = "/path/to/task/1.json";
      const existingTask: Task = {
        id: taskId,
        subject: "Old Subject",
        description: "Old Description",
        status: "pending",
        blocks: [],
        blockedBy: [],
        metadata: {},
      };

      mockTaskManager.getTask.mockResolvedValue(existingTask);
      mockTaskManager.getTaskPath.mockReturnValue(taskPath);

      const args = {
        taskId,
        subject: "New Subject",
      };

      const result = await taskUpdateTool.execute(args, context);

      expect(result.success).toBe(true);
      expect(mockReversionManager.recordSnapshot).toHaveBeenCalledWith(
        messageId,
        taskPath,
        "modify",
      );
      // Ensure snapshot is recorded BEFORE update
      const recordCallOrder =
        mockReversionManager.recordSnapshot.mock.invocationCallOrder[0];
      const updateCallOrder =
        mockTaskManager.updateTask.mock.invocationCallOrder[0];
      expect(recordCallOrder).toBeLessThan(updateCallOrder);
    });
  });
});
