import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager } from "../../src/managers/toolManager.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";

import type { ToolPlugin, ToolContext } from "../../src/tools/types.js";

describe("ToolManager additional coverage", () => {
  let toolManager: ToolManager;
  let mockMcpManager: McpManager;
  let container: Container;

  beforeEach(() => {
    mockMcpManager = {
      isMcpTool: vi.fn().mockReturnValue(false),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
      getMcpToolOutputSchemas: vi.fn().mockReturnValue(new Map()),
      executeMcpToolByRegistry: vi.fn(),
    } as unknown as McpManager;

    container = new Container();
    container.register("McpManager", mockMcpManager);
    container.register("PermissionManager", {
      isToolDenied: vi.fn().mockReturnValue(false),
      getCurrentEffectiveMode: vi
        .fn()
        .mockImplementation((mode) => mode || "default"),
    } as unknown as Record<string, unknown>);
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

    toolManager = new ToolManager({ container });
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
});
