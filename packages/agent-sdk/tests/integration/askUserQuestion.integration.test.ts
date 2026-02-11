import { describe, it, expect, vi } from "vitest";
import { ToolManager } from "../../src/managers/toolManager.js";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { ToolContext } from "../../src/tools/types.js";

describe("AskUserQuestion Integration", () => {
  it("should flow from ToolManager to PermissionManager and return answers", async () => {
    const mcpManager = new McpManager();
    const permissionManager = new PermissionManager();
    vi.spyOn(permissionManager, "checkPermission").mockResolvedValue({
      behavior: "allow",
      message: JSON.stringify({ "Choose approach": "JWT" }),
    });

    const toolManager = new ToolManager({
      mcpManager,
      permissionManager,
    });
    toolManager.initializeBuiltInTools();

    const context = {
      // Minimal context needed
    } as unknown as ToolContext;

    const args = {
      questions: [
        {
          question: "Choose approach",
          header: "Auth",
          options: [{ label: "JWT" }, { label: "OAuth2" }],
        },
      ],
    };

    const result = await toolManager.execute("AskUserQuestion", args, context);

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content)).toEqual({
      answers: { "Choose approach": "JWT" },
    });
    expect(permissionManager.checkPermission).toHaveBeenCalled();
  });

  it("should work in plan mode", async () => {
    const mcpManager = new McpManager();
    const permissionManager = new PermissionManager();
    permissionManager.setPlanFilePath("/tmp/plan.md");
    vi.spyOn(permissionManager, "checkPermission").mockResolvedValue({
      behavior: "allow",
      message: JSON.stringify({ "Confirm?": "Yes" }),
    });

    const toolManager = new ToolManager({
      mcpManager,
      permissionManager,
      permissionMode: "plan",
    });
    toolManager.initializeBuiltInTools();

    const context = {} as unknown as ToolContext;

    const args = {
      questions: [
        {
          question: "Confirm?",
          header: "Confirm",
          options: [{ label: "Yes" }, { label: "No" }],
        },
      ],
    };

    const result = await toolManager.execute("AskUserQuestion", args, context);

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content)).toEqual({
      answers: { "Confirm?": "Yes" },
    });
  });
});
