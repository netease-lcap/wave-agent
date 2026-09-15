import { describe, it, expect } from "vitest";
import type { ChatCompletionFunctionTool } from "openai/resources.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
import {
  buildExecPool,
  renderCatalog,
  renderCatalogEntry,
} from "../../src/exec/catalog.js";
import { EXEC_RESERVED_NAMESPACE } from "../../src/exec/constants.js";

function tool(
  name: string,
  description?: string,
  parameters?: Record<string, unknown>,
): ChatCompletionFunctionTool {
  return { type: "function", function: { name, description, parameters } };
}

function mcpManagerOf(configs: ChatCompletionFunctionTool[]): McpManager {
  return {
    getMcpToolsConfig: () => configs,
  } as unknown as McpManager;
}

/** Catalog lines that begin an entry (a multi-line block starts with `tools.`). */
const entryLines = (text: string) =>
  text.split("\n").filter((line) => line.startsWith("tools."));

/** A tool whose pretty signature is a six-line block (25 estimated tokens at the
 * eleven-character name `mcp__srv__a`). */
const blockEntry = (name: string) => ({
  name,
  inputSchema: {
    type: "object",
    properties: {
      cmd: { type: "string", description: "the command" },
      cwd: { type: "string", description: "working dir" },
    },
    required: ["cmd"],
  },
});

describe("buildExecPool", () => {
  it("maps the very configs that would be declared flat", () => {
    const config = tool("mcp__srv__run", "Run it (MCP: srv)", {
      type: "object",
      properties: { cmd: { type: "string" } },
      required: ["cmd"],
    });
    const pool = buildExecPool(mcpManagerOf([config]));

    expect(pool).toEqual([
      {
        name: "mcp__srv__run",
        description: "Run it (MCP: srv)",
        inputSchema: config.function.parameters,
      },
    ]);
  });

  it("drops tools denied by permission rules, exactly like the declaration path", () => {
    const permissionManager = {
      isToolDenied: (name: string) => name === "mcp__srv__secret",
    } as unknown as PermissionManager;

    const pool = buildExecPool(
      mcpManagerOf([
        tool("mcp__srv__safe"),
        tool("mcp__srv__secret"),
        tool("mcp__other__safe"),
      ]),
      permissionManager,
    );

    expect(pool.map((entry) => entry.name)).toEqual([
      "mcp__srv__safe",
      "mcp__other__safe",
    ]);
  });

  it("tolerates a tool with no schema", () => {
    const pool = buildExecPool(mcpManagerOf([tool("mcp__srv__ping")]));
    expect(pool[0].inputSchema).toBeUndefined();
  });
});

describe("renderCatalogEntry", () => {
  it("renders identifier-safe names as property access", () => {
    const line = renderCatalogEntry({
      name: "mcp__srv__run",
      description: "Run a command\nSecond line is dropped",
      inputSchema: {
        type: "object",
        properties: { cmd: { type: "string" }, cwd: { type: "string" } },
        required: ["cmd"],
      },
    });

    expect(line).toBe(
      [
        "tools.mcp__srv__run({",
        "  cmd: string,",
        "  cwd?: string,",
        "}) // Run a command",
      ].join("\n"),
    );
    // Only the first line of the tool description reaches the catalog.
    expect(line).not.toContain("Second line");
  });

  it("falls back to bracket access when the name is not a valid identifier", () => {
    const line = renderCatalogEntry({ name: "mcp__my-srv__x" });
    expect(line).toBe('tools["mcp__my-srv__x"](any)');
  });

  it("renders enum, array and union types", () => {
    expect(
      renderCatalogEntry({
        name: "a",
        inputSchema: {
          type: "object",
          properties: { mode: { enum: ["fast", "slow"] } },
        },
      }),
    ).toBe(["tools.a({", '  mode?: "fast" | "slow",', "})"].join("\n"));

    expect(
      renderCatalogEntry({
        name: "b",
        inputSchema: {
          type: "object",
          properties: { items: { type: "array", items: { type: "string" } } },
        },
      }),
    ).toBe(["tools.b({", "  items?: Array<string>,", "})"].join("\n"));

    expect(
      renderCatalogEntry({
        name: "c",
        inputSchema: { anyOf: [{ type: "string" }, { type: "number" }] },
      }),
    ).toBe("tools.c(string | number)");
  });

  it("caps deep and wide schemas instead of unbounded expansion", () => {
    const nested = {
      type: "object",
      properties: {
        a: {
          type: "object",
          properties: {
            b: {
              type: "object",
              properties: {
                c: { type: "object", properties: { d: { type: "string" } } },
              },
            },
          },
        },
      },
    };
    // Recursion stops at MAX_SIGNATURE_DEPTH, so the innermost level degrades
    // to `any` instead of expanding forever.
    expect(renderCatalogEntry({ name: "d", inputSchema: nested })).toBe(
      [
        "tools.d({",
        "  a?: {",
        "    b?: {",
        "      c?: {",
        "        d?: any,",
        "      },",
        "    },",
        "  },",
        "})",
      ].join("\n"),
    );

    const wide = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`p${i}`, { type: "string" }]),
      ),
    };
    const line = renderCatalogEntry({ name: "e", inputSchema: wide });
    expect(line).toContain("  p7?: string,");
    expect(line).not.toContain("p8");
    // The overflow marker is a bare `...` line, not a property.
    expect(line).toContain("\n  ...\n");
  });

  it("renders per-field JSDoc for descriptions, defaults and constraints", () => {
    const line = renderCatalogEntry({
      name: "g",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string", description: "Repository owner" },
          perPage: {
            type: "number",
            description: "Results per page",
            default: 30,
          },
          labels: {
            type: "array",
            items: { type: "string" },
            description: "Filter by labels",
            minItems: 1,
            maxItems: 10,
          },
          home: { type: "string", format: "uri" },
          legacy: { type: "string", deprecated: true },
          plain: { type: "boolean" },
        },
      },
    });

    expect(line).toBe(
      [
        "tools.g({",
        "  /** Repository owner */",
        "  owner?: string,",
        "  /**",
        "   * Results per page",
        "   * @default 30",
        "   */",
        "  perPage?: number,",
        "  /**",
        "   * Filter by labels",
        "   * @minItems 1",
        "   * @maxItems 10",
        "   */",
        "  labels?: Array<string>,",
        "  /** @format uri */",
        "  home?: string,",
        "  /** @deprecated */",
        "  legacy?: string,",
        // No description and no tag -> no comment line at all.
        "  plain?: boolean,",
        "})",
      ].join("\n"),
    );
  });

  it("clamps over-long descriptions to one line of fixed width", () => {
    const line = renderCatalogEntry({
      name: "gl",
      description: `${"t".repeat(200)}\nsecond line`,
      inputSchema: {
        type: "object",
        properties: {
          p: { type: "string", description: `${"d".repeat(200)}\nsecond line` },
        },
      },
    });
    const lines = line.split("\n");

    // 120 characters including the ellipsis, for both the tool description (which
    // trails the block) and a field description.
    expect(lines[1]).toBe(`  /** ${"d".repeat(117)}... */`);
    expect(lines[lines.length - 1]).toBe(`}) // ${"t".repeat(117)}...`);
    expect(line).not.toContain("second line");
  });

  it("emits a tag even when the field has no description", () => {
    const line = renderCatalogEntry({
      name: "gt",
      inputSchema: {
        type: "object",
        properties: { limit: { type: "number", default: 30000 } },
      },
    });
    expect(line).toContain("  /** @default 30000 */\n  limit?: number,");
  });

  it("neutralizes a comment terminator inside a description", () => {
    const line = renderCatalogEntry({
      name: "gs",
      inputSchema: {
        type: "object",
        properties: { note: { type: "string", description: "Ends */ early" } },
      },
    });
    expect(line).toContain("/** Ends * / early */");
    expect(line).not.toContain("Ends */");
  });
});

describe("renderCatalog", () => {
  const entries = [
    { name: "mcp__srv__a", description: "A" },
    { name: "mcp__srv__b", description: "B" },
    { name: "mcp__srv__c", description: "C" },
  ];

  it("renders every entry when the budget allows", () => {
    const rendered = renderCatalog(entries, 10_000);
    expect(rendered.truncated).toBe(false);
    expect(rendered.shown).toBe(3);
    expect(entryLines(rendered.text)).toHaveLength(3);
  });

  it("announces truncation with counts and the search path", () => {
    const rendered = renderCatalog(entries, 2);
    expect(rendered.truncated).toBe(true);
    expect(rendered.shown).toBeLessThan(3);
    expect(rendered.text).toContain(
      `PARTIAL — ${rendered.shown} of 3 tools shown`,
    );
    expect(rendered.text).toContain(
      `tools["${EXEC_RESERVED_NAMESPACE}"].search`,
    );
  });

  it("never leaks the budget number into model-visible text", () => {
    const rendered = renderCatalog(entries, 4096);
    expect(rendered.text).not.toContain("4096");
    expect(rendered.text).not.toContain("token");
  });

  it("shows at least one whole entry even when it alone exceeds the budget", () => {
    const rendered = renderCatalog(entries, 1);
    expect(rendered.shown).toBe(1);
    expect(rendered.text).toContain("tools.mcp__srv__a");
    // The block is placed atomically: its description trailer comes along too.
    expect(rendered.text).toContain("// A");
  });

  it("budgets a whole multi-line entry as one unit", () => {
    const blocks = [
      blockEntry("mcp__srv__a"),
      blockEntry("mcp__srv__b"),
      blockEntry("mcp__srv__c"),
    ];
    // Each block is six lines / 95 chars / 25 estimated tokens, so three of them
    // cost 75 as blocks. Per-line accounting would need 90 and fit only two.
    const exact = renderCatalog(blocks, 75);
    expect(exact.shown).toBe(3);
    expect(exact.truncated).toBe(false);

    const oneLess = renderCatalog(blocks, 74);
    expect(oneLess.shown).toBe(2);
  });

  it("round-robins whole blocks across servers", () => {
    // A block's cost depends on its first line, which carries the tool name, so
    // the three server names are kept the same length to make the budget exact.
    const pooled = [
      blockEntry("mcp__alpha__t1"),
      blockEntry("mcp__alpha__t2"),
      blockEntry("mcp__alpha__t3"),
      blockEntry("mcp__bravo__t1"),
      blockEntry("mcp__bravo__t2"),
      blockEntry("mcp__delta__t1"),
    ];
    // Each block costs 26 tokens, so 78 is room for exactly one round.
    const rendered = renderCatalog(pooled, 78);
    expect(rendered.shown).toBe(3);
    expect(rendered.truncated).toBe(true);

    const order = [
      "tools.mcp__alpha__t1",
      "tools.mcp__bravo__t1",
      "tools.mcp__delta__t1",
    ].map((name) => rendered.text.indexOf(name));
    expect(order[0]).toBeLessThan(order[1]);
    expect(order[1]).toBeLessThan(order[2]);
    expect(rendered.text).not.toContain("mcp__alpha__t2");
  });

  it("gives every server a seat before any server gets a second", () => {
    // A plain first-N cut would show only alpha here and drop beta and gamma
    // entirely, which the model would read as "those tools do not exist".
    const pooled = [
      { name: "mcp__alpha__t1" },
      { name: "mcp__alpha__t2" },
      { name: "mcp__alpha__t3" },
      { name: "mcp__beta__t1" },
      { name: "mcp__beta__t2" },
      { name: "mcp__gamma__t1" },
    ];
    // Room for exactly three lines: one full round of the rotation.
    const rendered = renderCatalog(pooled, 21);
    const lines = rendered.text.split("\n");

    expect(rendered.shown).toBe(3);
    expect(rendered.truncated).toBe(true);
    expect(lines[0]).toContain("tools.mcp__alpha__t1");
    expect(lines[1]).toContain("tools.mcp__beta__t1");
    expect(lines[2]).toContain("tools.mcp__gamma__t1");
    expect(rendered.text).not.toContain("mcp__alpha__t2");
  });

  it("is byte-stable for an unchanged pool", () => {
    expect(renderCatalog(entries, 4096).text).toBe(
      renderCatalog(entries, 4096).text,
    );
  });
});
