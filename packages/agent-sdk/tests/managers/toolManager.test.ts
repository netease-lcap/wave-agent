import { describe, it, expect, vi } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";

describe("ToolManager tool filtering", () => {
  const mockMcpManager = {
    isMcpTool: vi.fn().mockReturnValue(false),
    executeMcpToolByRegistry: vi.fn(),
    getAllConnectedTools: vi.fn().mockReturnValue([]),
    getToolsConfig: vi.fn().mockReturnValue([]),
    getMcpToolPlugins: vi.fn().mockReturnValue([]),
  } as unknown as McpManager;

  it("should enable all tools when tools is undefined", () => {
    const toolManager = new ToolManager({
      mcpManager: mockMcpManager,
    });
    toolManager.initializeBuiltInTools();
    const tools = toolManager.list().map((t) => t.name);
    expect(tools).toContain("Bash");
    expect(tools).toContain("Read");
    expect(tools).toContain("Write");
  });

  it("should enable only specified tools", () => {
    const toolManager = new ToolManager({
      mcpManager: mockMcpManager,
      tools: ["Bash", "Read"],
    });
    toolManager.initializeBuiltInTools();
    const tools = toolManager.list().map((t) => t.name);
    expect(tools).toContain("Bash");
    expect(tools).toContain("Read");
    expect(tools).not.toContain("Write");
  });

  it("should be case-insensitive when filtering tools", () => {
    const toolManager = new ToolManager({
      mcpManager: mockMcpManager,
      tools: ["bash", "READ"],
    });
    toolManager.initializeBuiltInTools();
    const tools = toolManager.list().map((t) => t.name);
    expect(tools).toContain("Bash");
    expect(tools).toContain("Read");
    expect(tools).not.toContain("Write");
  });

  it("should disable all tools when tools is an empty array", () => {
    const toolManager = new ToolManager({
      mcpManager: mockMcpManager,
      tools: [],
    });
    toolManager.initializeBuiltInTools();
    const tools = toolManager.list().map((t) => t.name);
    expect(tools).toHaveLength(0);
  });
});
