import path from "path";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFile } from "fs/promises";
import { exitPlanModeTool } from "@/tools/exitPlanMode.js";
import { renderExitPlanModeResultData } from "@/tools/resultData/exitPlanMode.js";
import type { ExitPlanModeResultData } from "@/tools/resultData/exitPlanMode.js";
import { TaskManager } from "@/services/taskManager.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";
import { PermissionManager } from "@/managers/permissionManager.js";
import { Container } from "@/utils/container.js";

// 计划文件由 `fs/promises` 读；这组用例只关心 data 形状与文本口径。
vi.mock("fs/promises");

/**
 * Golden 断言（issue #3055 阶段 1）：驱动真实的 `execute()`，断言
 * `renderExitPlanModeResultData(result.data)` 与工具当场给出的 `content` 逐字
 * 相等。
 *
 * 期望值手写：从 `content` 抄一遍只能证明两边用了同一个渲染器。
 */

const PLAN_FILE = path.join(path.resolve("/fake/plans"), "calm-otter.md");

/** 手写 golden：CC 的批准文案（`ExitPlanModeV2Tool.ts:483-489`），不含正文回声。 */
const EXPECTED_CONTENT = `User has approved your plan. You can now start coding. Start with updating your todo list if applicable

Your plan has been saved to: ${PLAN_FILE}
You can refer back to it if needed during implementation.`;

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
const expectRendersBack = (result: ToolResult) => {
  expect(
    renderExitPlanModeResultData(result.data as ExitPlanModeResultData),
  ).toBe(result.content);
};

describe("ExitPlanMode 的 data → 文本 golden", () => {
  let mockContext: ToolContext;
  let mockPermissionManager: PermissionManager;
  const container = new Container();

  beforeEach(() => {
    vi.resetAllMocks();
    mockPermissionManager = {
      getPlanFilePath: vi.fn(() => PLAN_FILE),
      createContext: vi.fn(() => ({ toolName: "ExitPlanMode" })),
      checkPermission: vi.fn(),
      setHasExitedPlanMode: vi.fn(),
      setNeedsPlanModeExitAttachment: vi.fn(),
    } as unknown as PermissionManager;

    mockContext = {
      workdir: "/test/workdir",
      taskManager: new TaskManager(container, "test-session"),
      permissionManager: mockPermissionManager,
      permissionMode: "plan",
      canUseToolCallback: vi.fn(),
    };
  });

  it("用户批准：data 只有计划文件路径，正文 = CC 的批准文案", async () => {
    vi.mocked(readFile).mockResolvedValue("# My plan\n\n- step one");
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "allow",
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toBe(EXPECTED_CONTENT);
    expect(result.data).toEqual({ filePath: PLAN_FILE });
    expectRendersBack(result);
  });

  it("计划正文不进 data（大字段不落盘）", async () => {
    vi.mocked(readFile).mockResolvedValue("# Plan that must not be echoed");
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "allow",
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.data).toEqual({ filePath: PLAN_FILE });
    expect(result.content).not.toContain("must not be echoed");
    expectRendersBack(result);
  });

  it("拒绝且没有理由：失败分支不带 data", async () => {
    vi.mocked(readFile).mockResolvedValue("plan");
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "deny",
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.",
    );
    expect(result.error).toBe("Plan rejected by user");
    expect(result.data).toBeUndefined();
  });

  it("拒绝并给出理由：失败分支回前缀 + 用户原话（已 trim），不带 data", async () => {
    vi.mocked(readFile).mockResolvedValue("plan");
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "deny",
      message: "  Needs more work  ",
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). To tell you how to proceed, the user said:\nNeeds more work",
    );
    expect(result.data).toBeUndefined();
  });

  it("不在计划模式：失败分支不带 data", async () => {
    const result = await exitPlanModeTool.execute(
      {},
      { ...mockContext, permissionMode: "default" },
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "Not in plan mode. ExitPlanMode can only be used when actively in plan mode.",
    );
    expect(result.data).toBeUndefined();
  });
});
