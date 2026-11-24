import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatCompletionFunctionTool } from "openai/resources.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { REPL_TOOL_NAME } from "../../src/constants/tools.js";
import { CORE_POOL_TOOLS } from "../../src/repl/deferral.js";
import { Container } from "../../src/utils/container.js";
import type { ToolPlugin } from "../../src/tools/types.js";

const gate = vi.hoisted(() => ({
  execEnabled: true,
  coreToolsEnabled: false,
  nonDeferrable: new Set<string>(),
}));

vi.mock("../../src/services/replAvailability.js", () => ({
  REPL_DEFAULT_ENABLED: true,
  REPL_CORE_TOOLS_DEFAULT_ENABLED: false,
  isReplEnabled: () => gate.execEnabled,
  isReplCoreToolsEnabled: () => gate.execEnabled && gate.coreToolsEnabled,
  getNonDeferrableBuiltins: () => gate.nonDeferrable,
}));

// The four task-list tools are off by default (WAVE_ENABLE_TASK_TOOLS). These
// tests are about the deferral shape — the task tools are part of Claude Code's
// deferred list — so pin them on rather than depend on the code default.
vi.mock("../../src/services/taskToolsAvailability.js", () => ({
  TASK_TOOLS_DEFAULT_ENABLED: false,
  TASK_TOOLS_ENV_VAR: "WAVE_ENABLE_TASK_TOOLS",
  isTaskToolsEnabled: () => true,
}));

// WebSearch ships switched off (`enableWebSearch` defaults to false). These
// tests are about the deferral shape, so pin the switch on rather than depend
// on the code default.
vi.mock("../../src/services/webSearchAvailability.js", () => ({
  WEB_SEARCH_DEFAULT_ENABLED: true,
  isWebSearchEnabledBySettings: () => true,
  isWebSearchAvailable: () => true,
  markWebSearchUnsupported: () => {},
}));

/**
 * The deferred built-ins, i.e. everything the pool holds with no MCP server
 * connected. Chosen by frequency rather than by size: the ones that come up once
 * in a while and can be discovered by name.
 *
 * This is Claude Code's list, not a wave-specific one: every tool here carries
 * `shouldDefer: true` in 2.1.285, including the plan-mode pair and the four task
 * tools. Deferring them costs one `search` per signature rather than one per call,
 * since the rendered signature stays in the conversation once fetched.
 */
const DEFERRED_BUILTINS = [
  "CronCreate",
  "CronDelete",
  "CronList",
  "EnterPlanMode",
  "EnterWorktree",
  "ExitPlanMode",
  "ExitWorktree",
  "LSP",
  "TaskCreate",
  "TaskGet",
  "TaskList",
  "TaskStop",
  "TaskUpdate",
  "WebFetch",
  "WebSearch",
];

/**
 * Declared flat whatever the pool does: the two entry points that must never be
 * reachable only from inside something else (`REPL` itself, and `AskUserQuestion`,
 * whose whole job is to reach the user), plus the tools `enableReplCoreTools`
 * leaves alone while it is off (its default). The core tools listed here are the
 * cross-platform ones; `Glob` / `Grep` are opt-in and `PowerShell` is gated on the
 * session's shell.
 */
const NATIVE_BUILTINS = [
  "AskUserQuestion",
  "Bash",
  "Edit",
  "Read",
  "Skill",
  "Write",
];

function mcpPlugin(name: string, alwaysLoad = false): ToolPlugin {
  return {
    name,
    alwaysLoad: alwaysLoad ? true : undefined,
    config: {
      type: "function",
      function: {
        name,
        description: `${name} description`,
        parameters: {
          type: "object",
          properties: { input: { type: "string" } },
          required: ["input"],
        },
      },
    } as ChatCompletionFunctionTool,
    execute: async () => ({ success: true, content: "" }),
  };
}

function mcpPlugins(count: number): ToolPlugin[] {
  return Array.from({ length: count }, (_, i) =>
    mcpPlugin(`mcp__srv__tool${i}`),
  );
}

interface HarnessOptions {
  plugins?: ToolPlugin[];
  denied?: string[];
  outputSchemas?: Map<string, Record<string, unknown>>;
  /** `--tools` / `AgentOptions.tools`: the definition-level allow-list. */
  tools?: string[];
}

function build(options: HarnessOptions = {}) {
  const plugins = options.plugins ?? [];
  const denied = new Set(options.denied ?? []);

  const mcpManager = {
    getMcpToolPlugins: () => plugins,
    getMcpToolsConfig: () => plugins.map((plugin) => plugin.config),
    getMcpToolOutputSchemas: () => options.outputSchemas ?? new Map(),
    isMcpTool: (name: string) => name.startsWith("mcp__"),
  } as unknown as McpManager;

  const container = new Container();
  container.register("McpManager", mcpManager);
  container.register("PermissionManager", {
    isToolDenied: (name: string) => denied.has(name),
    getCurrentEffectiveMode: (mode: string | undefined) => mode || "default",
  } as unknown as Record<string, unknown>);

  const toolManager = new ToolManager({ container, tools: options.tools });
  toolManager.initializeBuiltInTools();
  return { toolManager };
}

function names(toolManager: ToolManager): string[] {
  return toolManager.getToolsConfig().map((tool) => tool.function.name);
}

function descriptionOf(toolManager: ToolManager, name: string): string {
  return (
    toolManager.getToolsConfig().find((tool) => tool.function.name === name)
      ?.function.description ?? ""
  );
}

beforeEach(() => {
  gate.execEnabled = true;
  gate.coreToolsEnabled = false;
  gate.nonDeferrable = new Set<string>();
});

describe("which tools are declared flat", () => {
  it("declares REPL even with no MCP server connected", () => {
    // The pool is never empty — the deferred built-ins are always in it — so `REPL`
    // is declared for as long as the feature is on. That is what finally makes
    // `tools[]` independent of the pool: a server connecting no longer moves it.
    const { toolManager } = build();
    expect(names(toolManager)).toContain(REPL_TOOL_NAME);
  });

  it("drops the deferred built-ins from the declarations and keeps the rest", () => {
    const declared = names(build().toolManager);

    for (const name of DEFERRED_BUILTINS) expect(declared).not.toContain(name);
    for (const name of NATIVE_BUILTINS) expect(declared).toContain(name);
  });

  it("keeps a deferred tool reachable from the sandbox instead of just hiding it", () => {
    // Declaring a tool in neither place would be a capability loss rather than a
    // relocation, so the two lists have to partition the same set.
    const { toolManager } = build();
    expect(toolManager.getOnDemandToolNames()).toEqual(
      expect.arrayContaining(DEFERRED_BUILTINS),
    );
  });

  it("never declares an MCP tool flat while it is in the pool", () => {
    const { toolManager } = build({ plugins: mcpPlugins(5) });
    const declared = names(toolManager);

    expect(declared).toContain(REPL_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toEqual([]);
    expect(toolManager.getOnDemandToolNames()).toContain("mcp__srv__tool0");
  });

  it("declares everything flat when REPL itself is denied", () => {
    // Denying REPL must not silently drop the tools it was standing in for.
    const { toolManager } = build({
      plugins: mcpPlugins(5),
      denied: [REPL_TOOL_NAME],
    });
    const declared = names(toolManager);

    expect(declared).not.toContain(REPL_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toHaveLength(5);
    for (const name of DEFERRED_BUILTINS) expect(declared).toContain(name);
  });

  it("leaves every declaration flat when the feature is switched off", () => {
    gate.execEnabled = false;
    const { toolManager } = build({ plugins: mcpPlugins(20) });
    const declared = names(toolManager);

    expect(declared).not.toContain(REPL_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toHaveLength(
      20,
    );
    expect(declared).toContain("WebFetch");
  });

  it("re-evaluates in both directions without rebuilding the manager", () => {
    const plugins = mcpPlugins(2);
    const { toolManager } = build({ plugins });
    expect(names(toolManager)).toContain(REPL_TOOL_NAME);
    expect(toolManager.getOnDemandToolNames()).toContain("mcp__srv__tool0");

    plugins.length = 0; // the last MCP server disconnected
    expect(names(toolManager)).toContain(REPL_TOOL_NAME);
    expect(toolManager.getOnDemandToolNames()).not.toContain("mcp__srv__tool0");
  });

  it("leaves the MCP tools executable through the registry even when undeclared", () => {
    // The pool is a declaration change only: execution keeps routing to the same
    // funnels, which is what makes an in-sandbox call equivalent to a direct one.
    const { toolManager } = build({ plugins: mcpPlugins(5) });
    expect(toolManager.isConcurrencySafe("mcp__srv__tool0")).toBe(false);
  });
});

describe("Poll", () => {
  it("is registered and declared while the REPL is on", () => {
    const { toolManager } = build({ plugins: [] });
    expect(names(toolManager)).toContain("Poll");
  });

  it("is not registered when the REPL is switched off", () => {
    gate.execEnabled = false;
    const { toolManager } = build({ plugins: [] });
    expect(names(toolManager)).not.toContain("Poll");
  });

  it("is never in the pool, even while the pool is non-empty", () => {
    // A pooled tool is reachable only from inside a script, and this is the tool a
    // model calls from outside one to read what those scripts left behind.
    const { toolManager } = build({ plugins: mcpPlugins(3) });
    expect(toolManager.getReplPool().map((entry) => entry.name)).not.toContain(
      "Poll",
    );
  });
});

describe("getReplPool", () => {
  it("holds the deferred built-ins and every MCP tool", () => {
    const { toolManager } = build({ plugins: mcpPlugins(2) });
    const pool = toolManager.getReplPool();

    expect(pool.map((entry) => entry.name)).toEqual(
      expect.arrayContaining([...DEFERRED_BUILTINS, "mcp__srv__tool0"]),
    );
  });

  it("marks MCP entries and carries their declared output schema", () => {
    const outputSchema = {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
    };
    const { toolManager } = build({
      plugins: [mcpPlugin("mcp__srv__lookup")],
      outputSchemas: new Map([["mcp__srv__lookup", outputSchema]]),
    });
    const entry = toolManager
      .getReplPool()
      .find((each) => each.name === "mcp__srv__lookup");

    // `isMcp` is what picks the dispatch funnel at call time, and the output schema
    // is what a search hit renders as its return type.
    expect(entry?.isMcp).toBe(true);
    expect(entry?.outputSchema).toBe(outputSchema);
  });

  it("never holds REPL, which is the pool's own carrier", () => {
    // Otherwise the sandbox could call REPL, i.e. run a script that runs a script.
    expect(
      build({ plugins: mcpPlugins(3) })
        .toolManager.getReplPool()
        .map((entry) => entry.name),
    ).not.toContain(REPL_TOOL_NAME);
  });

  it("keeps denied tools out of the pool", () => {
    const { toolManager } = build({
      plugins: [...mcpPlugins(6), mcpPlugin("mcp__srv__secret")],
      denied: ["mcp__srv__secret", "WebFetch"],
    });
    const pooled = toolManager.getReplPool().map((entry) => entry.name);

    expect(pooled).not.toContain("mcp__srv__secret");
    expect(pooled).not.toContain("WebFetch");
    expect(pooled).toContain("mcp__srv__tool0");
  });

  it("honours the configured non-deferrable list in both directions", () => {
    // The escape hatch for a tool that turns out to be needed every turn: it goes
    // back to a flat declaration without a release.
    gate.nonDeferrable = new Set(["WebFetch", "mcp__srv__tool0"]);
    const { toolManager } = build({ plugins: mcpPlugins(1) });
    const declared = names(toolManager);

    expect(toolManager.getOnDemandToolNames()).toContain("LSP");
    expect(toolManager.getOnDemandToolNames()).not.toContain("WebFetch");
    expect(toolManager.getOnDemandToolNames()).not.toContain("mcp__srv__tool0");
    expect(declared).toContain("WebFetch");
    // An MCP tool exempted from deferral is declared flat, which is the same path a
    // server's own `alwaysLoad` takes.
    expect(declared).toContain("mcp__srv__tool0");
  });

  it("honours an MCP tool's own alwaysLoad, which the plugin carries", () => {
    const { toolManager } = build({
      plugins: [mcpPlugin("mcp__srv__hot", true), mcpPlugin("mcp__srv__cold")],
    });
    const declared = names(toolManager);

    expect(toolManager.getOnDemandToolNames()).not.toContain("mcp__srv__hot");
    // Opting out of deferral puts it back in the flat declarations, which is the
    // whole point of the escape hatch.
    expect(declared).toContain("mcp__srv__hot");
    expect(declared).not.toContain("mcp__srv__cold");
  });

  it("reports no on-demand names while REPL is not declared", () => {
    // `undefined` is what tells the announcement the channel is closed, and a list
    // for an undeclared tool would advertise a way in that does not exist.
    const denied = build({ plugins: mcpPlugins(3), denied: [REPL_TOOL_NAME] });
    expect(denied.toolManager.getOnDemandToolNames()).toBeUndefined();

    gate.execEnabled = false;
    expect(
      build({ plugins: mcpPlugins(3) }).toolManager.getOnDemandToolNames(),
    ).toBeUndefined();
  });

  it("keeps the REPL declaration independent of the pool", () => {
    // The list used to be rendered into this description, which meant every server
    // that connected rewrote `tools[]` and dropped the cached prefix. It is a tail
    // announcement now, so the declaration must not mention a single tool.
    const first = build({ plugins: mcpPlugins(3) });
    const second = build({ plugins: mcpPlugins(9) });

    const description = descriptionOf(first.toolManager, REPL_TOOL_NAME);
    expect(description).not.toContain("mcp__");
    expect(description).toBe(descriptionOf(second.toolManager, REPL_TOOL_NAME));
  });

  it("answers the same thing twice for an unchanged session", () => {
    const { toolManager } = build({ plugins: mcpPlugins(4) });
    expect(toolManager.getReplPool()).toEqual(toolManager.getReplPool());
  });
});

/**
 * `enableReplCoreTools` (spec core/repl-tool.md「开关把核心文件与 shell 工具也收进
 * REPL」): the seven hot tools join the pool and leave `tools[]`. Both halves come
 * from the one call that builds the pool, so the declarations, the announcement and
 * the sandbox cannot disagree about whether `Read` is in there.
 */
describe("core tools pooled by enableReplCoreTools", () => {
  /**
   * The core tools this session actually registered: `Glob` / `Grep` are opt-in and
   * `PowerShell` only exists on a session whose shell it is, so the fixed seven are
   * not the set any single machine holds.
   */
  function registeredCoreTools(toolManager: ToolManager): string[] {
    const registered = toolManager.getTools().map((tool) => tool.name);
    return CORE_POOL_TOOLS.filter((name) => registered.includes(name)).sort();
  }

  it("pools the core tools and takes them out of the flat declarations", () => {
    gate.coreToolsEnabled = true;
    const { toolManager } = build();
    const core = registeredCoreTools(toolManager);

    // The cross-platform half of the seven is enough to prove the switch bites.
    expect(core).toEqual(
      expect.arrayContaining(["Bash", "Edit", "Read", "Write"]),
    );

    const pooled = toolManager.getReplPool();
    expect(
      pooled
        .filter((entry) => entry.tier === "core")
        .map((entry) => entry.name)
        .sort(),
    ).toEqual(core);

    const declared = names(toolManager);
    for (const name of core) expect(declared).not.toContain(name);
    // The carrier stays declared: it is now the only way to those seven.
    expect(declared).toContain(REPL_TOOL_NAME);
    // And they are reachable from the sandbox rather than merely hidden.
    expect(toolManager.getOnDemandToolNames()).toEqual(
      expect.arrayContaining(core),
    );
  });

  it("declares them flat and keeps them out of the pool while the switch is off", () => {
    const { toolManager } = build();
    const core = registeredCoreTools(toolManager);
    const declared = names(toolManager);
    const pooled = toolManager.getReplPool();

    for (const name of core) {
      expect(declared).toContain(name);
      expect(pooled.map((entry) => entry.name)).not.toContain(name);
    }
    // No entry claims the signature tier, so the announcement cannot grow a core
    // block for tools it is already declaring in full.
    expect(pooled.some((entry) => entry.tier === "core")).toBe(false);
  });

  it("puts a core tool back flat when the non-deferrable list names it", () => {
    // The escape hatch has to work inside the switch too: one hot tool can be
    // promoted back without turning the whole feature off.
    gate.coreToolsEnabled = true;
    gate.nonDeferrable = new Set(["Read"]);
    const { toolManager } = build();

    expect(names(toolManager)).toContain("Read");
    expect(toolManager.getOnDemandToolNames()).not.toContain("Read");
    expect(toolManager.getOnDemandToolNames()).toContain("Write");
  });

  it("does nothing while the master switch is off", () => {
    // No sandbox, no pool to put them in: the second switch must not leave a tool
    // declared in neither place.
    gate.execEnabled = false;
    gate.coreToolsEnabled = true;
    const { toolManager } = build();

    expect(toolManager.getOnDemandToolNames()).toBeUndefined();
    expect(names(toolManager)).toContain("Read");
  });
});

/**
 * The carrier answers to `REPL` and to its aliases (`Eval`), and every place that
 * asks "is this the REPL" asks the whole set — a rule or a `--tools` entry naming
 * the old spelling is a statement about this tool.
 */
describe("REPL aliases", () => {
  it("treats a deny rule naming `Eval` as a rule about the carrier", () => {
    const { toolManager } = build({ denied: ["Eval"] });

    expect(names(toolManager)).not.toContain(REPL_TOOL_NAME);
    expect(toolManager.getOnDemandToolNames()).toBeUndefined();
  });

  it("registers the carrier when `--tools` names it by an alias", () => {
    const { toolManager } = build({ tools: ["Eval", "Read"] });

    expect(toolManager.getTools().map((tool) => tool.name)).toContain(
      REPL_TOOL_NAME,
    );
  });

  it("leaves the carrier out when `--tools` names neither spelling", () => {
    const { toolManager } = build({ tools: ["Read"] });

    expect(toolManager.getTools().map((tool) => tool.name)).not.toContain(
      REPL_TOOL_NAME,
    );
  });
});
