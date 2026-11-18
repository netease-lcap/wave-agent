import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ToolManager } from "../../src/managers/toolManager.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import { Container } from "../../src/utils/container.js";
import { POWERSHELL_TOOL_ENV_VAR } from "../../src/utils/shell/shellToolGate.js";
import { isBashAvailable } from "../../src/utils/bashAvailability.js";

vi.mock("../../src/utils/bashAvailability.js", () => ({
  isBashAvailable: vi.fn(() => true),
}));

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

describe("the PowerShell tool is registered by the shell gate", () => {
  let platform: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    delete process.env[POWERSHELL_TOOL_ENV_VAR];
    platform = vi.spyOn(process, "platform", "get").mockReturnValue("win32");
  });

  afterEach(() => {
    delete process.env[POWERSHELL_TOOL_ENV_VAR];
    platform.mockRestore();
    vi.mocked(isBashAvailable).mockReturnValue(true);
  });

  it("registers it on Windows when there is no Git Bash", () => {
    vi.mocked(isBashAvailable).mockReturnValue(false);
    const toolManager = build();
    toolManager.initializeBuiltInTools();
    expect(names(toolManager)).toContain("PowerShell");
  });

  it("withholds it on Windows while Git Bash is the session's shell", () => {
    const toolManager = build();
    toolManager.initializeBuiltInTools();
    expect(names(toolManager)).not.toContain("PowerShell");
    // The substitute is still there — withholding PowerShell must not cost Bash.
    expect(names(toolManager)).toContain("Bash");
  });

  it("registers it on Windows when the flag asks for it", () => {
    process.env[POWERSHELL_TOOL_ENV_VAR] = "1";
    const toolManager = build();
    toolManager.initializeBuiltInTools();
    expect(names(toolManager)).toContain("PowerShell");
  });

  it("never registers it off Windows", () => {
    platform.mockReturnValue("linux");
    process.env[POWERSHELL_TOOL_ENV_VAR] = "1";
    const toolManager = build();
    toolManager.initializeBuiltInTools();
    expect(names(toolManager)).not.toContain("PowerShell");
  });

  it("registers and unregisters it on a live reload, both directions", () => {
    const toolManager = build();
    toolManager.initializeBuiltInTools();
    expect(names(toolManager)).not.toContain("PowerShell");

    process.env[POWERSHELL_TOOL_ENV_VAR] = "1";
    toolManager.reloadFeatureGatedTools();
    expect(names(toolManager)).toContain("PowerShell");

    delete process.env[POWERSHELL_TOOL_ENV_VAR];
    toolManager.reloadFeatureGatedTools();
    expect(names(toolManager)).not.toContain("PowerShell");
  });
});
