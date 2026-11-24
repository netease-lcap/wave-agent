import { describe, it, expect, vi } from "vitest";
import * as fsPromises from "fs/promises";
import * as path from "node:path";
import { workflowTool } from "../../../src/tools/workflowTool.js";
import {
  renderWorkflowResultData,
  type WorkflowResultData,
} from "../../../src/tools/resultData/workflow.js";
import type { ToolContext } from "../../../src/tools/types.js";

vi.mock("fs/promises", () => ({ readFile: vi.fn() }));

// `createRun`/`startRun` 抛错那条分支会 `logger.error`，不挡住就会在测试输出里留
// 一行错误日志（绿色套件必须安静）。
vi.mock("../../../src/utils/globalLogger.js", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
  setGlobalLogger: vi.fn(),
  clearGlobalLogger: vi.fn(),
  isLoggerConfigured: vi.fn(),
}));

/**
 * `Workflow` 的 `data → 文本` golden 断言（issue #3055 阶段 1）。
 *
 * 每个用例都断言两件事：`content` 等于手写的期望字面量，且
 * `renderWorkflowResultData(data)` 逐字还回同一个 `content`。两边都算了，才能证明
 * 「措辞没漂」而不是「渲染器和自己一致」。
 *
 * 覆盖的分支（与 workflowTool.ts 里产出 content 的地方一一对应）：后台启动回执
 * （无阶段/无 token 目标、有阶段/有 token 目标、scriptPath 源）、执行抛错
 * （`createRun` / `startRun`），以及正文为空因而**不带 `data`** 的那几档
 * （manager 缺失、脚本来源数量不对、来源缺失、脚本文件读不到、名字解析不到、
 * 命名脚本读不到）。
 */

const RUN_ID = "wf_abc12345";
const SCRIPT_PATH = path.join(
  path.resolve("/fake/project"),
  "workflows",
  RUN_ID,
  "script.js",
);
const VALID_SCRIPT = `export const meta = { name: "find-flaky-tests", description: "Find flaky tests and propose fixes" };\nreturn 1;`;

function context(workflowManager?: Record<string, unknown>): ToolContext {
  return { workflowManager } as unknown as ToolContext;
}

function manager(overrides: Record<string, unknown> = {}) {
  return {
    createRun: vi.fn().mockResolvedValue({
      runId: RUN_ID,
      meta: {
        name: "find-flaky-tests",
        description: "Find flaky tests and propose fixes",
        phases: [],
      },
      scriptPath: SCRIPT_PATH,
      status: "running",
    }),
    startRun: vi.fn().mockResolvedValue(undefined),
    getTurnTokenTarget: vi.fn().mockReturnValue(null),
    resolveNamedWorkflow: vi.fn().mockReturnValue({
      name: "code-review",
      description: "A saved workflow",
      source: "project",
      path: SCRIPT_PATH,
      meta: { name: "find-flaky-tests", description: "Find flaky tests" },
    }),
    listNamedWorkflows: vi.fn().mockReturnValue([]),
    ...overrides,
  };
}

/** `data` 必须能逐字还原工具的 `content`——阶段 2 丢掉 `content` 的前提。 */
function expectRendersBack(result: { content: string; data?: unknown }): void {
  expect(renderWorkflowResultData(result.data as WorkflowResultData)).toBe(
    result.content,
  );
}

describe("Workflow 的 data → 文本 golden", () => {
  it("后台启动回执：没有阶段、没有 token 目标时那一行说「没设」", async () => {
    const result = await workflowTool.execute(
      { script: VALID_SCRIPT },
      context(manager()),
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe(
      [
        `Workflow started with run ID: ${RUN_ID}`,
        "Name: find-flaky-tests",
        "Description: Find flaky tests and propose fixes",
        'Limits: 1000 agents maximum for this run, and no token target set for this turn (the user can set one, e.g. "+500k").',
        "The workflow is running in the background. You will be notified automatically when it completes.",
        `To stop it, use TaskStop with task_id "${RUN_ID}".`,
        "Use /workflows to watch live progress.",
        `Script saved to: ${SCRIPT_PATH}`,
      ].join("\n"),
    );
    expect(result.data).toEqual({
      status: "async_launched",
      taskId: RUN_ID,
      taskType: "local_workflow",
      workflowName: "find-flaky-tests",
      runId: RUN_ID,
      summary: "Find flaky tests and propose fixes",
      scriptPath: SCRIPT_PATH,
      agentCallCap: 1000,
    });
    // 用户没设 token 目标就没有这个键（不是 `null`、不是 `0`）。
    expect(result.data).not.toHaveProperty("turnTokenTarget");
    // 没有阶段就没有 `Phases:` 那行，也就没有这个键。
    expect(result.data).not.toHaveProperty("phaseTitles");
    // 阶段 1：顶层字段照旧并存。
    expect(result.backgroundTaskId).toBe(RUN_ID);
    expectRendersBack(result);
  });

  it("有阶段、有 token 目标：阶段只列标题，上限里给出目标数", async () => {
    const result = await workflowTool.execute(
      { script: VALID_SCRIPT },
      context(
        manager({
          createRun: vi.fn().mockResolvedValue({
            runId: RUN_ID,
            meta: {
              name: "find-flaky-tests",
              description: "Find flaky tests and propose fixes",
              phases: [
                { title: "Scan", detail: "list every test file" },
                { title: "Fix" },
              ],
            },
            scriptPath: SCRIPT_PATH,
            status: "running",
          }),
          getTurnTokenTarget: vi.fn().mockReturnValue(500_000),
        }),
      ),
    );

    expect(result.content).toBe(
      [
        `Workflow started with run ID: ${RUN_ID}`,
        "Name: find-flaky-tests",
        "Description: Find flaky tests and propose fixes",
        "Phases: Scan → Fix",
        "Limits: 1000 agents maximum for this run, and 500000 output tokens for this turn.",
        "The workflow is running in the background. You will be notified automatically when it completes.",
        `To stop it, use TaskStop with task_id "${RUN_ID}".`,
        "Use /workflows to watch live progress.",
        `Script saved to: ${SCRIPT_PATH}`,
      ].join("\n"),
    );
    expect(result.data).toEqual({
      status: "async_launched",
      taskId: RUN_ID,
      taskType: "local_workflow",
      workflowName: "find-flaky-tests",
      runId: RUN_ID,
      summary: "Find flaky tests and propose fixes",
      scriptPath: SCRIPT_PATH,
      phaseTitles: ["Scan", "Fix"],
      agentCallCap: 1000,
      turnTokenTarget: 500_000,
    });
    // phase 的 detail 不进 data：正文只列标题。
    expect(result.data).not.toHaveProperty("phases");
    expectRendersBack(result);
  });

  it("scriptPath 源：读到的脚本文本进 createRun，回执口径与内联源一致", async () => {
    vi.mocked(fsPromises.readFile).mockResolvedValue(VALID_SCRIPT);

    const result = await workflowTool.execute(
      { scriptPath: SCRIPT_PATH },
      context(manager()),
    );

    expect(vi.mocked(fsPromises.readFile)).toHaveBeenCalledWith(
      SCRIPT_PATH,
      "utf-8",
    );
    expect(result.content).toBe(
      [
        `Workflow started with run ID: ${RUN_ID}`,
        "Name: find-flaky-tests",
        "Description: Find flaky tests and propose fixes",
        'Limits: 1000 agents maximum for this run, and no token target set for this turn (the user can set one, e.g. "+500k").',
        "The workflow is running in the background. You will be notified automatically when it completes.",
        `To stop it, use TaskStop with task_id "${RUN_ID}".`,
        "Use /workflows to watch live progress.",
        `Script saved to: ${SCRIPT_PATH}`,
      ].join("\n"),
    );
    expectRendersBack(result);
  });

  it("createRun 抛错：正文是失败回执，原始错误原样留在 data.error", async () => {
    const createRun = vi
      .fn()
      .mockRejectedValue(
        new Error("Script validation failed:\nmeta.name is required"),
      );
    const startRun = vi.fn();

    const result = await workflowTool.execute(
      { script: VALID_SCRIPT },
      context(manager({ createRun, startRun })),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "Workflow failed: Script validation failed:\nmeta.name is required. Fix the error and try again.",
    );
    expect(result.data).toEqual({
      status: "failed",
      error: "Script validation failed:\nmeta.name is required",
    });
    expect(result.error).toBe(
      "Workflow execution failed: Script validation failed:\nmeta.name is required",
    );
    // 没起来就没有后台任务 id。
    expect(result.backgroundTaskId).toBeUndefined();
    expect(startRun).not.toHaveBeenCalled();
    expectRendersBack(result);
  });

  it("startRun 抛错：与 createRun 抛错共用同一份失败 data 与同一段正文", async () => {
    const result = await workflowTool.execute(
      { script: VALID_SCRIPT },
      context(
        manager({
          startRun: vi.fn().mockRejectedValue(new Error("script threw")),
        }),
      ),
    );

    expect(result.content).toBe(
      "Workflow failed: script threw. Fix the error and try again.",
    );
    expect(result.data).toEqual({ status: "failed", error: "script threw" });
    expectRendersBack(result);
  });

  it("manager 缺失：正文是空的，所以没有 data（模型侧走 error 兜底）", async () => {
    const result = await workflowTool.execute(
      { script: VALID_SCRIPT },
      context(),
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe("");
    expect(result.error).toBe("Workflow manager not available in tool context");
    expect(result.data).toBeUndefined();
  });

  it("两个脚本来源：拒掉，正文空、不带 data", async () => {
    const result = await workflowTool.execute(
      { script: VALID_SCRIPT, name: "code-review" },
      context(manager()),
    );

    expect(result.content).toBe("");
    expect(result.error).toBe(
      "Pass exactly one of 'script', 'scriptPath' or 'name' — not more than one.",
    );
    expect(result.data).toBeUndefined();
  });

  it("一个来源都没有：拒掉，正文空、不带 data", async () => {
    const result = await workflowTool.execute({}, context(manager()));

    expect(result.content).toBe("");
    expect(result.error).toBe(
      "Exactly one of 'script', 'scriptPath' or 'name' parameter is required",
    );
    expect(result.data).toBeUndefined();
  });

  it("脚本文件读不到：正文空、不带 data，错误里带原始 message", async () => {
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error("EACCES"));

    const result = await workflowTool.execute(
      { scriptPath: SCRIPT_PATH },
      context(manager()),
    );

    expect(result.content).toBe("");
    expect(result.error).toBe("Failed to read script file: EACCES");
    expect(result.data).toBeUndefined();
  });

  it("名字解析不到：正文空、不带 data，错误里列出可用的名字", async () => {
    const result = await workflowTool.execute(
      { name: "scan-nope" },
      context(
        manager({
          resolveNamedWorkflow: vi.fn().mockReturnValue(undefined),
          listNamedWorkflows: vi.fn().mockReturnValue([
            { name: "my-plugin:scan", description: "", source: "plugin" },
            { name: "code-review", description: "", source: "project" },
          ]),
        }),
      ),
    );

    expect(result.content).toBe("");
    expect(result.error).toBe(
      'Workflow "scan-nope" not found. Available: code-review, my-plugin:scan.',
    );
    expect(result.data).toBeUndefined();
  });

  it("命名脚本读不到：正文空、不带 data，错误里带名字与路径", async () => {
    vi.mocked(fsPromises.readFile).mockRejectedValue(new Error("ENOENT"));

    const result = await workflowTool.execute(
      { name: "code-review" },
      context(manager()),
    );

    expect(result.content).toBe("");
    expect(result.error).toBe(
      `Failed to read workflow "code-review" at ${SCRIPT_PATH}: ENOENT`,
    );
    expect(result.data).toBeUndefined();
  });
});
