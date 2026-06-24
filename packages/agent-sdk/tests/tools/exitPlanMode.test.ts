import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exitPlanModeTool } from "@/tools/exitPlanMode.js";
import { TaskManager } from "@/services/taskManager.js";
import { readFile } from "fs/promises";
import type { ToolContext } from "@/tools/types.js";
import { PermissionManager } from "@/managers/permissionManager.js";
import { Container } from "@/utils/container.js";
import { OPERATION_CANCELLED_BY_USER } from "@/types/permissions.js";

// Mock fs/promises
vi.mock("fs/promises");

describe("exitPlanModeTool", () => {
  let mockContext: ToolContext;
  let mockPermissionManager: PermissionManager;
  const container = new Container();

  beforeEach(() => {
    mockPermissionManager = {
      getPlanFilePath: vi.fn(),
      createContext: vi.fn(),
      checkPermission: vi.fn(),
      setHasExitedPlanMode: vi.fn(),
      setNeedsPlanModeExitAttachment: vi.fn(),
      hasExitedPlanModeInSession: vi.fn(() => false),
      getNeedsPlanModeExitAttachment: vi.fn(() => false),
    } as unknown as PermissionManager;

    mockContext = {
      workdir: "/test/workdir",
      taskManager: new TaskManager(container, "test-session"),
      permissionManager: mockPermissionManager,
      permissionMode: "plan",
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
    expect(exitPlanModeTool.name).toBe("ExitPlanMode");
    expect(exitPlanModeTool.config.function.name).toBe("ExitPlanMode");
    expect(exitPlanModeTool.config.function.description).toContain(
      "Prompts the user to exit plan mode and start coding",
    );
    expect(exitPlanModeTool.config.type).toBe("function");
    expect(exitPlanModeTool.prompt?.()).toContain(
      "Use this tool when you are in plan mode",
    );
  });

  it("should fail if permission manager is not available", async () => {
    const result = await exitPlanModeTool.execute(
      {},
      {
        workdir: "/test",
        permissionMode: "plan",
        taskManager: new TaskManager(container, "test-session"),
      },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("Permission manager is not available");
  });

  it("should fail if not in plan mode", async () => {
    const nonPlanContext = {
      ...mockContext,
      permissionMode: "default" as const,
    };
    const result = await exitPlanModeTool.execute({}, nonPlanContext);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Not in plan mode");
  });

  it("should fail if plan file path is not set", async () => {
    vi.mocked(mockPermissionManager.getPlanFilePath).mockReturnValue(undefined);
    const result = await exitPlanModeTool.execute({}, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Plan file path is not set");
  });

  it("should fail if plan file cannot be read", async () => {
    vi.mocked(mockPermissionManager.getPlanFilePath).mockReturnValue(
      "/test/plan.md",
    );
    vi.mocked(readFile).mockRejectedValue(new Error("File not found"));

    const result = await exitPlanModeTool.execute({}, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to read plan file: File not found");
  });

  it("should succeed if plan is approved", async () => {
    const planContent = "My awesome plan";
    vi.mocked(mockPermissionManager.getPlanFilePath).mockReturnValue(
      "/test/plan.md",
    );
    vi.mocked(readFile).mockResolvedValue(planContent);
    vi.mocked(mockPermissionManager.createContext).mockReturnValue({
      toolName: "ExitPlanMode",
      permissionMode: "plan",
    });
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "allow",
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toBe("Plan approved. Exiting plan mode.");
    expect(mockPermissionManager.createContext).toHaveBeenCalledWith(
      "ExitPlanMode",
      "plan",
      mockContext.canUseToolCallback,
      {},
      undefined,
      planContent,
    );
  });

  it("should return feedback if plan is rejected", async () => {
    const planContent = "My awesome plan";
    const feedback = "Please add more details";
    vi.mocked(mockPermissionManager.getPlanFilePath).mockReturnValue(
      "/test/plan.md",
    );
    vi.mocked(readFile).mockResolvedValue(planContent);
    vi.mocked(mockPermissionManager.createContext).mockReturnValue({
      toolName: "ExitPlanMode",
      permissionMode: "plan",
    });
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "deny",
      message: feedback,
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      `Please update your proposal based on the following user feedback: ${feedback}`,
    );
    expect(result.error).toBeUndefined();
  });

  it("should return default error if plan is rejected without message", async () => {
    vi.mocked(mockPermissionManager.getPlanFilePath).mockReturnValue(
      "/test/plan.md",
    );
    vi.mocked(readFile).mockResolvedValue("plan");
    vi.mocked(mockPermissionManager.createContext).mockReturnValue({
      toolName: "ExitPlanMode",
      permissionMode: "plan",
    });
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "deny",
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.content).toBe(
      "Please update your proposal based on the following user feedback: Plan rejected by user",
    );
    expect(result.error).toBe("Plan rejected by user");
  });

  it("should return cancellation message without prefix if cancelled by user", async () => {
    vi.mocked(mockPermissionManager.getPlanFilePath).mockReturnValue(
      "/test/plan.md",
    );
    vi.mocked(readFile).mockResolvedValue("plan");
    vi.mocked(mockPermissionManager.createContext).mockReturnValue({
      toolName: "ExitPlanMode",
      permissionMode: "plan",
    });
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "deny",
      message: OPERATION_CANCELLED_BY_USER,
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.content).toBe(OPERATION_CANCELLED_BY_USER);
    expect(result.error).toBeUndefined();
  });

  it("should handle unexpected errors in execute", async () => {
    vi.mocked(mockPermissionManager.getPlanFilePath).mockImplementation(() => {
      throw new Error("Unexpected error");
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unexpected error");
  });
});
