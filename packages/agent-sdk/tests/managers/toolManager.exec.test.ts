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
}

function build(options: HarnessOptions = {}) {
  const pool = options.pool ?? [];
  const denied = new Set(options.denied ?? []);

  const mcpManager = {
    getMcpToolsConfig: () => pool,
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
});

describe("MCP pool collapse", () => {
  it("declares Exec and drops every flat MCP declaration once the pool clears the threshold", () => {
    const { toolManager } = build({ pool: mcpPool(5) });
    const declared = names(toolManager);

    expect(declared).toContain(EXEC_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toEqual([]);
  });

  it("falls back to flat declarations when the pool is below the threshold", () => {
    const { toolManager } = build({ pool: mcpPool(4) });
    const declared = names(toolManager);

    expect(declared).not.toContain(EXEC_TOOL_NAME);
    expect(declared.filter((name) => name.startsWith("mcp__"))).toHaveLength(4);
  });

  it("tracks the threshold in both directions", () => {
    expect(names(build({ pool: mcpPool(4) }).toolManager)).not.toContain(
      EXEC_TOOL_NAME,
    );
    expect(names(build({ pool: mcpPool(6) }).toolManager)).toContain(
      EXEC_TOOL_NAME,
    );
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
    const description = descriptionOf(toolManager, EXEC_TOOL_NAME);

    for (let i = 0; i < 8; i++) {
      expect(description).toContain(`tools.mcp__srv__tool${i}`);
    }
    // Nothing was truncated, so the catalog is the whole pool.
    expect(description).not.toContain("PARTIAL");
  });

  it("keeps denied MCP tools out of the catalog", () => {
    const { toolManager } = build({
      pool: [...mcpPool(6), mcpConfig("mcp__srv__secret")],
      denied: ["mcp__srv__secret"],
    });

    const description = descriptionOf(toolManager, EXEC_TOOL_NAME);
    expect(description).not.toContain("mcp__srv__secret");
    expect(description).toContain("tools.mcp__srv__tool0");
    expect(description).not.toContain("PARTIAL");
  });

  it("announces truncation instead of dropping tools silently", () => {
    const many = Array.from({ length: 2_000 }, (_, i) =>
      mcpConfig(`mcp__srv__tool_${i}`, "d".repeat(300)),
    );
    const { toolManager } = build({ pool: many });
    const description = descriptionOf(toolManager, EXEC_TOOL_NAME);

    expect(description).toMatch(/PARTIAL — \d+ of 2000 tools shown/);
    expect(description).toContain("search");
    // The budget is a knob; it must not be rendered, or tuning it would change
    // model-visible text for an unchanged pool. Assert on the budget-denoting
    // form rather than on the bare number: this fixture's pool happens to be as
    // large as the default budget, so a bare "2000" is a legitimate pool size.
    expect(description).not.toMatch(
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
    const description = descriptionOf(toolManager, EXEC_TOOL_NAME);

    expect(estimateTokens(description)).toBeLessThan(
      EXEC_DEFAULT_CATALOG_TOKENS + 500,
    );
  });
});
