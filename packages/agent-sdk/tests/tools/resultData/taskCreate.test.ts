import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import { taskCreateTool } from "@/tools/taskManagementTools.js";
import {
  renderTaskCreateResultData,
  type TaskCreateResultData,
} from "@/tools/resultData/taskCreate.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";

/**
 * `TaskCreate` 的 golden 断言（issue #3055 阶段 1）：`data` 经它自己的渲染器还原
 * 出来的文本，必须与工具当场产出的 `content` **逐字相等**。
 *
 * 期望值是手写的字面量，不是从 `content` 抄来的：抄一遍只能证明两边用了同一个
 * 渲染器，证明不了措辞没漂。
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
  expect(renderTaskCreateResultData(result.data as TaskCreateResultData)).toBe(
    result.content,
  );
}

describe("TaskCreate 的 data → 文本", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("创建成功：data 只带 id 与 subject，文本是一句「创建了哪个任务」", async () => {
    taskManager.createTask.mockResolvedValue("1");

    const result = await taskCreateTool.execute(
      {
        subject: "Fix login bug",
        description: "Broken redirect on refresh",
        activeForm: "Fixing login bug",
      },
      context,
    );

    expect(result.content).toBe("Task #1 created successfully: Fix login bug");
    expect(result.data).toEqual({
      task: { id: "1", subject: "Fix login bug" },
    });
    expectRendersBack(result);
  });

  it("省略可选参数时文本形状不变（status 恒为 pending，不写进文本）", async () => {
    taskManager.createTask.mockResolvedValue("12");

    const result = await taskCreateTool.execute(
      { subject: "Write spec", description: "Draft the spec" },
      context,
    );

    expect(result.content).toBe("Task #12 created successfully: Write spec");
    expect(result.data).toEqual({ task: { id: "12", subject: "Write spec" } });
    expectRendersBack(result);
  });
});
