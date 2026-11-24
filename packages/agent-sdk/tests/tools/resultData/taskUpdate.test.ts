import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import { taskUpdateTool } from "@/tools/taskManagementTools.js";
import {
  renderTaskUpdateResultData,
  type TaskUpdateResultData,
} from "@/tools/resultData/taskUpdate.js";
import { TaskManager } from "@/services/taskManager.js";
import { Task } from "@/types/tasks.js";
import { Container } from "@/utils/container.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";

/**
 * `TaskUpdate` 的 golden 断言（issue #3055 阶段 1）：`data` 经它自己的渲染器还原
 * 出来的文本，必须与工具当场产出的 `content` **逐字相等**。期望值是手写字面量。
 */

vi.mock("@/services/taskManager.js", () => {
  const TaskManager = vi.fn();
  TaskManager.prototype.createTask = vi.fn();
  TaskManager.prototype.getTask = vi.fn();
  TaskManager.prototype.updateTask = vi.fn();
  TaskManager.prototype.listTasks = vi.fn();
  TaskManager.prototype.deleteTask = vi.fn();
  TaskManager.prototype.getTaskPath = vi.fn(() => "/mock/path");
  return { TaskManager };
});

const taskManager = new TaskManager(
  new Container(),
  "test-session",
) as Mocked<TaskManager>;

const context = {
  sessionId: "test-session",
  taskManager,
  workdir: "/test/workdir",
} as ToolContext;

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
function expectRendersBack(result: ToolResult): void {
  expect(renderTaskUpdateResultData(result.data as TaskUpdateResultData)).toBe(
    result.content,
  );
}

/** 一条 pending 的任务，各用例只覆盖自己关心的字段。 */
const pendingTask = (over: Partial<Task> = {}): Task => ({
  id: "1",
  subject: "Old subject",
  description: "Old description",
  status: "pending",
  blocks: [],
  blockedBy: [],
  metadata: {},
  ...over,
});

describe("TaskUpdate 的 data → 文本", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("改了哪些字段就按顺序列出来", async () => {
    taskManager.getTask.mockResolvedValue(pendingTask());

    const result = await taskUpdateTool.execute(
      {
        taskId: "1",
        subject: "New subject",
        description: "New description",
      },
      context,
    );

    expect(result.content).toBe("Updated task #1 subject, description");
    expect(result.data).toEqual({
      success: true,
      taskId: "1",
      updatedFields: ["subject", "description"],
      statusChange: undefined,
    });
    expectRendersBack(result);
  });

  it("状态没变成 completed 时只有一行，不带「去看下一个」的提醒", async () => {
    taskManager.getTask.mockResolvedValue(pendingTask());

    const result = await taskUpdateTool.execute(
      { taskId: "1", status: "in_progress" },
      context,
    );

    expect(result.content).toBe("Updated task #1 status");
    expect(result.data).toEqual({
      success: true,
      taskId: "1",
      updatedFields: ["status"],
      statusChange: { from: "pending", to: "in_progress" },
    });
    expectRendersBack(result);
  });

  it("完成一个任务时追加上「去 TaskList 找下一个」那段", async () => {
    taskManager.getTask.mockResolvedValue(pendingTask());

    const result = await taskUpdateTool.execute(
      { taskId: "1", status: "completed" },
      context,
    );

    expect(result.content).toBe(
      "Updated task #1 status\n" +
        "\n" +
        "Task completed. Call TaskList now to find your next available task or see if your work unblocked others.",
    );
    expect(result.data).toEqual({
      success: true,
      taskId: "1",
      updatedFields: ["status"],
      statusChange: { from: "pending", to: "completed" },
    });
    expectRendersBack(result);
  });

  it("删除是走「更新成 deleted」那条文本，不是另一句「删除了」", async () => {
    taskManager.getTask.mockResolvedValue(pendingTask());

    const result = await taskUpdateTool.execute(
      { taskId: "1", status: "deleted" },
      context,
    );

    expect(taskManager.deleteTask).toHaveBeenCalledWith("1");
    expect(result.content).toBe("Updated task #1 deleted");
    expect(result.data).toEqual({
      success: true,
      taskId: "1",
      updatedFields: ["deleted"],
      statusChange: { from: "pending", to: "deleted" },
    });
    expectRendersBack(result);
  });

  it("任务不存在：失败原因进 data，文本就是那句 error", async () => {
    taskManager.getTask.mockResolvedValue(null);

    const result = await taskUpdateTool.execute({ taskId: "2" }, context);

    expect(result.success).toBe(false);
    expect(result.content).toBe("Task not found");
    expect(result.data).toEqual({
      success: false,
      taskId: "2",
      updatedFields: [],
      error: "Task not found",
    });
    expectRendersBack(result);
  });
});
