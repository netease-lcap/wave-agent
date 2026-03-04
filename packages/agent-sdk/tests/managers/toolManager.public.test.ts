/**
 * Test to demonstrate the public initializeBuiltInTools method
 */

import { describe, it, expect, vi } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";
import { SubagentManager } from "@/managers/subagentManager.js";
import { SkillManager } from "@/managers/skillManager.js";
import { PermissionManager } from "@/managers/permissionManager.js";
import { Container } from "@/utils/container.js";
import type { TaskManager } from "@/services/taskManager.js";
import type { ReversionManager } from "@/managers/reversionManager.js";
import type { BackgroundTaskManager } from "@/managers/backgroundTaskManager.js";
import type { IForegroundTaskManager } from "@/types/processes.js";
import type { ILspManager } from "@/types/index.js";

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

    // Create container
    const container = new Container();

    // Create mock dependencies
    const mockSubagentManager = {
      getConfigurations: vi.fn().mockReturnValue([]),
    } as unknown as SubagentManager;

    const mockSkillManager = {
      getAvailableSkills: vi.fn().mockReturnValue([]),
    } as unknown as SkillManager;

    const mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
    } as unknown as PermissionManager;

    const mockTaskManager = {
      listTasks: vi.fn().mockResolvedValue([]),
      getTaskListId: vi.fn().mockReturnValue("test-task-list"),
    } as unknown as import("@/services/taskManager.js").TaskManager;

    const mockReversionManager =
      {} as unknown as import("@/managers/reversionManager.js").ReversionManager;
    const mockBackgroundTaskManager =
      {} as unknown as import("@/managers/backgroundTaskManager.js").BackgroundTaskManager;
    const mockForegroundTaskManager =
      {} as unknown as import("@/types/processes.js").IForegroundTaskManager;
    const mockLspManager =
      {} as unknown as import("@/types/index.js").ILspManager;

    // Register dependencies in container
    container.register("McpManager", mockMcpManager);
    container.register("SubagentManager", mockSubagentManager);
    container.register("SkillManager", mockSkillManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register("TaskManager", mockTaskManager);
    container.register("ReversionManager", mockReversionManager);
    container.register("BackgroundTaskManager", mockBackgroundTaskManager);
    container.register("ForegroundTaskManager", mockForegroundTaskManager);
    container.register("LspManager", mockLspManager);

    // Create tool manager
    const toolManager = new ToolManager({ container });

    // Should be able to call initializeBuiltInTools without dependencies
    expect(() => toolManager.initializeBuiltInTools()).not.toThrow();

    // Should be able to call initializeBuiltInTools
    expect(() => toolManager.initializeBuiltInTools()).not.toThrow();

    // Verify basic tools are registered
    const tools = toolManager.list();
    const names = tools.map((t) => t.name);

    // Check that basic tools are present
    expect(names).toContain("Bash");
    expect(names).toContain("Read");
    expect(names).toContain("TaskCreate");
    expect(names).toContain("TaskGet");
    expect(names).toContain("TaskUpdate");
    expect(names).toContain("TaskList");
    expect(names).toContain("Agent");
    expect(names).toContain("Skill");
  });

  it("should allow multiple calls without issues", async () => {
    const mockMcpManager = {
      isMcpTool: vi.fn().mockReturnValue(false),
      executeMcpToolByRegistry: vi.fn(),
      getAllConnectedTools: vi.fn().mockReturnValue([]),
      getToolsConfig: vi.fn().mockReturnValue([]),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
    } as unknown as McpManager;

    const container = new Container();
    container.register("McpManager", mockMcpManager);
    const toolManager = new ToolManager({ container });

    // Call multiple times - should not cause issues
    toolManager.initializeBuiltInTools();
    toolManager.initializeBuiltInTools();

    const tools = toolManager.list();
    const names = tools.map((t) => t.name);

    // Should still have all tools (no duplicates due to Map usage)
    expect(names).toContain("TaskCreate");
    expect(names.filter((name) => name === "TaskCreate")).toHaveLength(1);
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

    const container = new Container();
    container.register("McpManager", mockMcpManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register("TaskManager", {} as unknown as TaskManager);
    container.register("ReversionManager", {} as unknown as ReversionManager);
    container.register(
      "BackgroundTaskManager",
      {} as unknown as BackgroundTaskManager,
    );
    container.register(
      "ForegroundTaskManager",
      {} as unknown as IForegroundTaskManager,
    );
    container.register("LspManager", {} as unknown as ILspManager);

    const toolManager = new ToolManager({ container });

    toolManager.initializeBuiltInTools();

    const toolsConfig = toolManager.getToolsConfig();
    const names = toolsConfig.map((t) => t.function.name);

    expect(names).not.toContain("ExitPlanMode");
    expect(names).not.toContain("AskUserQuestion");
    expect(names).toContain("Bash");
    expect(names).toContain("Read");
  });

  it("should include AskUserQuestion in default mode", async () => {
    const mockMcpManager = {
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
    } as unknown as McpManager;

    const mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
    } as unknown as PermissionManager;

    const container = new Container();
    container.register("McpManager", mockMcpManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register("TaskManager", {} as unknown as TaskManager);
    container.register("ReversionManager", {} as unknown as ReversionManager);
    container.register(
      "BackgroundTaskManager",
      {} as unknown as BackgroundTaskManager,
    );
    container.register(
      "ForegroundTaskManager",
      {} as unknown as IForegroundTaskManager,
    );
    container.register("LspManager", {} as unknown as ILspManager);

    const toolManager = new ToolManager({ container });

    toolManager.initializeBuiltInTools();

    const toolsConfig = toolManager.getToolsConfig();
    const names = toolsConfig.map((t) => t.function.name);

    expect(names).toContain("AskUserQuestion");
    expect(names).not.toContain("ExitPlanMode"); // ExitPlanMode only in plan mode
  });

  it("should include ExitPlanMode and AskUserQuestion in plan mode", async () => {
    const mockMcpManager = {
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
    } as unknown as McpManager;

    const mockPermissionManager = {
      getCurrentEffectiveMode: vi.fn().mockReturnValue("plan"),
    } as unknown as PermissionManager;

    const container = new Container();
    container.register("McpManager", mockMcpManager);
    container.register("PermissionManager", mockPermissionManager);
    container.register("TaskManager", {} as unknown as TaskManager);
    container.register("ReversionManager", {} as unknown as ReversionManager);
    container.register(
      "BackgroundTaskManager",
      {} as unknown as BackgroundTaskManager,
    );
    container.register(
      "ForegroundTaskManager",
      {} as unknown as IForegroundTaskManager,
    );
    container.register("LspManager", {} as unknown as ILspManager);

    const toolManager = new ToolManager({ container });

    toolManager.initializeBuiltInTools();

    const toolsConfig = toolManager.getToolsConfig();
    const names = toolsConfig.map((t) => t.function.name);

    expect(names).toContain("ExitPlanMode");
    expect(names).toContain("AskUserQuestion");
  });

  it("should register TaskOutput and TaskStop tools", () => {
    const mockMcpManager = {
      getMcpToolsConfig: vi.fn().mockReturnValue([]),
      getMcpToolPlugins: vi.fn().mockReturnValue([]),
    } as unknown as McpManager;

    const container = new Container();
    container.register("McpManager", mockMcpManager);
    const toolManager = new ToolManager({ container });

    toolManager.initializeBuiltInTools();

    const tools = toolManager.list();
    const names = tools.map((t) => t.name);

    expect(names).toContain("TaskOutput");
    expect(names).toContain("TaskStop");
  });
});
