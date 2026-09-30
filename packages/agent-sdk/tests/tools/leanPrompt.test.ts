import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { Container } from "@/utils/container.js";
import { artifactTool } from "@/tools/artifactTool.js";
import { execTool } from "@/tools/execTool.js";

const { isLeanPromptEnabled } = vi.hoisted(() => ({
  isLeanPromptEnabled: vi.fn(() => false),
}));

vi.mock("@/services/leanPrompt.js", () => ({
  LEAN_PROMPT_DEFAULT_ENABLED: true,
  isLeanPromptEnabled,
}));

function createManager(): ToolManager {
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
  container.register("McpManager", {
    isMcpTool: vi.fn().mockReturnValue(false),
    executeMcpToolByRegistry: vi.fn(),
    getAllConnectedTools: vi.fn().mockReturnValue([]),
    getMcpToolsConfig: vi.fn().mockReturnValue([]),
    getMcpToolOutputSchemas: vi.fn().mockReturnValue(new Map()),
    getMcpToolPlugins: vi.fn().mockReturnValue([]),
  } as unknown as Record<string, unknown>);

  const manager = new ToolManager({ container });
  manager.initializeBuiltInTools();
  return manager;
}

describe("lean prompt mode", () => {
  beforeEach(() => {
    isLeanPromptEnabled.mockReturnValue(false);
  });

  it("declares a lean description on every built-in tool", () => {
    // Falling back to the full description is allowed, but silently forgetting
    // one is the failure mode this guards: lean mode is opt-in per tool, and a
    // new built-in that ships without `leanPrompt` would quietly stay verbose.
    const manager = createManager();
    const missing = manager
      .list()
      .filter((tool) => tool.leanPrompt === undefined)
      .map((tool) => tool.name);

    expect(missing).toEqual([]);
  });

  it("declares a lean description on the opt-in tools too", () => {
    // Artifact's registration depends on the account (it defaults on only for a
    // logged-in user), so the sweep above may or may not have seen it.
    expect(artifactTool.leanPrompt).toBeDefined();
    expect(execTool.leanPrompt).toBeDefined();
  });

  it("sends the lean description when the switch is on", () => {
    isLeanPromptEnabled.mockReturnValue(true);
    const manager = createManager();

    const read = manager
      .getToolsConfig()
      .find((tool) => tool.function.name === "Read");

    expect(read?.function.description).toContain(
      "Reads a file from the local filesystem.",
    );
    expect(read?.function.description).not.toContain(
      "You have the capability to call multiple tools in a single response",
    );
  });

  it("sends the full description when the switch is off", () => {
    const manager = createManager();

    const read = manager
      .getToolsConfig()
      .find((tool) => tool.function.name === "Read");

    expect(read?.function.description).toContain(
      "You have the capability to call multiple tools in a single response",
    );
    expect(read?.function.description).not.toContain(
      "a path the user provides can be assumed valid",
    );
  });

  it("keeps the parameter schema identical in both modes", () => {
    const full = createManager()
      .getToolsConfig()
      .find((tool) => tool.function.name === "Read");
    isLeanPromptEnabled.mockReturnValue(true);
    const lean = createManager()
      .getToolsConfig()
      .find((tool) => tool.function.name === "Read");

    expect(lean?.function.parameters).toEqual(full?.function.parameters);
    expect(lean?.function.name).toBe(full?.function.name);
  });
});
