import type { ChildProcess } from "child_process";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { taskStopTool } from "@/tools/taskStopTool.js";
import { renderTaskStopResultData } from "@/tools/resultData/taskStop.js";
import { BackgroundTaskManager } from "@/managers/backgroundTaskManager.js";
import { TaskManager } from "@/services/taskManager.js";
import { Container } from "@/utils/container.js";
import type { ToolContext } from "@/tools/types.js";
import type {
  BackgroundShell,
  BackgroundSubagent,
  BackgroundWorkflow,
} from "@/types/processes.js";

/**
 * Golden 断言（issue #3055 阶段 1）：`TaskStop` 的 `data` 经它自己的渲染器还原
 * 出来的文本，必须与工具当场产出的 `content` 逐字相等。
 *
 * CC 的模型侧文本就是 output 的紧凑 JSON（`TaskStopTool.ts:98-104` 的
 * `mapToolResultToToolResultBlockParam` → `jsonStringify`），所以这里的期望值
 * 是手写的 JSON 字面量，而不是从 `content` 抄一遍——抄一遍只能证明两边用了同
 * 一个渲染器，证明不了键序、字段名与措辞没漂。
 */

const WORKDIR = "/fake/project";

/** 任务只是一个登记项：本套用例断言的是 describe/stop 之间的数据形状，不起真进程。 */
const fakeProcess = {} as ChildProcess;

const shellTask = (
  overrides: Partial<BackgroundShell> = {},
): BackgroundShell => ({
  id: "task_1",
  type: "shell",
  status: "running",
  startTime: 1000,
  command: "npm run build",
  stdout: "",
  stderr: "",
  process: fakeProcess,
  ...overrides,
});

const subagentTask = (
  overrides: Partial<BackgroundSubagent> = {},
): BackgroundSubagent => ({
  id: "task_1",
  type: "subagent",
  status: "running",
  startTime: 1000,
  description: "explore the repo",
  stdout: "",
  stderr: "",
  ...overrides,
});

describe("TaskStop 的 data → 文本渲染器", () => {
  let manager: BackgroundTaskManager;
  let context: ToolContext;

  beforeEach(() => {
    const container = new Container();
    manager = new BackgroundTaskManager(container, { workdir: WORKDIR });
    context = {
      workdir: WORKDIR,
      taskManager: new TaskManager(container, "test-session"),
      backgroundTaskManager: manager,
    };
  });

  /** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
  const expectRendersBack = (result: {
    content: string;
    data?: unknown;
  }): void => {
    const data = result.data as Parameters<typeof renderTaskStopResultData>[0];
    expect(renderTaskStopResultData(data)).toBe(result.content);
  };

  it("停掉 shell 任务：报任务类型与命令行，文本是紧凑 JSON", async () => {
    const onStop = vi.fn();
    manager.addTask(shellTask({ onStop }));

    const result = await taskStopTool.execute({ task_id: "task_1" }, context);

    expect(result.success).toBe(true);
    expect(result.content).toBe(
      '{"message":"Successfully stopped task: task_1 (npm run build)","task_id":"task_1","task_type":"shell","command":"npm run build"}',
    );
    expect(result.data).toEqual({
      message: "Successfully stopped task: task_1 (npm run build)",
      task_id: "task_1",
      task_type: "shell",
      command: "npm run build",
    });
    expect(result.shortResult).toBe("Stopped task_1");
    expectRendersBack(result);
    // 走的还是真实的 stopTask：任务被标记为 killed，onStop 回调被执行。
    expect(manager.getTask("task_1")?.status).toBe("killed");
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("停掉 subagent 任务：command 位置放 description（照 CC 的二选一）", async () => {
    manager.addTask(subagentTask());

    const result = await taskStopTool.execute({ task_id: "task_1" }, context);

    expect(result.content).toBe(
      '{"message":"Successfully stopped task: task_1 (explore the repo)","task_id":"task_1","task_type":"subagent","command":"explore the repo"}',
    );
    expect(result.data).toEqual({
      message: "Successfully stopped task: task_1 (explore the repo)",
      task_id: "task_1",
      task_type: "subagent",
      command: "explore the repo",
    });
    expectRendersBack(result);
  });

  it("workflow 任务同样用 description", async () => {
    const workflow: BackgroundWorkflow = {
      id: "task_7",
      type: "workflow",
      status: "running",
      startTime: 1000,
      description: "Workflow: release check",
      runId: "run_1",
      stdout: "",
      stderr: "",
    };
    manager.addTask(workflow);

    const result = await taskStopTool.execute({ task_id: "task_7" }, context);

    expect(result.content).toBe(
      '{"message":"Successfully stopped task: task_7 (Workflow: release check)","task_id":"task_7","task_type":"workflow","command":"Workflow: release check"}',
    );
    expectRendersBack(result);
  });

  it("命令行里的引号按 JSON 转义出现两次（message 与 command 各一份）", async () => {
    manager.addTask(shellTask({ command: 'node -e "console.log(1)"' }));

    const result = await taskStopTool.execute({ task_id: "task_1" }, context);

    expect(result.content).toBe(
      '{"message":"Successfully stopped task: task_1 (node -e \\"console.log(1)\\")","task_id":"task_1","task_type":"shell","command":"node -e \\"console.log(1)\\""}',
    );
    expectRendersBack(result);
  });

  it("任务不存在：只给 error，没有 data", async () => {
    const result = await taskStopTool.execute({ task_id: "task_999" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Task with ID task_999 not found");
    expect(result.data).toBeUndefined();
    expect(result.content).toBe("");
  });

  it("任务已结束：只给 error，没有 data", async () => {
    manager.addTask(shellTask({ status: "completed" }));

    const result = await taskStopTool.execute({ task_id: "task_1" }, context);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Failed to stop task task_1 (status: completed)");
    expect(result.data).toBeUndefined();
    expect(result.content).toBe("");
  });

  it("缺 task_id 与缺 backgroundTaskManager 都不产出 data", async () => {
    const missingArg = await taskStopTool.execute({}, context);
    expect(missingArg.success).toBe(false);
    expect(missingArg.error).toBe(
      "task_id parameter is required and must be a string",
    );
    expect(missingArg.data).toBeUndefined();

    const noManager = await taskStopTool.execute(
      { task_id: "task_1" },
      { workdir: WORKDIR, taskManager: context.taskManager },
    );
    expect(noManager.success).toBe(false);
    expect(noManager.error).toBe("Background task manager not available");
    expect(noManager.data).toBeUndefined();
  });

  it("command 缺失时 JSON 里直接不出现这个键（CC 的 optional 字段）", () => {
    // 老会话重放 / 没有命令行的任务：CC 的 outputSchema 把 command 标成
    // optional，JSON.stringify 丢掉 undefined，文本里就没有这个键。
    expect(
      renderTaskStopResultData({
        message: "Successfully stopped task: task_9 (undefined)",
        task_id: "task_9",
        task_type: "shell",
        command: undefined,
      }),
    ).toBe(
      '{"message":"Successfully stopped task: task_9 (undefined)","task_id":"task_9","task_type":"shell"}',
    );
  });
});
