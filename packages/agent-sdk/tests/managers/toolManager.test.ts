import { describe, it, expect, vi } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";
import { Container } from "@/utils/container.js";

describe("ToolManager tool filtering", () => {
  const mockMcpManager = {
    isMcpTool: vi.fn().mockReturnValue(false),
    executeMcpToolByRegistry: vi.fn(),
    getAllConnectedTools: vi.fn().mockReturnValue([]),
    getMcpToolsConfig: vi.fn().mockReturnValue([]),
    getMcpToolPlugins: vi.fn().mockReturnValue([]),
  } as unknown as McpManager;

  const createContainer = () => {
    const container = new Container();
    container.register("PermissionManager", {
      isToolDenied: vi.fn().mockReturnValue(false),
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
    });
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
    container.register("McpManager", mockMcpManager);
    return container;
  };

  it("should enable all tools when tools is undefined", () => {
    const toolManager = new ToolManager({
      container: createContainer(),
    });
    toolManager.initializeBuiltInTools();
    const tools = toolManager.list().map((t) => t.name);
    expect(tools).toContain("Bash");
    expect(tools).toContain("Read");
    expect(tools).toContain("Write");
  });

  it("should enable only specified tools", () => {
    const toolManager = new ToolManager({
      container: createContainer(),
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
      container: createContainer(),
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
      container: createContainer(),
      tools: [],
    });
    toolManager.initializeBuiltInTools();
    const tools = toolManager.list().map((t) => t.name);
    expect(tools).toHaveLength(0);
  });

  it("should filter out tools that are explicitly denied by name in PermissionManager", () => {
    const container = createContainer();
    const mockPermissionManager = {
      isToolDenied: vi.fn().mockImplementation((name) => name === "Bash"),
      getCurrentEffectiveMode: vi.fn().mockReturnValue("default"),
    };
    container.register("PermissionManager", mockPermissionManager);

    const toolManager = new ToolManager({
      container,
    });
    toolManager.initializeBuiltInTools();

    const tools = toolManager.list().map((t) => t.name);
    expect(tools).not.toContain("Bash");
    expect(tools).toContain("Read");
    expect(tools).toContain("Write");

    const toolsConfig = toolManager.getToolsConfig();
    const toolNames = toolsConfig.map((t) => t.function.name);
    expect(toolNames).not.toContain("Bash");
    expect(toolNames).toContain("Read");
    expect(toolNames).toContain("Write");
  });
});
