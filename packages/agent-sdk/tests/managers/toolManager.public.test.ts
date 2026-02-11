/**
 * Test to demonstrate the public initializeBuiltInTools method
 */

import { describe, it, expect, vi } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";
import { SubagentManager } from "@/managers/subagentManager.js";
import { SkillManager } from "@/managers/skillManager.js";
import { PermissionManager } from "@/managers/permissionManager.js";

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
    expect(toolNames).toContain("TaskCreate");
    expect(toolNames).toContain("TaskGet");
    expect(toolNames).toContain("TaskUpdate");
    expect(toolNames).toContain("TaskList");
    expect(toolNames).toContain("Task");
    expect(toolNames).toContain("Skill");
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
    expect(toolNames).toContain("TaskCreate");
    expect(toolNames.filter((name) => name === "TaskCreate")).toHaveLength(1);
  });
});

describe("ToolManager bypassPermissions mode", () => {
  it("should exclude ExitPlanMode and AskUserQuestion in bypassPermissions mode", async () => {
    const mockMcpManager = {
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
    } as unknown as McpManager;

    const mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("bypassPermissions"),
    } as unknown as PermissionManager;

    const toolManager = new ToolManager({
      mcpManager: mockMcpManager,
      permissionManager: mockPermissionManager,
    });

    toolManager.initializeBuiltInTools();

    const toolsConfig = toolManager.getToolsConfig();
    const toolNames = toolsConfig.map((t) => t.function.name);

    expect(toolNames).not.toContain("ExitPlanMode");
    expect(toolNames).not.toContain("AskUserQuestion");
    expect(toolNames).toContain("Bash");
    expect(toolNames).toContain("Read");
  });

  it("should include AskUserQuestion in default mode", async () => {
    const mockMcpManager = {
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
    } as unknown as McpManager;

    const mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
    } as unknown as PermissionManager;

    const toolManager = new ToolManager({
      mcpManager: mockMcpManager,
      permissionManager: mockPermissionManager,
    });

    toolManager.initializeBuiltInTools();

    const toolsConfig = toolManager.getToolsConfig();
    const toolNames = toolsConfig.map((t) => t.function.name);

    expect(toolNames).toContain("AskUserQuestion");
    expect(toolNames).not.toContain("ExitPlanMode"); // ExitPlanMode only in plan mode
  });

  it("should include ExitPlanMode and AskUserQuestion in plan mode", async () => {
    const mockMcpManager = {
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
    } as unknown as McpManager;

    const mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("plan"),
    } as unknown as PermissionManager;

    const toolManager = new ToolManager({
      mcpManager: mockMcpManager,
      permissionManager: mockPermissionManager,
    });

    toolManager.initializeBuiltInTools();

    const toolsConfig = toolManager.getToolsConfig();
    const toolNames = toolsConfig.map((t) => t.function.name);

    expect(toolNames).toContain("ExitPlanMode");
    expect(toolNames).toContain("AskUserQuestion");
  });

  it("should register TaskOutput and TaskStop tools", () => {
    const mockMcpManager = {
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
    } as unknown as McpManager;

    const toolManager = new ToolManager({
      mcpManager: mockMcpManager,
    });

    toolManager.initializeBuiltInTools();

    const tools = toolManager.list();
    const toolNames = tools.map((t) => t.name);

    expect(toolNames).toContain("TaskOutput");
    expect(toolNames).toContain("TaskStop");
  });
});
