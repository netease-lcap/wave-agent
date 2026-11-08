import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";
import { Container } from "@/utils/container.js";

// Mocked so building the tool set never reads auth files or merges config:
// Artifact availability is decided per account, not by this suite.
vi.mock("@/services/artifactAvailability.js", () => ({
  isArtifactEnabled: vi.fn().mockReturnValue(false),
}));

describe("ToolManager search tools opt-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockMcpManager = {
    isMcpTool: vi.fn().mockReturnValue(false),
    executeMcpToolByRegistry: vi.fn(),
    getAllConnectedTools: vi.fn().mockReturnValue([]),
    getMcpToolsConfig: vi.fn().mockReturnValue([]),
    getMcpToolOutputSchemas: vi.fn().mockReturnValue(new Map()),
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

  const toolNames = (options: {
    tools?: string[];
    disallowedTools?: string[];
  }) => {
    const toolManager = new ToolManager({
      container: createContainer(),
      ...options,
    });
    toolManager.initializeBuiltInTools();
    return toolManager.list().map((tool) => tool.name);
  };

  it("does not register Grep or Glob by default", () => {
    // Search moved into the Bash tool's grep/find shadows
    // (core/fs-tools.md「默认工具集不含搜索工具」), so the default tool set must
    // not carry the structured alternatives.
    const names = toolNames({});

    expect(names).toContain("Bash");
    expect(names).toContain("Read");
    expect(names).not.toContain("Grep");
    expect(names).not.toContain("Glob");
  });

  it("registers a named search tool, and only that one", () => {
    const names = toolNames({ tools: ["Bash", "Grep"] });

    expect(names).toContain("Grep");
    expect(names).not.toContain("Glob");
  });

  it("matches the opt-in name case-insensitively", () => {
    expect(toolNames({ tools: ["Bash", "glob"] })).toContain("Glob");
  });

  it("keeps them out when the tool list is empty", () => {
    const names = toolNames({ tools: [] });

    expect(names).not.toContain("Grep");
    expect(names).not.toContain("Glob");
  });

  it("lets an explicit denial win over the opt-in", () => {
    const names = toolNames({
      tools: ["Bash", "Grep", "Glob"],
      disallowedTools: ["Grep"],
    });

    expect(names).not.toContain("Grep");
    expect(names).toContain("Glob");
  });
});

describe("Bash description follows the search tools it can reach", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const mockMcpManager = {
    isMcpTool: vi.fn().mockReturnValue(false),
    executeMcpToolByRegistry: vi.fn(),
    getAllConnectedTools: vi.fn().mockReturnValue([]),
    getMcpToolsConfig: vi.fn().mockReturnValue([]),
    getMcpToolOutputSchemas: vi.fn().mockReturnValue(new Map()),
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

  const bashDescription = (tools?: string[]) => {
    const toolManager = new ToolManager({
      container: createContainer(),
      tools,
    });
    toolManager.initializeBuiltInTools();
    return toolManager
      .getToolsConfig()
      .find((config) => config.function.name === "Bash")?.function.description;
  };

  it("points at find/grep in Bash when Grep and Glob are absent", () => {
    const description = bashDescription()!;

    expect(description).toContain("`find` in Bash");
    expect(description).toContain("`grep -rn` in Bash");
    expect(description).not.toContain("Use Glob (NOT find or ls)");
  });

  it("points back at Glob/Grep once they are registered", () => {
    const description = bashDescription(["Bash", "Grep", "Glob"])!;

    expect(description).toContain("Use Glob (NOT find or ls)");
    expect(description).toContain("Use Grep (NOT grep or rg)");
    expect(description).not.toContain("`grep -rn` in Bash");
  });
});
