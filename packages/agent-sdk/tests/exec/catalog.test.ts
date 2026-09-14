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
      "tools.mcp__srv__run({ cmd: string, cwd?: string }) // Run a command",
    );
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
    ).toBe('tools.a({ mode?: "fast" | "slow" })');

    expect(
      renderCatalogEntry({
        name: "b",
        inputSchema: {
          type: "object",
          properties: { items: { type: "array", items: { type: "string" } } },
        },
      }),
    ).toBe("tools.b({ items?: string[] })");

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
      "tools.d({ a?: { b?: { c?: { d?: any } } } })",
    );

    const wide = {
      type: "object",
      properties: Object.fromEntries(
        Array.from({ length: 10 }, (_, i) => [`p${i}`, { type: "string" }]),
      ),
    };
    const line = renderCatalogEntry({ name: "e", inputSchema: wide });
    expect(line).toContain("p7?: string");
    expect(line).not.toContain("p8?: string");
    expect(line).toContain("...");
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
    expect(rendered.text.split("\n")).toHaveLength(3);
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

  it("shows at least one entry even when it alone exceeds the budget", () => {
    const rendered = renderCatalog(entries, 1);
    expect(rendered.shown).toBe(1);
    expect(rendered.text).toContain("tools.mcp__srv__a");
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
