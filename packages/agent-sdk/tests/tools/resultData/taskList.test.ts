import { describe, it, expect, vi, beforeEach, type Mocked } from "vitest";
import { taskListTool } from "@/tools/taskManagementTools.js";
import {
  renderTaskListResultData,
  type TaskListResultData,
} from "@/tools/resultData/taskList.js";
import { TaskManager } from "@/services/taskManager.js";
import { Task } from "@/types/tasks.js";
import { Container } from "@/utils/container.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";

/**
 * `TaskList` 的 golden 断言（issue #3055 阶段 1）：`data` 经它自己的渲染器还原
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
  expect(renderTaskListResultData(result.data as TaskListResultData)).toBe(
    result.content,
  );
}

const task = (over: Partial<Task>): Task =>
  ({
    description: "",
    blocks: [],
    blockedBy: [],
    metadata: {},
    ...over,
  }) as Task;

describe("TaskList 的 data → 文本", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("一个任务都没有：data 是空数组，文本是固定的一句", async () => {
    taskManager.listTasks.mockResolvedValue([]);

    const result = await taskListTool.execute({}, context);

    expect(result.content).toBe("No tasks found");
    expect(result.data).toEqual({ tasks: [] });
    expectRendersBack(result);
  });

  it("owner 与 blockedBy 是可选的尾巴，已完成的前置项不再算卡点", async () => {
    taskManager.listTasks.mockResolvedValue([
      task({
        id: "3",
        subject: "Task three",
        status: "in_progress",
        owner: "bob",
        blockedBy: ["2"],
      }),
      task({
        id: "2",
        subject: "Task two",
        status: "pending",
        blockedBy: ["1"],
      }),
      task({
        id: "1",
        subject: "Task one",
        status: "completed",
      }),
    ]);

    const result = await taskListTool.execute({}, context);

    expect(result.content).toBe(
      "#1 [completed] Task one\n" +
        "#2 [pending] Task two\n" +
        "#3 [in_progress] Task three (bob) [blocked by #2]",
    );
    expect(result.data).toEqual({
      tasks: [
        {
          id: "1",
          subject: "Task one",
          status: "completed",
          owner: undefined,
          blockedBy: [],
        },
        {
          id: "2",
          subject: "Task two",
          status: "pending",
          owner: undefined,
          blockedBy: [],
        },
        {
          id: "3",
          subject: "Task three",
          status: "in_progress",
          owner: "bob",
          blockedBy: ["2"],
        },
      ],
    });
    expectRendersBack(result);
  });

  it("只剩 _internal 任务时同样落到 No tasks found", async () => {
    taskManager.listTasks.mockResolvedValue([
      task({
        id: "1",
        subject: "Internal bookkeeping",
        status: "pending",
        metadata: { _internal: true },
      }),
    ]);

    const result = await taskListTool.execute({}, context);

    expect(result.content).toBe("No tasks found");
    expect(result.data).toEqual({ tasks: [] });
    expectRendersBack(result);
  });
});
