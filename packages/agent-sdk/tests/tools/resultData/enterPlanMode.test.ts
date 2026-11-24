import { describe, it, expect, vi, beforeEach } from "vitest";
import { enterPlanModeTool } from "@/tools/enterPlanMode.js";
import { renderEnterPlanModeResultData } from "@/tools/resultData/enterPlanMode.js";
import type { EnterPlanModeResultData } from "@/tools/resultData/enterPlanMode.js";
import { TaskManager } from "@/services/taskManager.js";
import type { ToolContext, ToolResult } from "@/tools/types.js";
import { PermissionManager } from "@/managers/permissionManager.js";
import { Container } from "@/utils/container.js";
import { OPERATION_CANCELLED_BY_USER } from "@/types/permissions.js";

/**
 * Golden 断言（issue #3055 阶段 1）：驱动真实的 `execute()`，断言
 * `renderEnterPlanModeResultData(result.data)` 与工具当场给出的 `content` 逐字
 * 相等，且 `data` 形状就是 CC outputSchema 的那个（只有一个 `message`）。
 *
 * 期望值一律手写：从 `content` 抄一遍只能证明两边用了同一个渲染器。
 */

/** 手写 golden：CC 的 `message` + 6 步指令（`EnterPlanModeTool.ts:96-125`）。 */
const EXPECTED_CONTENT = `Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.

In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Use AskUserQuestion if you need to clarify the approach
5. Design a concrete implementation strategy
6. When ready, use ExitPlanMode to present your plan for approval

Remember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase.`;

/** 渲染 `data` 并断言它逐字等于工具给的 `content`。 */
const expectRendersBack = (result: ToolResult) => {
  expect(
    renderEnterPlanModeResultData(result.data as EnterPlanModeResultData),
  ).toBe(result.content);
};

describe("EnterPlanMode 的 data → 文本 golden", () => {
  let mockContext: ToolContext;
  let mockPermissionManager: PermissionManager;
  const container = new Container();

  beforeEach(() => {
    vi.resetAllMocks();
    mockPermissionManager = {
      createContext: vi.fn(),
      checkPermission: vi.fn(),
    } as unknown as PermissionManager;

    mockContext = {
      workdir: "/test/workdir",
      taskManager: new TaskManager(container, "test-session"),
      permissionManager: mockPermissionManager,
      permissionMode: "default",
      canUseToolCallback: vi.fn(),
    };
  });

  it("用户批准：data 只有 message，正文 = message + 固定指令", async () => {
    vi.mocked(mockPermissionManager.createContext).mockReturnValue({
      toolName: "EnterPlanMode",
      permissionMode: "default",
    });
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "allow",
    });

    const result = await enterPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toBe(EXPECTED_CONTENT);
    expect(result.data).toEqual({
      message:
        "Entered plan mode. You should now focus on exploring the codebase and designing an implementation approach.",
    });
    expectRendersBack(result);
  });

  it("指令块是渲染器拼的，不在 data 里（data 只有 message 一个字段）", async () => {
    const data: EnterPlanModeResultData = { message: "hello" };

    expect(renderEnterPlanModeResultData(data)).toBe(
      `hello

In plan mode, you should:
1. Thoroughly explore the codebase to understand existing patterns
2. Identify similar features and architectural approaches
3. Consider multiple approaches and their trade-offs
4. Use AskUserQuestion if you need to clarify the approach
5. Design a concrete implementation strategy
6. When ready, use ExitPlanMode to present your plan for approval

Remember: DO NOT write or edit any files yet. This is a read-only exploration and planning phase.`,
    );
  });

  it("已经在计划模式里：失败分支不带 data", async () => {
    const result = await enterPlanModeTool.execute(
      {},
      { ...mockContext, permissionMode: "plan" },
    );

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "Already in plan mode. Use ExitPlanMode to exit.",
    );
    expect(result.error).toBe("Already in plan mode");
    expect(result.data).toBeUndefined();
  });

  it("用户拒绝：失败分支不带 data", async () => {
    vi.mocked(mockPermissionManager.createContext).mockReturnValue({
      toolName: "EnterPlanMode",
      permissionMode: "default",
    });
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "deny",
      message: "Not needed",
    });

    const result = await enterPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "User declined to enter plan mode. Proceed in current mode.",
    );
    expect(result.data).toBeUndefined();
  });

  it("用户取消：失败分支原样回取消文案，不带 data", async () => {
    vi.mocked(mockPermissionManager.createContext).mockReturnValue({
      toolName: "EnterPlanMode",
      permissionMode: "default",
    });
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "deny",
      message: OPERATION_CANCELLED_BY_USER,
    });

    const result = await enterPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.content).toBe(OPERATION_CANCELLED_BY_USER);
    expect(result.data).toBeUndefined();
  });
});
