import { describe, it, expect, vi } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";

describe("ToolManager tool filtering - US2 & US3", () => {
  const mockMcpManager = {
    isMcpTool: vi.fn().mockReturnValue(false),
    executeMcpToolByRegistry: vi.fn(),
    getAllConnectedTools: vi.fn().mockReturnValue([]),
    getToolsConfig: vi.fn().mockReturnValue([]),
    getMcpToolPlugins: vi.fn().mockReturnValue([]),
  } as unknown as McpManager;

  it("should disable all tools when tools is an empty array (US2)", () => {
    const toolManager = new ToolManager({
      mcpManager: mockMcpManager,
      tools: [],
    });
    toolManager.initializeBuiltInTools();
    const tools = toolManager.list().map((t) => t.name);
    expect(tools).toHaveLength(0);
  });

  it("should enable all tools when tools is undefined (US3 default)", () => {
    const toolManager = new ToolManager({
      mcpManager: mockMcpManager,
      tools: undefined,
    });
    toolManager.initializeBuiltInTools();
    const tools = toolManager.list().map((t) => t.name);
    expect(tools).toContain("Bash");
    expect(tools).toContain("Read");
  });
});
