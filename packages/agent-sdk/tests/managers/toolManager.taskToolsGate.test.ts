import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import { TASK_TOOLS_ENV_VAR } from "../../src/services/taskToolsAvailability.js";

const TASK_TOOLS = ["TaskCreate", "TaskGet", "TaskUpdate", "TaskList"];

function build(): ToolManager {
  const container = new Container();
  container.register("McpManager", {
    isMcpTool: () => false,
    executeMcpToolByRegistry: vi.fn(),
    getAllConnectedTools: () => [],
    getToolsConfig: () => [],
    getMcpToolPlugins: () => [],
    getMcpToolOutputSchemas: () => ({}),
  } as unknown as McpManager);
  return new ToolManager({ container });
}

function names(toolManager: ToolManager): string[] {
  return toolManager.list().map((tool) => tool.name);
}

describe("task-list tools are gated behind WAVE_ENABLE_TASK_TOOLS", () => {
  beforeEach(() => {
    delete process.env[TASK_TOOLS_ENV_VAR];
  });

  afterEach(() => {
    delete process.env[TASK_TOOLS_ENV_VAR];
  });

  it("should not register them by default", () => {
    const toolManager = build();
    toolManager.initializeBuiltInTools();
    const registered = names(toolManager);
    for (const name of TASK_TOOLS) expect(registered).not.toContain(name);
    expect(registered.filter((name) => name === "TaskStop")).toHaveLength(1);
  });

  it("should not register them for the sandbox pool either", () => {
    const toolManager = build();
    toolManager.initializeBuiltInTools();
    const pool = toolManager.getExecPool().map((entry) => entry.name);
    for (const name of TASK_TOOLS) expect(pool).not.toContain(name);
  });

  it("should register them when the flag is on", () => {
    process.env[TASK_TOOLS_ENV_VAR] = "1";
    const toolManager = build();
    toolManager.initializeBuiltInTools();
    const registered = names(toolManager);
    for (const name of TASK_TOOLS) expect(registered).toContain(name);
  });

  it("should register and unregister them on a live reload, both directions", () => {
    const toolManager = build();
    toolManager.initializeBuiltInTools();
    expect(names(toolManager)).not.toContain("TaskCreate");

    process.env[TASK_TOOLS_ENV_VAR] = "1";
    toolManager.reloadFeatureGatedTools();
    expect(names(toolManager)).toContain("TaskCreate");

    delete process.env[TASK_TOOLS_ENV_VAR];
    toolManager.reloadFeatureGatedTools();
    expect(names(toolManager)).not.toContain("TaskCreate");
  });
});
