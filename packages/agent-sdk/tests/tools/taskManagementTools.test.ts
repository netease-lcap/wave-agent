import { describe, it, expect, vi, beforeEach } from "vitest";
import { taskOutputTool } from "../../src/tools/taskOutputTool.js";
import { taskStopTool } from "../../src/tools/taskStopTool.js";
import { BackgroundTaskManager } from "../../src/managers/backgroundTaskManager.js";
import type { ToolContext } from "../../src/tools/types.js";

describe("Task Management Tools", () => {
  let backgroundTaskManager: BackgroundTaskManager;
  let context: ToolContext;

  beforeEach(() => {
    vi.clearAllMocks();
    backgroundTaskManager = new BackgroundTaskManager({
      workdir: "/test/workdir",
    });
    context = {
      backgroundTaskManager,
      workdir: "/test/workdir",
    };
  });

  describe("TaskOutput tool", () => {
    it("should retrieve output from background task", async () => {
      // Manually add a task to the manager for testing
      // Since startShell is the easiest way to get a task in
      const taskId = backgroundTaskManager.startShell("echo hello");

      // Mock some output
      const task = backgroundTaskManager.getTask(taskId);
      if (task && task.type === "shell") {
        task.stdout += "hello world";
      }

      const result = await taskOutputTool.execute(
        {
          task_id: taskId,
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("hello world");
    });

    it("should handle non-existent task ID", async () => {
      const result = await taskOutputTool.execute(
        {
          task_id: "task_999",
        },
        context,
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Task with ID task_999 not found");
    });
  });

  describe("TaskStop tool", () => {
    it("should stop a running task", async () => {
      // Start a long running shell
      const taskId = backgroundTaskManager.startShell("sleep 100");

      const result = await taskStopTool.execute(
        {
          task_id: taskId,
        },
        context,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe(`Task ${taskId} has been stopped`);

      const task = backgroundTaskManager.getTask(taskId);
      expect(task?.status).toBe("killed");
    });
  });
});
