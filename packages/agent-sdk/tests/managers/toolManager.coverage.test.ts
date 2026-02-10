import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager } from "../../src/managers/toolManager.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import type { Logger } from "../../src/types/index.js";
import type { ToolPlugin, ToolContext } from "../../src/tools/types.js";

describe("ToolManager - Additional Coverage", () => {
  let toolManager: ToolManager;
  let mockMcpManager: McpManager;

  beforeEach(() => {
    mockMcpManager = {
      isMcpTool: vi.fn().mockReturnValue(false),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
      executeMcpToolByRegistry: vi.fn(),
    } as unknown as McpManager;

    toolManager = new ToolManager({
      mcpManager: mockMcpManager,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      } as unknown as Logger,
    });
  });

  it("should handle tool execution error", async () => {
    const mockTool = {
      name: "ErrorTool",
      config: {
        type: "function",
        function: { name: "ErrorTool", description: "d" },
      },
      execute: vi.fn().mockRejectedValue(new Error("Execution failed")),
    };
    toolManager.register(mockTool as unknown as ToolPlugin);

    const result = await toolManager.execute("ErrorTool", {}, {
      workdir: "/test",
    } as unknown as ToolContext);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Execution failed");
  });

  it("should handle tool not found", async () => {
    const result = await toolManager.execute("NonExistent", {}, {
      workdir: "/test",
    } as unknown as ToolContext);
    expect(result.success).toBe(false);
    expect(result.error).toBe("Tool 'NonExistent' not found");
  });

  it("should filter tools in getToolsConfig based on permission mode", () => {
    const exitTool = {
      name: "ExitPlanMode",
      config: {
        type: "function",
        function: { name: "ExitPlanMode", description: "d" },
      },
    };
    const askTool = {
      name: "AskUserQuestion",
      config: {
        type: "function",
        function: { name: "AskUserQuestion", description: "d" },
      },
    };
    const normalTool = {
      name: "NormalTool",
      config: {
        type: "function",
        function: { name: "NormalTool", description: "d" },
      },
    };

    toolManager.register(exitTool as unknown as ToolPlugin);
    toolManager.register(askTool as unknown as ToolPlugin);
    toolManager.register(normalTool as unknown as ToolPlugin);

    // Default mode
    toolManager.setPermissionMode("default");
    let config = toolManager.getToolsConfig();
    expect(
      config.find((c) => c.function.name === "ExitPlanMode"),
    ).toBeUndefined();
    expect(
      config.find((c) => c.function.name === "AskUserQuestion"),
    ).toBeDefined();
    expect(config.find((c) => c.function.name === "NormalTool")).toBeDefined();

    // Plan mode
    toolManager.setPermissionMode("plan");
    config = toolManager.getToolsConfig();
    expect(
      config.find((c) => c.function.name === "ExitPlanMode"),
    ).toBeDefined();

    // Bypass mode
    toolManager.setPermissionMode("bypassPermissions");
    config = toolManager.getToolsConfig();
    expect(
      config.find((c) => c.function.name === "ExitPlanMode"),
    ).toBeUndefined();
    expect(
      config.find((c) => c.function.name === "AskUserQuestion"),
    ).toBeUndefined();
    expect(config.find((c) => c.function.name === "NormalTool")).toBeDefined();
  });
});
