import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { enterPlanModeTool } from "@/tools/enterPlanMode.js";
import { TaskManager } from "@/services/taskManager.js";
import type { ToolContext } from "@/tools/types.js";
import { PermissionManager } from "@/managers/permissionManager.js";
import { Container } from "@/utils/container.js";
import { OPERATION_CANCELLED_BY_USER } from "@/types/permissions.js";

describe("enterPlanModeTool", () => {
  let mockContext: ToolContext;
  let mockPermissionManager: PermissionManager;
  const container = new Container();

  beforeEach(() => {
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

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should have correct tool configuration", () => {
    expect(enterPlanModeTool.name).toBe("EnterPlanMode");
    expect(enterPlanModeTool.config.function.name).toBe("EnterPlanMode");
    expect(enterPlanModeTool.config.function.description).toContain(
      "Request to enter plan mode",
    );
    expect(enterPlanModeTool.config.type).toBe("function");
    expect(enterPlanModeTool.prompt?.()).toContain(
      "Use this tool to proactively request entering plan mode",
    );
  });

  it("should fail if already in plan mode", async () => {
    const planContext = {
      ...mockContext,
      permissionMode: "plan" as const,
    };
    const result = await enterPlanModeTool.execute({}, planContext);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Already in plan mode");
  });

  it("should fail if permission manager is not available", async () => {
    const result = await enterPlanModeTool.execute(
      {},
      {
        workdir: "/test",
        taskManager: new TaskManager(container, "test-session"),
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("Permission manager is not available");
  });

  it("should succeed when permission is granted", async () => {
    vi.mocked(mockPermissionManager.createContext).mockReturnValue({
      toolName: "EnterPlanMode",
      permissionMode: "default",
    });
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "allow",
    });

    const result = await enterPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Plan mode entered successfully");
    expect(mockPermissionManager.createContext).toHaveBeenCalledWith(
      "EnterPlanMode",
      "default",
      mockContext.canUseToolCallback,
      {},
      undefined,
    );
  });

  it("should return feedback if user declines", async () => {
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
    expect(result.content).toContain("User declined to enter plan mode");
  });

  it("should return cancellation message without prefix if cancelled by user", async () => {
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
    expect(result.error).toBeUndefined();
  });

  it("should handle unexpected errors in execute", async () => {
    vi.mocked(mockPermissionManager.createContext).mockImplementation(() => {
      throw new Error("Unexpected error");
    });

    const result = await enterPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unexpected error");
  });
});
