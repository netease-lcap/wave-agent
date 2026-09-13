import { describe, it, expect } from "vitest";
import {
  CATALOG_DEFAULT_BUDGET_TOKENS,
  CATALOG_DEGRADED_NOTE,
  CATALOG_DESCRIPTION_MAX_TOKENS,
  RESERVED_BUILTIN_NAMESPACE,
  TOOL_SEARCH_DEFAULT_LIMIT,
  type CatalogTool,
  formatToolAddress,
  renderCatalog,
  renderCatalogEntry,
  renderCatalogHeader,
  renderNamespaceLine,
  renderToolSignature,
  searchCatalog,
} from "../../src/utils/toolCatalog.js";
import { estimateTokens } from "../../src/utils/tokenEstimate.js";

function tool(overrides: Partial<CatalogTool> = {}): CatalogTool {
  return {
    namespace: "probe",
    tool: "query_resource",
    leafName: "mcp__probe__query_resource",
    description: "Query a resource",
    parameters: {
      type: "object",
      required: ["resourceId", "scope"],
      properties: {
        resourceId: { type: "string" },
        scope: { type: "string", enum: ["team", "region"] },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
    },
    ...overrides,
  };
}

/** A pool of `count` synthetic tools spread over the given namespaces. */
function pool(namespaces: string[], count: number): CatalogTool[] {
  const tools: CatalogTool[] = [];
  for (let i = 0; i < count; i++) {
    const namespace = namespaces[i % namespaces.length];
    tools.push(
      tool({
        namespace,
        tool: `tool_${String(i).padStart(3, "0")}`,
        leafName: `mcp__${namespace}__tool_${i}`,
        description: `Synthetic tool number ${i} in namespace ${namespace}`,
      }),
    );
  }
  return tools;
}

describe("toolCatalog: entry notation", () => {
  it("renders `<namespace>.<tool>(签名) // 描述` with namespace and tool independently usable", () => {
    expect(renderCatalogEntry(tool())).toBe(
      'probe.query_resource(resourceId: string, scope: "team"|"region", limit?: integer(min=1,max=200)=50) // Query a resource',
    );
    expect(formatToolAddress(tool())).toBe("probe.query_resource");
  });

  it("keeps descriptions that fit the clip untouched", () => {
    expect(renderCatalogEntry(tool())).toContain("// Query a resource");
  });

  it("marks required parameters explicitly and optional ones with `?`", () => {
    const { text } = renderToolSignature(tool().parameters);
    expect(text).toContain("resourceId: string");
    expect(text).not.toContain("resourceId?:");
    expect(text).toContain("limit?: integer");
  });

  it("lists enum values, never the bare type", () => {
    const { text } = renderToolSignature(tool().parameters);
    expect(text).toContain('scope: "team"|"region"');
  });

  it("renders a tool without parameters as `tool()` and still lists it", () => {
    const entry = renderCatalogEntry(
      tool({ tool: "CronList", leafName: "CronList", parameters: undefined }),
    );
    expect(entry).toBe("probe.CronList() // Query a resource");
  });

  it("renders nested objects up to two levels, then degrades explicitly", () => {
    const shallow = renderToolSignature({
      type: "object",
      properties: {
        filter: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string" },
            tags: { type: "array", items: { type: "string" } },
          },
        },
      },
    });
    expect(shallow.degraded).toBe(false);
    expect(shallow.text).toContain(
      "filter?: {name: string, tags?: array<string>}",
    );

    const deep = renderToolSignature({
      type: "object",
      properties: {
        a: {
          type: "object",
          properties: {
            b: {
              type: "object",
              properties: {
                c: {
                  type: "object",
                  properties: { d: { type: "string" } },
                },
              },
            },
          },
        },
      },
    });
    expect(deep.degraded).toBe(true);
    expect(deep.text).toContain("...");
  });

  it("keeps required and enum information when a signature degrades", () => {
    const entry = renderCatalogEntry(
      tool({
        parameters: {
          type: "object",
          required: ["owner"],
          properties: {
            owner: { type: "string" },
            mode: { type: "string", enum: ["fast", "slow"] },
            deep: {
              type: "object",
              properties: {
                a: {
                  type: "object",
                  properties: {
                    b: {
                      type: "object",
                      properties: { c: { type: "string" } },
                    },
                  },
                },
              },
            },
          },
        },
      }),
    );
    expect(entry).toContain("owner: string");
    expect(entry).toContain('mode?: "fast"|"slow"');
    expect(entry).toContain(CATALOG_DEGRADED_NOTE);
  });

  it("clips long descriptions by token, not by character count", () => {
    const zh = "这是一个很长的中文工具描述用于测试按 token 裁剪的行为".repeat(
      20,
    );
    const en =
      "This is a long English tool description used to test token clipping behaviour".repeat(
        40,
      );
    expect(zh.length).toBeGreaterThan(CATALOG_DESCRIPTION_MAX_TOKENS);
    expect(en.length).toBeGreaterThan(CATALOG_DESCRIPTION_MAX_TOKENS);
    const zhClipped = renderCatalogEntry(tool({ description: zh }));
    const enClipped = renderCatalogEntry(tool({ description: en }));
    const zhDesc = zhClipped.split(" // ")[1];
    const enDesc = enClipped.split(" // ")[1];
    expect(zhDesc.endsWith("…")).toBe(true);
    expect(enDesc.endsWith("…")).toBe(true);
    // Same token cap ⇒ very different character counts for CJK vs English.
    expect(zhDesc.length).toBeLessThan(enDesc.length);
    expect(estimateTokens(zhDesc)).toBeLessThanOrEqual(
      CATALOG_DESCRIPTION_MAX_TOKENS + 1,
    );
    expect(estimateTokens(enDesc)).toBeLessThanOrEqual(
      CATALOG_DESCRIPTION_MAX_TOKENS + 1,
    );
  });
});

describe("toolCatalog: determinism", () => {
  it("renders byte-identical text for the same pool, in any input order", () => {
    const tools = pool(["github", RESERVED_BUILTIN_NAMESPACE, "slack"], 12);
    const first = renderCatalog(tools);
    const second = renderCatalog([...tools].reverse());
    const third = renderCatalog([...tools].sort(() => 1));
    expect(second.text).toBe(first.text);
    expect(third.text).toBe(first.text);
  });

  it("sorts by namespace then tool name regardless of pool order", () => {
    const result = renderCatalog([
      tool({ namespace: "zeta", tool: "a", leafName: "z1", parameters: {} }),
      tool({ namespace: "alpha", tool: "b", leafName: "a1", parameters: {} }),
    ]);
    expect(result.text.indexOf("alpha: 1 tools")).toBeLessThan(
      result.text.indexOf("zeta: 1 tools"),
    );
  });

  it("does not depend on call history (same pool, repeated renders)", () => {
    const tools = pool(["probe"], 60);
    const a = renderCatalog(tools);
    const b = renderCatalog(tools);
    expect(a.complete).toBe(b.complete);
    expect(a.tokens).toBe(b.tokens);
  });
});

describe("toolCatalog: completeness header", () => {
  it("uses the fixed COMPLETE text when nothing was truncated", () => {
    expect(renderCatalogHeader(30, 30)).toBe("COMPLETE — all 30 tools shown");
    const result = renderCatalog(pool(["probe"], 5));
    expect(result.complete).toBe(true);
    expect(result.text).toContain("COMPLETE — all 5 tools shown");
  });

  it("uses the fixed PARTIAL text plus a ToolSearch pointer, without the budget", () => {
    expect(renderCatalogHeader(12, 30)).toBe(
      "PARTIAL — 12 of 30 tools shown\nNot shown: 18 tools — call ToolSearch to find them.",
    );
    const result = renderCatalog(pool(["probe"], 400), {
      budgetTokens: 500,
    });
    expect(result.complete).toBe(false);
    expect(result.text).toContain(
      `PARTIAL — ${result.shownTools} of 400 tools shown`,
    );
    expect(result.text).toContain(
      `Not shown: ${400 - result.shownTools} tools — call ToolSearch to find them.`,
    );
    expect(result.text).not.toContain("budget");
    expect(result.text).not.toContain("500");
  });

  it("keeps every namespace representative line even when its tools are truncated", () => {
    const result = renderCatalog(pool(["alpha", "beta", "gamma"], 300), {
      budgetTokens: 900,
    });
    expect(result.complete).toBe(false);
    for (const namespace of ["alpha", "beta", "gamma"]) {
      expect(result.text).toContain(renderNamespaceLine(namespace, 100));
    }
    expect(result.namespaces).toEqual(["alpha", "beta", "gamma"]);
  });

  it("stays within the budget and hands entries out round-robin", () => {
    const result = renderCatalog(pool(["alpha", "beta"], 200), {
      budgetTokens: 900,
    });
    expect(result.complete).toBe(false);
    expect(result.tokens).toBeLessThanOrEqual(900);
    const perNamespace = ["alpha", "beta"].map(
      (namespace) =>
        result.text
          .split("\n")
          .filter((line) => line.startsWith(`${namespace}.`)).length,
    );
    // Round-robin: neither namespace may starve the other.
    expect(perNamespace[0]).toBeGreaterThan(0);
    expect(perNamespace[1]).toBeGreaterThan(0);
    expect(Math.abs(perNamespace[0] - perNamespace[1])).toBeLessThanOrEqual(1);
  });

  it("renders entries grouped under their namespace representative line", () => {
    const result = renderCatalog(pool(["alpha", "beta"], 4), {
      budgetTokens: 4000,
    });
    const lines = result.text.split("\n");
    const alphaHeader = lines.indexOf("alpha: 2 tools");
    expect(alphaHeader).toBeGreaterThan(-1);
    expect(lines[alphaHeader + 1].startsWith("alpha.")).toBe(true);
    expect(lines[alphaHeader + 2].startsWith("alpha.")).toBe(true);
    const betaHeader = lines.indexOf("beta: 2 tools");
    expect(betaHeader).toBeGreaterThan(alphaHeader);
    expect(lines[betaHeader + 1].startsWith("beta.")).toBe(true);
  });

  it("exposes the spec default budget", () => {
    expect(CATALOG_DEFAULT_BUDGET_TOKENS).toBe(6000);
  });
});

describe("toolCatalog: search", () => {
  it("matches namespace, tool name, description and parameter names", () => {
    const tools = [
      tool({
        namespace: "github",
        tool: "create_issue",
        leafName: "mcp__github__create_issue",
        description: "Open a new issue",
        parameters: {
          type: "object",
          properties: { milestone: { type: "string" } },
        },
      }),
      tool({
        namespace: "slack",
        tool: "post_message",
        leafName: "mcp__slack__post_message",
        description: "Send a chat message",
        parameters: {
          type: "object",
          properties: { channel: { type: "string" } },
        },
      }),
    ];
    expect(searchCatalog(tools, { query: "ISSUE" }).text).toContain(
      "github.create_issue",
    );
    expect(searchCatalog(tools, { query: "slack" }).text).toContain(
      "slack.post_message",
    );
    expect(searchCatalog(tools, { query: "chat message" }).text).toContain(
      "slack.post_message",
    );
    expect(searchCatalog(tools, { query: "milestone" }).text).toContain(
      "github.create_issue",
    );
  });

  it("returns entries in the same notation as the resident catalog", () => {
    const tools = [tool()];
    const found = searchCatalog(tools, { query: "query_resource" });
    expect(found.text).toContain(renderCatalogEntry(tools[0]));
  });

  it("bounds the result and reports `X of Y` with the next offset", () => {
    const tools = pool(["probe"], 25);
    const first = searchCatalog(tools, { query: "synthetic" });
    expect(first.returned).toBe(TOOL_SEARCH_DEFAULT_LIMIT);
    expect(first.totalMatches).toBe(25);
    expect(first.nextOffset).toBe(TOOL_SEARCH_DEFAULT_LIMIT);
    expect(first.text).toContain(`${TOOL_SEARCH_DEFAULT_LIMIT} of 25`);
    expect(first.text).toContain(`offset=${TOOL_SEARCH_DEFAULT_LIMIT}`);

    const last = searchCatalog(tools, {
      query: "synthetic",
      offset: 20,
    });
    expect(last.returned).toBe(5);
    expect(last.nextOffset).toBeUndefined();
    expect(last.text).not.toContain("More matches");
  });

  it("honours an explicit limit", () => {
    const tools = pool(["probe"], 25);
    const result = searchCatalog(tools, { query: "synthetic", limit: 3 });
    expect(result.returned).toBe(3);
  });

  it("says so explicitly when nothing matches", () => {
    const result = searchCatalog(pool(["probe"], 5), { query: "no-such-tool" });
    expect(result.totalMatches).toBe(0);
    expect(result.text).toContain("No tools matched");
    expect(result.text).toContain("shorter or more general keyword");
  });

  it("treats an empty query as no match instead of returning the whole catalog", () => {
    const result = searchCatalog(pool(["probe"], 5), { query: "   " });
    expect(result.totalMatches).toBe(0);
    expect(result.returned).toBe(0);
  });

  it("keeps the explicit-degradation note in search results", () => {
    const deep = tool({
      parameters: {
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
      },
    });
    const result = searchCatalog([deep], { query: "query_resource" });
    expect(result.text).toContain(CATALOG_DEGRADED_NOTE);
  });
});
