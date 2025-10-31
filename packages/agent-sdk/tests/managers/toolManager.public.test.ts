/**
 * Test to demonstrate the public initializeBuiltInTools method
 */

import { describe, it, expect, vi } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";
import { SubagentManager } from "@/managers/subagentManager.js";
import { SkillManager } from "@/managers/skillManager.js";

describe("ToolManager.initializeBuiltInTools", () => {
  it("should be callable as a public method", async () => {
    // Create mock MCP manager
    const mockMcpManager = {
      isMcpTool: vi.fn().mockReturnValue(false),
      executeMcpToolByRegistry: vi.fn(),
      getAllConnectedTools: vi.fn().mockReturnValue([]),
      getToolsConfig: vi.fn().mockReturnValue([]),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
    } as unknown as McpManager;

    // Create tool manager
    const toolManager = new ToolManager({
      mcpManager: mockMcpManager,
    });

    // Should be able to call initializeBuiltInTools without dependencies
    expect(() => toolManager.initializeBuiltInTools()).not.toThrow();

    // Create mock dependencies
    const mockSubagentManager = {
      getConfigurations: vi.fn().mockReturnValue([]),
    } as unknown as SubagentManager;

    const mockSkillManager = {
      getAvailableSkills: vi.fn().mockReturnValue([]),
    } as unknown as SkillManager;

    // Should be able to call with dependencies
    expect(() =>
      toolManager.initializeBuiltInTools({
        subagentManager: mockSubagentManager,
        skillManager: mockSkillManager,
      }),
    ).not.toThrow();

    // Verify basic tools are registered
    const tools = toolManager.list();
    const toolNames = tools.map((t) => t.name);

    // Check that basic tools are present
    expect(toolNames).toContain("Bash");
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("TodoWrite");
    expect(toolNames).toContain("Task");
    expect(toolNames).toContain("skill");
  });

  it("should allow multiple calls without issues", async () => {
    const mockMcpManager = {
      isMcpTool: vi.fn().mockReturnValue(false),
      executeMcpToolByRegistry: vi.fn(),
      getAllConnectedTools: vi.fn().mockReturnValue([]),
      getToolsConfig: vi.fn().mockReturnValue([]),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
    } as unknown as McpManager;

    const toolManager = new ToolManager({
      mcpManager: mockMcpManager,
    });

    // Call multiple times - should not cause issues
    toolManager.initializeBuiltInTools();
    toolManager.initializeBuiltInTools();

    const tools = toolManager.list();
    const toolNames = tools.map((t) => t.name);

    // Should still have all tools (no duplicates due to Map usage)
    expect(toolNames).toContain("TodoWrite");
    expect(toolNames.filter((name) => name === "TodoWrite")).toHaveLength(1);
  });
});
