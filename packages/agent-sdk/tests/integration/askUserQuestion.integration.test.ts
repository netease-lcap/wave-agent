import { describe, it, expect, vi } from "vitest";
import { ToolManager } from "../../src/managers/toolManager.js";
import { PermissionManager } from "../../src/managers/permissionManager.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { ToolContext } from "../../src/tools/types.js";

import { Container } from "../../src/utils/container.js";

describe("AskUserQuestion Integration", () => {
  it("should flow from ToolManager to PermissionManager and return answers", async () => {
    const container = new Container();
    const mcpManager = new McpManager(container);
    const permissionManager = new PermissionManager(container);
    vi.spyOn(permissionManager, "checkPermission").mockResolvedValue({
      behavior: "allow",
      message: JSON.stringify({ "Choose approach": "JWT" }),
    });

    container.register("PermissionManager", permissionManager);
    container.register("McpManager", mcpManager);
    container.register("TaskManager", {} as unknown as Record<string, unknown>);
    container.register(
      "ReversionManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "BackgroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "ForegroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register("LspManager", {} as unknown as Record<string, unknown>);

    const toolManager = new ToolManager({
      container,
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
    const container = new Container();
    const mcpManager = new McpManager(container);
    const permissionManager = new PermissionManager(container);
    permissionManager.setPlanFilePath("/tmp/plan.md");
    vi.spyOn(permissionManager, "checkPermission").mockResolvedValue({
      behavior: "allow",
      message: JSON.stringify({ "Confirm?": "Yes" }),
    });

    container.register("PermissionManager", permissionManager);
    container.register("McpManager", mcpManager);
    container.register("PermissionMode", "plan");
    container.register("TaskManager", {} as unknown as Record<string, unknown>);
    container.register(
      "ReversionManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "BackgroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register(
      "ForegroundTaskManager",
      {} as unknown as Record<string, unknown>,
    );
    container.register("LspManager", {} as unknown as Record<string, unknown>);

    const toolManager = new ToolManager({
      container,
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
