import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import { taskGetTool } from "@/tools/taskManagementTools.js";
import {
  renderTaskGetResultData,
  type TaskGetResultData,
} from "@/tools/resultData/taskGet.js";
import { TaskManager } from "@/services/taskManager.js";
import { Task } from "@/types/tasks.js";
import { Container } from "@/utils/container.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";

/**
 * `TaskGet` 的 golden 断言（issue #3055 阶段 1）：`data` 经它自己的渲染器还原
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
  expect(renderTaskGetResultData(result.data as TaskGetResultData)).toBe(
    result.content,
  );
}

describe("TaskGet 的 data → 文本", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("三行固定页眉 + 非空的 Blocked by / Blocks 两行", async () => {
    const task: Task = {
      id: "3",
      subject: "Ship phase 1",
      description: "Migrate tool results to a structured data payload",
      status: "in_progress",
      blocks: ["4"],
      blockedBy: ["1", "2"],
      metadata: {},
    };
    taskManager.getTask.mockResolvedValue(task);

    const result = await taskGetTool.execute({ taskId: "3" }, context);

    expect(result.content).toBe(
      "Task #3: Ship phase 1\n" +
        "Status: in_progress\n" +
        "Description: Migrate tool results to a structured data payload\n" +
        "Blocked by: #1, #2\n" +
        "Blocks: #4",
    );
    expect(result.data).toEqual({
      task: {
        id: "3",
        subject: "Ship phase 1",
        description: "Migrate tool results to a structured data payload",
        status: "in_progress",
        blocks: ["4"],
        blockedBy: ["1", "2"],
      },
    });
    expectRendersBack(result);
  });

  it("依赖为空时两行都不出现（不是空段）", async () => {
    const task: Task = {
      id: "7",
      subject: "Read the spec",
      description: "Read docs/specs/core/fs-tools.md",
      status: "pending",
      blocks: [],
      blockedBy: [],
      metadata: {},
    };
    taskManager.getTask.mockResolvedValue(task);

    const result = await taskGetTool.execute({ taskId: "7" }, context);

    expect(result.content).toBe(
      "Task #7: Read the spec\n" +
        "Status: pending\n" +
        "Description: Read docs/specs/core/fs-tools.md",
    );
    expect(result.data).toEqual({
      task: {
        id: "7",
        subject: "Read the spec",
        description: "Read docs/specs/core/fs-tools.md",
        status: "pending",
        blocks: [],
        blockedBy: [],
      },
    });
    expectRendersBack(result);
  });

  it("找不到任务：data 是 task: null，文本是一句固定的 Task not found", async () => {
    taskManager.getTask.mockResolvedValue(null);

    const result = await taskGetTool.execute({ taskId: "99" }, context);

    expect(result.success).toBe(false);
    expect(result.content).toBe("Task not found");
    expect(result.data).toEqual({ task: null });
    expectRendersBack(result);
  });
});
