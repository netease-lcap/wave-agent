import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";
import { Container } from "@/utils/container.js";
import { isBashAvailable } from "@/utils/bashAvailability.js";

// Mocked so building the tool set never reads auth files or merges config:
// Artifact availability is decided per account, not by this suite.
vi.mock("@/services/artifactAvailability.js", () => ({
  isArtifactEnabled: vi.fn().mockReturnValue(false),
}));

// The tool set now depends on whether this session has a usable bash, so the
// answer is stated per case instead of inherited from whatever the machine has
// installed. Defaulting to "bash is here" keeps every existing case meaning what
// it meant: the search tools are withheld *despite* a bash being available.
vi.mock("@/utils/bashAvailability.js", () => ({
  isBashAvailable: vi.fn(() => true),
}));

describe("ToolManager search tools opt-in", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isBashAvailable).mockReturnValue(true);
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

  it("withholds Grep and Glob by default when a bash is available", () => {
    // Search runs through the Bash tool's grep/find shadows (core/fs-tools.md),
    // and those shadows only exist inside a bash. The premise is constructed
    // rather than inherited: without a bash the same default grows the two tools
    // back, so a test that read the machine would assert either behaviour.
    vi.mocked(isBashAvailable).mockReturnValue(true);

    const names = toolNames({});

    expect(names).toContain("Bash");
    expect(names).toContain("Read");
    expect(names).not.toContain("Grep");
    expect(names).not.toContain("Glob");
  });

  it("registers both when the session has no bash", () => {
    // Nothing to substitute: with no bash there is no grep/find shadow, and
    // withdrawing the tools would leave no way to search a file tree at all.
    vi.mocked(isBashAvailable).mockReturnValue(false);

    const names = toolNames({});

    expect(names).toContain("Grep");
    expect(names).toContain("Glob");
  });

  it("registers them once when --tools names them without a bash", () => {
    // Both routes are true at the same time; they must not register twice.
    vi.mocked(isBashAvailable).mockReturnValue(false);

    const names = toolNames({ tools: ["Bash", "Grep", "Glob"] });

    expect(names.filter((name) => name === "Grep")).toHaveLength(1);
    expect(names.filter((name) => name === "Glob")).toHaveLength(1);
  });

  it("registers a named search tool, and only that one", () => {
    vi.mocked(isBashAvailable).mockReturnValue(true);

    const names = toolNames({ tools: ["Bash", "Grep"] });

    expect(names).toContain("Grep");
    expect(names).not.toContain("Glob");
  });

  it("matches the opt-in name case-insensitively", () => {
    expect(toolNames({ tools: ["Bash", "glob"] })).toContain("Glob");
  });

  it("keeps them out when the tool list is empty", () => {
    vi.mocked(isBashAvailable).mockReturnValue(true);

    const names = toolNames({ tools: [] });

    expect(names).not.toContain("Grep");
    expect(names).not.toContain("Glob");
  });

  it("lets an explicit denial win over the opt-in", () => {
    vi.mocked(isBashAvailable).mockReturnValue(true);

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
    vi.mocked(isBashAvailable).mockReturnValue(true);
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

  it("flips to Glob/Grep guidance on a session with no bash", () => {
    vi.mocked(isBashAvailable).mockReturnValue(false);

    const description = bashDescription()!;

    expect(description).toContain("Use Glob (NOT find or ls)");
    expect(description).not.toContain("`grep -rn` in Bash");
  });

  it("points back at Glob/Grep once they are registered", () => {
    const description = bashDescription(["Bash", "Grep", "Glob"])!;

    expect(description).toContain("Use Glob (NOT find or ls)");
    expect(description).toContain("Use Grep (NOT grep or rg)");
    expect(description).not.toContain("`grep -rn` in Bash");
  });
});
