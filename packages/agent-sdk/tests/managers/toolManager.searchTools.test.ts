import { describe, it, expect, vi, beforeEach } from "vitest";
import { ToolManager } from "@/managers/toolManager.js";
import { McpManager } from "@/managers/mcpManager.js";
import { Container } from "@/utils/container.js";
import { isBashAvailable } from "@/utils/bashAvailability.js";
import type { ToolContext } from "@/tools/types.js";

// Mocked so building the tool set never reads auth files or merges config:
// Artifact availability is decided per account, not by this suite.
vi.mock("@/services/artifactAvailability.js", () => ({
  isArtifactEnabled: vi.fn().mockReturnValue(false),
}));

// The tool set now depends on whether this session has a usable bash, so the
// answer is stated per case instead of inherited from whatever the machine has
// installed. Defaulting to "bash is here" keeps every existing case meaning what
// it meant: the search tools are folded *despite* a bash being available.
vi.mock("@/utils/bashAvailability.js", () => ({
  isBashAvailable: vi.fn(() => true),
}));

// The REPL is the folded pair's only entrance, so the switch is stated per case
// too rather than read from this machine's settings.
const gate = vi.hoisted(() => ({
  execEnabled: true,
  coreToolsEnabled: false,
}));

vi.mock("@/services/replAvailability.js", () => ({
  REPL_DEFAULT_ENABLED: true,
  REPL_CORE_TOOLS_DEFAULT_ENABLED: false,
  isReplEnabled: () => gate.execEnabled,
  isReplCoreToolsEnabled: () => gate.execEnabled && gate.coreToolsEnabled,
  getNonDeferrableBuiltins: () => new Set<string>(),
}));

const SEARCH = ["Grep", "Glob"];

function mockMcpManager(): McpManager {
  return {
    isMcpTool: vi.fn().mockReturnValue(false),
    executeMcpToolByRegistry: vi.fn(),
    getAllConnectedTools: vi.fn().mockReturnValue([]),
    getMcpToolsConfig: vi.fn().mockReturnValue([]),
    getMcpToolOutputSchemas: vi.fn().mockReturnValue(new Map()),
    getMcpToolPlugins: vi.fn().mockReturnValue([]),
  } as unknown as McpManager;
}

function createContainer(denied: string[] = []): Container {
  const container = new Container();
  container.register("PermissionManager", {
    isToolDenied: vi
      .fn()
      .mockImplementation((name: string) => denied.includes(name)),
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
  container.register("McpManager", mockMcpManager());
  return container;
}

function build(
  options: {
    tools?: string[];
    disallowedTools?: string[];
    denied?: string[];
  } = {},
) {
  const toolManager = new ToolManager({
    container: createContainer(options.denied),
    tools: options.tools,
    disallowedTools: options.disallowedTools,
  });
  toolManager.initializeBuiltInTools();
  return toolManager;
}

/** The three lists the pair can sit on: the registry, this request's `tools[]`, the pool. */
function placements(toolManager: ToolManager) {
  return {
    registered: toolManager.list().map((tool) => tool.name),
    flat: toolManager.getToolsConfig().map((config) => config.function.name),
    pool: toolManager.getReplPool(),
  };
}

describe("ToolManager search tools fold", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isBashAvailable).mockReturnValue(true);
    gate.execEnabled = true;
    gate.coreToolsEnabled = false;
  });

  it("folds Grep and Glob into the pool by default when a bash is available", () => {
    // Search runs through the Bash tool's grep/find shadows (core/fs-tools.md),
    // and those shadows only exist inside a bash. The premise is constructed
    // rather than inherited: without a bash the same default grows the two tools
    // back flat, so a test that read the machine would assert either behaviour.
    const { registered, flat, pool } = placements(build());

    // Registered: the pool, `describeTool` and transcript replay all read the registry.
    expect(registered).toEqual(expect.arrayContaining(SEARCH));
    // Not flat: one entrance only, and the shadows are what search goes through.
    expect(flat).toContain("Bash");
    expect(flat).toContain("Read");
    expect(flat).not.toContain("Grep");
    expect(flat).not.toContain("Glob");
    // In the pool, name-only: the fold refuses the flat call, not the script
    // entrance, and a signature would be advertising the way round it.
    expect(pool.map((entry) => entry.name)).toEqual(
      expect.arrayContaining(SEARCH),
    );
    for (const entry of pool.filter((entry) => SEARCH.includes(entry.name))) {
      expect(entry.tier).toBeUndefined();
    }
  });

  it("keeps them name-only in the pool even with enableReplCoreTools on", () => {
    gate.coreToolsEnabled = true;
    const { flat, pool } = placements(build());

    // The switch pulls Read into the signature tier; the pair stays a name.
    expect(pool.find((entry) => entry.name === "Read")?.tier).toBe("core");
    for (const name of SEARCH) {
      expect(pool.find((entry) => entry.name === name)?.tier).toBeUndefined();
      expect(flat).not.toContain(name);
    }
  });

  it("rejects a flat call of the folded pair and points at the script form", async () => {
    const toolManager = build();
    const grep = toolManager.getTools().find((tool) => tool.name === "Grep")!;
    const run = vi.spyOn(grep, "execute");

    const result = await toolManager.execute("Grep", { pattern: "PROBE" }, {
      workdir: "/test/workdir",
      sessionId: "session-1",
      declaredToolNames: new Set(["REPL"]),
    } as unknown as ToolContext);

    expect(result.success).toBe(false);
    expect(result.content).toContain("No such tool available: Grep");
    expect(result.content).toContain("await tools.Grep({...})");
    expect(result.content).toContain("REPL pool");
    // The judgment is about running it, not about the wording.
    expect(run).not.toHaveBeenCalled();
  });

  it("keeps both entrances closed while the REPL is off", () => {
    // No pool to put them in: the pair stays in the registry (replay) and goes
    // nowhere else — the same as a session that never had them, since the
    // shadows in Bash are what the model searches with.
    gate.execEnabled = false;
    const { registered, flat } = placements(build());

    expect(registered).toEqual(expect.arrayContaining(SEARCH));
    expect(flat).not.toContain("REPL");
    for (const name of SEARCH) expect(flat).not.toContain(name);
  });

  it("keeps both entrances closed while the REPL is denied", () => {
    const { registered, flat } = placements(build({ denied: ["REPL"] }));

    expect(registered).toEqual(expect.arrayContaining(SEARCH));
    expect(flat).not.toContain("REPL");
    for (const name of SEARCH) expect(flat).not.toContain(name);
  });

  it("unfolds the named one flat when --tools names it", () => {
    const { flat, pool } = placements(build({ tools: ["Bash", "Grep"] }));

    expect(flat).toContain("Grep");
    expect(flat).not.toContain("Glob");
    // Unfolded, it follows `Read`'s rule: flat while the core switch is off.
    expect(pool.map((entry) => entry.name)).not.toContain("Grep");
  });

  it("unfolds both flat when the session has no bash", () => {
    // Nothing to substitute: with no bash there is no grep/find shadow, and
    // leaving the pair pool-only would make every search a script.
    vi.mocked(isBashAvailable).mockReturnValue(false);
    const { flat } = placements(build());

    expect(flat).toContain("Grep");
    expect(flat).toContain("Glob");
  });

  it("unfolds both flat, once, when --tools names them without a bash", () => {
    vi.mocked(isBashAvailable).mockReturnValue(false);
    const { flat } = placements(build({ tools: ["Bash", "Grep", "Glob"] }));

    expect(flat.filter((name) => name === "Grep")).toHaveLength(1);
    expect(flat.filter((name) => name === "Glob")).toHaveLength(1);
  });

  it("matches the opt-in name case-insensitively", () => {
    expect(placements(build({ tools: ["Bash", "glob"] })).flat).toContain(
      "Glob",
    );
  });

  it("keeps them out when the tool list is empty", () => {
    // `--tools` is a definition-level allow-list: an unnamed tool is not
    // registered, fold or no fold.
    const { registered } = placements(build({ tools: [] }));

    for (const name of SEARCH) expect(registered).not.toContain(name);
  });

  it("lets an explicit denial win over the opt-in", () => {
    const { flat } = placements(
      build({
        tools: ["Bash", "Grep", "Glob"],
        disallowedTools: ["Grep"],
      }),
    );

    expect(flat).not.toContain("Grep");
    expect(flat).toContain("Glob");
  });
});

describe("Bash description follows the search tools it can call flat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isBashAvailable).mockReturnValue(true);
    gate.execEnabled = true;
    gate.coreToolsEnabled = false;
  });

  const shellDescription = (toolName: string, tools?: string[]) =>
    build({ tools })
      .getToolsConfig()
      .find((config) => config.function.name === toolName)?.function
      .description;

  const bashDescription = (tools?: string[]) => shellDescription("Bash", tools);

  it("points at find/grep in Bash while Grep and Glob sit folded in the pool", () => {
    // The pair is registered at this point — what the description follows is
    // whether this request declares it flat, or it would send the model after a
    // name the request does not carry.
    const description = bashDescription()!;

    expect(description).toContain("`find` in Bash");
    expect(description).toContain("`grep -rn` in Bash");
    expect(description).not.toContain("Use Glob (NOT find or ls)");
  });

  it("flips the shell that replaces Bash to Glob/Grep guidance", () => {
    // A session with no bash has no Bash tool, so that description cannot carry
    // the flip: the shell tool is PowerShell (a Windows shape — on POSIX a
    // missing bash leaves no shell tool at all), and its description is what has
    // to name the search tools that came back.
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      vi.mocked(isBashAvailable).mockReturnValue(false);

      const description = shellDescription("PowerShell")!;

      expect(description).toContain("Use Glob (NOT `Get-ChildItem -Recurse`)");
      expect(description).toContain("Use Grep (NOT `Select-String`)");
      expect(description).not.toContain("no Glob tool");
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });

  it("points back at Glob/Grep once they are declared flat", () => {
    const description = bashDescription(["Bash", "Grep", "Glob"])!;

    expect(description).toContain("Use Glob (NOT find or ls)");
    expect(description).toContain("Use Grep (NOT grep or rg)");
    expect(description).not.toContain("`grep -rn` in Bash");
  });
});
