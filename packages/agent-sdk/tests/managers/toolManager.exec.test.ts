import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatCompletionFunctionTool } from "openai/resources.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { EXEC_TOOL_NAME } from "../../src/constants/tools.js";
import { Container } from "../../src/utils/container.js";
import type { ToolPlugin } from "../../src/tools/types.js";

const gate = vi.hoisted(() => ({
  execEnabled: true,
  nonDeferrable: new Set<string>(),
}));

vi.mock("../../src/services/execAvailability.js", () => ({
  EXEC_DEFAULT_ENABLED: true,
  isExecEnabled: () => gate.execEnabled,
  getNonDeferrableBuiltins: () => gate.nonDeferrable,
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
];

/**
 * Declared flat whatever the pool does: the core loop the model runs on, and the
 * two entry points that must never be reachable only from inside something else
 * (`Exec` itself, and `AskUserQuestion`, whose whole job is to reach the user).
 */
const NATIVE_BUILTINS = [
  "AskUserQuestion",
  "Bash",
  "Edit",
  "Glob",
  "Grep",
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

  const toolManager = new ToolManager({ container });
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
  gate.nonDeferrable = new Set<string>();
});

describe("which tools are declared flat", () => {
  it("declares Exec even with no MCP server connected", () => {
    // The pool is never empty — the deferred built-ins are always in it — so `Exec`
    // is declared for as long as the feature is on. That is what finally makes
    // `tools[]` independent of the pool: a server connecting no longer moves it.
    const { toolManager } = build();
    expect(names(toolManager)).toContain(EXEC_TOOL_NAME);
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

    expect(declared).toContain(EXEC_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toEqual([]);
    expect(toolManager.getOnDemandToolNames()).toContain("mcp__srv__tool0");
  });

  it("declares everything flat when Exec itself is denied", () => {
    // Denying Exec must not silently drop the tools it was standing in for.
    const { toolManager } = build({
      plugins: mcpPlugins(5),
      denied: [EXEC_TOOL_NAME],
    });
    const declared = names(toolManager);

    expect(declared).not.toContain(EXEC_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toHaveLength(5);
    for (const name of DEFERRED_BUILTINS) expect(declared).toContain(name);
  });

  it("leaves every declaration flat when the feature is switched off", () => {
    gate.execEnabled = false;
    const { toolManager } = build({ plugins: mcpPlugins(20) });
    const declared = names(toolManager);

    expect(declared).not.toContain(EXEC_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toHaveLength(
      20,
    );
    expect(declared).toContain("WebFetch");
  });

  it("re-evaluates in both directions without rebuilding the manager", () => {
    const plugins = mcpPlugins(2);
    const { toolManager } = build({ plugins });
    expect(names(toolManager)).toContain(EXEC_TOOL_NAME);
    expect(toolManager.getOnDemandToolNames()).toContain("mcp__srv__tool0");

    plugins.length = 0; // the last MCP server disconnected
    expect(names(toolManager)).toContain(EXEC_TOOL_NAME);
    expect(toolManager.getOnDemandToolNames()).not.toContain("mcp__srv__tool0");
  });

  it("leaves the MCP tools executable through the registry even when undeclared", () => {
    // The pool is a declaration change only: execution keeps routing to the same
    // funnels, which is what makes an in-sandbox call equivalent to a direct one.
    const { toolManager } = build({ plugins: mcpPlugins(5) });
    expect(toolManager.isConcurrencySafe("mcp__srv__tool0")).toBe(false);
  });
});

describe("getExecPool", () => {
  it("holds the deferred built-ins and every MCP tool", () => {
    const { toolManager } = build({ plugins: mcpPlugins(2) });
    const pool = toolManager.getExecPool();

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
      .getExecPool()
      .find((each) => each.name === "mcp__srv__lookup");

    // `isMcp` is what picks the dispatch funnel at call time, and the output schema
    // is what a search hit renders as its return type.
    expect(entry?.isMcp).toBe(true);
    expect(entry?.outputSchema).toBe(outputSchema);
  });

  it("never holds Exec, which is the pool's own carrier", () => {
    // Otherwise the sandbox could call Exec, i.e. run a script that runs a script.
    expect(
      build({ plugins: mcpPlugins(3) })
        .toolManager.getExecPool()
        .map((entry) => entry.name),
    ).not.toContain(EXEC_TOOL_NAME);
  });

  it("keeps denied tools out of the pool", () => {
    const { toolManager } = build({
      plugins: [...mcpPlugins(6), mcpPlugin("mcp__srv__secret")],
      denied: ["mcp__srv__secret", "WebFetch"],
    });
    const pooled = toolManager.getExecPool().map((entry) => entry.name);

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

  it("reports no on-demand names while Exec is not declared", () => {
    // `undefined` is what tells the announcement the channel is closed, and a list
    // for an undeclared tool would advertise a way in that does not exist.
    const denied = build({ plugins: mcpPlugins(3), denied: [EXEC_TOOL_NAME] });
    expect(denied.toolManager.getOnDemandToolNames()).toBeUndefined();

    gate.execEnabled = false;
    expect(
      build({ plugins: mcpPlugins(3) }).toolManager.getOnDemandToolNames(),
    ).toBeUndefined();
  });

  it("keeps the Exec declaration independent of the pool", () => {
    // The list used to be rendered into this description, which meant every server
    // that connected rewrote `tools[]` and dropped the cached prefix. It is a tail
    // announcement now, so the declaration must not mention a single tool.
    const first = build({ plugins: mcpPlugins(3) });
    const second = build({ plugins: mcpPlugins(9) });

    const description = descriptionOf(first.toolManager, EXEC_TOOL_NAME);
    expect(description).not.toContain("mcp__");
    expect(description).toBe(descriptionOf(second.toolManager, EXEC_TOOL_NAME));
  });

  it("answers the same thing twice for an unchanged session", () => {
    const { toolManager } = build({ plugins: mcpPlugins(4) });
    expect(toolManager.getExecPool()).toEqual(toolManager.getExecPool());
  });
});
