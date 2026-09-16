import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ChatCompletionFunctionTool } from "openai/resources.js";
import { ToolManager } from "../../src/managers/toolManager.js";
import { McpManager } from "../../src/managers/mcpManager.js";
import { EXEC_TOOL_NAME } from "../../src/constants/tools.js";
import { EXEC_DEFAULT_CATALOG_TOKENS } from "../../src/exec/constants.js";
import { Container } from "../../src/utils/container.js";
import { estimateTokens } from "../../src/utils/tokenEstimate.js";

const gate = vi.hoisted(() => ({ execEnabled: true }));

vi.mock("../../src/services/execAvailability.js", () => ({
  EXEC_DEFAULT_ENABLED: true,
  isExecEnabled: () => gate.execEnabled,
}));

function mcpConfig(name: string, description = `${name} description`) {
  return {
    type: "function",
    function: {
      name,
      description,
      parameters: {
        type: "object",
        properties: { input: { type: "string" } },
        required: ["input"],
      },
    },
  } as ChatCompletionFunctionTool;
}

function mcpPool(count: number): ChatCompletionFunctionTool[] {
  return Array.from({ length: count }, (_, i) =>
    mcpConfig(`mcp__srv__tool${i}`),
  );
}

interface HarnessOptions {
  pool?: ChatCompletionFunctionTool[];
  denied?: string[];
  outputSchemas?: Map<string, Record<string, unknown>>;
}

function build(options: HarnessOptions = {}) {
  const pool = options.pool ?? [];
  const denied = new Set(options.denied ?? []);

  const mcpManager = {
    getMcpToolsConfig: () => pool,
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

/** The catalog the announcement channel reads. */
function catalogText(toolManager: ToolManager): string {
  return toolManager.getExecCatalog()?.text ?? "";
}

beforeEach(() => {
  gate.execEnabled = true;
});

describe("MCP pool collapse", () => {
  it("declares Exec and drops every flat MCP declaration once the pool is non-empty", () => {
    const { toolManager } = build({ pool: mcpPool(5) });
    const declared = names(toolManager);

    expect(declared).toContain(EXEC_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toEqual([]);
  });

  it("collapses a pool of one: there is no minimum tool count", () => {
    // Aligned with opencode, which collapses any non-empty pool. The switch, not
    // a count, decides whether Exec is used.
    const { toolManager } = build({ pool: mcpPool(1) });
    const declared = names(toolManager);

    expect(declared).toContain(EXEC_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toEqual([]);
  });

  it("keeps Exec undeclared while there is nothing to catalog", () => {
    const { toolManager } = build({ pool: mcpPool(0) });
    const declared = names(toolManager);

    expect(declared).not.toContain(EXEC_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toEqual([]);
  });

  it("re-evaluates the collapse in both directions on each assembly", () => {
    const pool = mcpPool(2);
    const { toolManager } = build({ pool });
    expect(names(toolManager)).toContain(EXEC_TOOL_NAME);

    pool.length = 0; // the last MCP server disconnected
    expect(names(toolManager)).not.toContain(EXEC_TOOL_NAME);
  });

  it("falls back to flat declarations when Exec itself is denied", () => {
    // Denying Exec must not silently drop the MCP tools it was standing in for.
    const { toolManager } = build({
      pool: mcpPool(5),
      denied: [EXEC_TOOL_NAME],
    });
    const declared = names(toolManager);

    expect(declared).not.toContain(EXEC_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toHaveLength(5);
  });

  it("does not register Exec at all when the feature is switched off", () => {
    gate.execEnabled = false;
    const { toolManager } = build({ pool: mcpPool(20) });
    const declared = names(toolManager);

    expect(declared).not.toContain(EXEC_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toHaveLength(
      20,
    );
  });

  it("leaves the MCP tools executable through the registry even when undeclared", () => {
    // The collapse is a declaration change only: execution keeps routing to the
    // same MCP funnel, which is what makes an in-sandbox call equivalent to a
    // direct one.
    const { toolManager } = build({ pool: mcpPool(5) });
    expect(toolManager.isConcurrencySafe("mcp__srv__tool0")).toBe(false);
  });
});

describe("Exec catalog content", () => {
  it("renders exactly the pool that was dropped from declarations", () => {
    const { toolManager } = build({ pool: mcpPool(8) });
    const catalog = catalogText(toolManager);

    for (let i = 0; i < 8; i++) {
      expect(catalog).toContain(`tools.mcp__srv__tool${i}`);
    }
    // Nothing was truncated, so the catalog is the whole pool.
    expect(catalog).not.toContain("PARTIAL");
  });

  it("renders each tool's declared output schema as its return type", () => {
    const { toolManager } = build({
      pool: [mcpConfig("mcp__srv__lookup")],
      outputSchemas: new Map([
        [
          "mcp__srv__lookup",
          {
            type: "object",
            properties: { id: { type: "string" } },
            required: ["id"],
          },
        ],
      ]),
    });

    // A tool declaration has no field for an output schema, so it rides beside
    // the pool (see `getMcpToolOutputSchemas`) and lands in the signature.
    expect(catalogText(toolManager)).toContain(
      [
        "tools.mcp__srv__lookup({",
        "  input: string,",
        "}): Promise<{",
        "  id: string,",
        "}>",
      ].join("\n"),
    );
  });

  it("keeps denied MCP tools out of the catalog", () => {
    const { toolManager } = build({
      pool: [...mcpPool(6), mcpConfig("mcp__srv__secret")],
      denied: ["mcp__srv__secret"],
    });

    const catalog = catalogText(toolManager);
    expect(catalog).not.toContain("mcp__srv__secret");
    expect(catalog).toContain("tools.mcp__srv__tool0");
    expect(catalog).not.toContain("PARTIAL");
  });

  it("announces truncation instead of dropping tools silently", () => {
    const many = Array.from({ length: 2_000 }, (_, i) =>
      mcpConfig(`mcp__srv__tool_${i}`, "d".repeat(300)),
    );
    const { toolManager } = build({ pool: many });
    const catalog = catalogText(toolManager);

    expect(catalog).toMatch(/PARTIAL — \d+ of 2000 tools shown/);
    // The budget is a knob; it must not be rendered, or tuning it would change
    // model-visible text for an unchanged pool. Assert on the budget-denoting
    // form rather than on the bare number: this fixture's pool happens to be as
    // large as the default budget, so a bare "2000" is a legitimate pool size.
    expect(catalog).not.toMatch(
      new RegExp(
        `(?:${EXEC_DEFAULT_CATALOG_TOKENS}\\s*(?:tokens?|budget)` +
          `|(?:tokens?|budget)\\s*[:=]?\\s*${EXEC_DEFAULT_CATALOG_TOKENS})`,
        "i",
      ),
    );
  });

  it("stays inside the catalog budget", () => {
    const many = Array.from({ length: 2_000 }, (_, i) =>
      mcpConfig(`mcp__srv__tool_${i}`, "d".repeat(300)),
    );
    const { toolManager } = build({ pool: many });

    expect(estimateTokens(catalogText(toolManager))).toBeLessThan(
      EXEC_DEFAULT_CATALOG_TOKENS + 500,
    );
  });

  it("keeps the Exec declaration independent of the pool", () => {
    // The catalog used to be rendered into this description, which meant every
    // server that connected rewrote `tools[]` and dropped the cached prefix. It is a
    // tail announcement now, so the declaration must not mention a single tool.
    const first = build({ pool: mcpPool(3) });
    const second = build({
      pool: [...mcpPool(9), mcpConfig("mcp__srv__other")],
    });

    const description = descriptionOf(first.toolManager, EXEC_TOOL_NAME);
    expect(description).not.toContain("mcp__");
    expect(description).not.toContain("PARTIAL");
    expect(description).toBe(descriptionOf(second.toolManager, EXEC_TOOL_NAME));
  });

  it("reports no catalog while Exec is not declared", () => {
    // The channel is closed exactly when Exec is: a catalog for an undeclared tool
    // would advertise a way in that does not exist. `undefined` is what tells the
    // announcement to say the catalog no longer applies.
    const denied = build({ pool: mcpPool(3), denied: [EXEC_TOOL_NAME] });
    expect(denied.toolManager.getExecCatalog()).toBeUndefined();

    gate.execEnabled = false;
    const off = build({ pool: mcpPool(3) });
    expect(off.toolManager.getExecCatalog()).toBeUndefined();
  });

  it("reports an empty catalog while Exec is declared over an empty pool", () => {
    // Distinct from "no channel": there is a catalog, and it is empty. That is what
    // the announcement turns into the "nothing available right now" note.
    const { toolManager } = build({ pool: mcpPool(0) });
    const catalog = toolManager.getExecCatalog();

    expect(catalog).toBeDefined();
    expect(catalog?.total).toBe(0);
    expect(catalog?.truncated).toBe(false);
  });
});
