import { describe, it, expect, vi, beforeEach } from "vitest";
import { enterPlanModeTool } from "@/tools/enterPlanMode.js";
import { TaskManager } from "@/services/taskManager.js";
import type { ToolContext } from "@/tools/types.js";
import { PermissionManager } from "@/managers/permissionManager.js";

describe("enterPlanModeTool", () => {
  let mockContext: ToolContext;
  let mockPermissionManager: {
    updateConfiguredDefaultMode: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPermissionManager = {
      updateConfiguredDefaultMode: vi.fn(),
    };

    mockContext = {
      workdir: "/test/workdir",
      taskManager: new TaskManager("test-session"),
      permissionManager: mockPermissionManager as unknown as PermissionManager,
      permissionMode: "default",
      canUseToolCallback: vi.fn(),
    };
  });

  it("should have correct tool configuration", () => {
    expect(enterPlanModeTool.name).toBe("EnterPlanMode");
    expect(enterPlanModeTool.config.function.name).toBe("EnterPlanMode");
    expect(enterPlanModeTool.config.function.description).toContain(
      "Requests permission to enter plan mode",
    );
    expect(enterPlanModeTool.config.type).toBe("function");
  });

  it("should fail if permission manager is not available", async () => {
    const result = await enterPlanModeTool.execute(
      {},
      { workdir: "/test", taskManager: new TaskManager("test-session") },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("Permission manager is not available");
  });

  it("should succeed and update permission mode", async () => {
    const result = await enterPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toBe(
      "Entered plan mode. Please write your plan to the file.",
    );
    expect(
      mockPermissionManager.updateConfiguredDefaultMode,
    ).toHaveBeenCalledWith("plan");
  });
});
