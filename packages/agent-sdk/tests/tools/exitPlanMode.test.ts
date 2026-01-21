import { describe, it, expect, vi, beforeEach } from "vitest";
import { exitPlanModeTool } from "../../src/tools/exitPlanMode.js";
import type { ToolContext } from "../../src/tools/types.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
import type { MessageManager } from "../../src/managers/messageManager.js";
import * as fs from "node:fs/promises";

vi.mock("node:fs/promises");

describe("ExitPlanMode Tool", () => {
  let mockContext: ToolContext;
  let mockPermissionManager: PermissionManager;
  let mockMessageManager: MessageManager;

  beforeEach(() => {
    vi.clearAllMocks();

    mockMessageManager = {
      updateToolBlock: vi.fn(),
    } as unknown as MessageManager;

    mockPermissionManager = {
      getPlanFilePath: vi.fn().mockReturnValue("/test/plan.md"),
      checkPermission: vi.fn().mockResolvedValue({ behavior: "allow" }),
      createContext: vi
        .fn()
        .mockImplementation(
          (toolName, permissionMode, callback, toolInput) => ({
            toolName,
            permissionMode,
            canUseToolCallback: callback,
            toolInput,
          }),
        ),
    } as unknown as PermissionManager;

    mockContext = {
      workdir: "/test/workdir",
      permissionManager: mockPermissionManager,
      messageManager: mockMessageManager,
      toolCallId: "test-call-id",
    } as unknown as ToolContext;
  });

  it("should read plan content and update tool block before permission check", async () => {
    const planContent = "Test plan content";
    vi.mocked(fs.readFile).mockResolvedValue(planContent);

    await exitPlanModeTool.execute({}, mockContext);

    // Verify plan was read
    expect(fs.readFile).toHaveBeenCalledWith("/test/plan.md", "utf-8");

    // Verify tool block was updated with plan content
    expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "test-call-id",
        planContent: planContent,
        stage: "running",
      }),
    );

    // Verify permission check was called
    expect(mockPermissionManager.checkPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "ExitPlanMode",
      }),
    );
  });

  it("should use tool name as fallback ID if toolCallId is missing", async () => {
    const contextWithoutId = {
      ...mockContext,
      toolCallId: undefined,
    } as ToolContext;

    vi.mocked(fs.readFile).mockResolvedValue("content");

    await exitPlanModeTool.execute({}, contextWithoutId);

    expect(mockMessageManager.updateToolBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "ExitPlanMode",
      }),
    );
  });

  it("should return error when plan file is missing", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("File not found"));

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to read plan file");
  });

  it("should return success result when permission is allowed", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("content");
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "allow",
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result).toEqual({
      success: true,
      content: "Plan approved. Exiting plan mode.",
      shortResult: "Plan approved",
    });
  });

  it("should return error result when permission is denied", async () => {
    vi.mocked(fs.readFile).mockResolvedValue("content");
    vi.mocked(mockPermissionManager.checkPermission).mockResolvedValue({
      behavior: "deny",
      message: "User denied",
    });

    const result = await exitPlanModeTool.execute({}, mockContext);

    expect(result).toEqual({
      success: false,
      content: "User denied",
    });
  });
});
