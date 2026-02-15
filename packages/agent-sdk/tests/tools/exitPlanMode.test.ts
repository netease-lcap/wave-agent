import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { exitPlanModeTool } from "@/tools/exitPlanMode.js";
import { TaskManager } from "@/services/taskManager.js";
import { readFile } from "fs/promises";
import type { ToolContext } from "@/tools/types.js";
import { PermissionManager } from "@/managers/permissionManager.js";

// Mock fs/promises
vi.mock("fs/promises");

describe("exitPlanModeTool", () => {
  let mockContext: ToolContext;
  let mockPermissionManager: {
    getPlanFilePath: ReturnType<typeof vi.fn>;
    createContext: ReturnType<typeof vi.fn>;
    checkPermission: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockPermissionManager = {
      getPlanFilePath: vi.fn(),
      createContext: vi.fn(),
      checkPermission: vi.fn(),
    };

    mockContext = {
      workdir: "/test/workdir",
      taskManager: new TaskManager("test-session"),
      permissionManager: mockPermissionManager as unknown as PermissionManager,
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
    expect(exitPlanModeTool.prompt?.(mockContext)).toContain(
      "Use this tool when you are in plan mode",
    );
  });

  it("should fail if permission manager is not available", async () => {
    const result = await exitPlanModeTool.execute(
      {},
      { workdir: "/test", taskManager: new TaskManager("test-session") },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("Permission manager is not available");
  });

  it("should fail if plan file path is not set", async () => {
    mockPermissionManager.getPlanFilePath.mockReturnValue(undefined);
    const result = await exitPlanModeTool.execute({}, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Plan file path is not set");
  });

  it("should fail if plan file cannot be read", async () => {
    mockPermissionManager.getPlanFilePath.mockReturnValue("/test/plan.md");
    vi.mocked(readFile).mockRejectedValue(new Error("File not found"));

    const result = await exitPlanModeTool.execute({}, mockContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to read plan file: File not found");
  });

  it("should succeed if plan is approved", async () => {
    const planContent = "My awesome plan";
    mockPermissionManager.getPlanFilePath.mockReturnValue("/test/plan.md");
    vi.mocked(readFile).mockResolvedValue(planContent);
    mockPermissionManager.createContext.mockReturnValue({
      toolName: "ExitPlanMode",
    });
    mockPermissionManager.checkPermission.mockResolvedValue({
      behavior: "allow",
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toBe("Plan approved. Exiting plan mode.");
    expect(mockPermissionManager.createContext).toHaveBeenCalledWith(
      "ExitPlanMode",
      "plan",
      mockContext.canUseToolCallback,
      { plan_content: planContent },
    );
  });

  it("should return feedback if plan is rejected", async () => {
    const planContent = "My awesome plan";
    const feedback = "Please add more details";
    mockPermissionManager.getPlanFilePath.mockReturnValue("/test/plan.md");
    vi.mocked(readFile).mockResolvedValue(planContent);
    mockPermissionManager.createContext.mockReturnValue({
      toolName: "ExitPlanMode",
    });
    mockPermissionManager.checkPermission.mockResolvedValue({
      behavior: "deny",
      message: feedback,
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.content).toBe(feedback);
    expect(result.error).toBeUndefined();
  });

  it("should return default error if plan is rejected without message", async () => {
    mockPermissionManager.getPlanFilePath.mockReturnValue("/test/plan.md");
    vi.mocked(readFile).mockResolvedValue("plan");
    mockPermissionManager.createContext.mockReturnValue({
      toolName: "ExitPlanMode",
    });
    mockPermissionManager.checkPermission.mockResolvedValue({
      behavior: "deny",
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.content).toBe("Plan rejected by user");
    expect(result.error).toBe("Plan rejected by user");
  });

  it("should handle unexpected errors in execute", async () => {
    mockPermissionManager.getPlanFilePath.mockImplementation(() => {
      throw new Error("Unexpected error");
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toBe("Unexpected error");
  });
});
