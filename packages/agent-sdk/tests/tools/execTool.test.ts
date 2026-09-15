import { describe, it, expect, vi } from "vitest";
import type { ChatCompletionFunctionTool } from "openai/resources.js";
import { execTool } from "../../src/tools/execTool.js";
import { EXEC_TOOL_NAME } from "../../src/constants/tools.js";
import {
  EXEC_RESERVED_NAMESPACE,
  EXEC_DEFAULT_CATALOG_TOKENS,
} from "../../src/exec/constants.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import type { PermissionManager } from "../../src/managers/permissionManager.js";
import type { ToolContext } from "../../src/tools/types.js";
import type { ExecPoolEntry } from "../../src/exec/catalog.js";

function mcpConfig(
  name: string,
  description?: string,
): ChatCompletionFunctionTool {
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
  };
}

function contextWith(
  configs: ChatCompletionFunctionTool[] = [],
  options: {
    denied?: (name: string) => boolean;
    execute?: ReturnType<typeof vi.fn>;
    onShortResultUpdate?: (shortResult: string) => void;
  } = {},
): ToolContext {
  const executeMcpTool =
    options.execute ??
    vi.fn(async (name: string) => ({ success: true, content: `ok:${name}` }));

  return {
    workdir: "/tmp",
    mcpManager: {
      getMcpToolsConfig: () => configs,
      executeMcpTool,
    } as unknown as McpManager,
    ...(options.denied
      ? {
          permissionManager: {
            isToolDenied: options.denied,
          } as unknown as PermissionManager,
        }
      : {}),
    ...(options.onShortResultUpdate
      ? { onShortResultUpdate: options.onShortResultUpdate }
      : {}),
  } as unknown as ToolContext;
}

function pool(...names: string[]): ExecPoolEntry[] {
  return names.map((name) => ({ name, description: `${name} description` }));
}

/** Matches the catalog budget being spelled out in model-visible text. */
function budgetForm(): RegExp {
  return new RegExp(
    `(?:${EXEC_DEFAULT_CATALOG_TOKENS}\\s*(?:tokens?|budget)` +
      `|(?:tokens?|budget)\\s*[:=]?\\s*${EXEC_DEFAULT_CATALOG_TOKENS})`,
    "i",
  );
}

describe("execTool declaration", () => {
  it("is named Exec and takes a required code string", () => {
    expect(execTool.name).toBe(EXEC_TOOL_NAME);
    expect(execTool.config.function.name).toBe(EXEC_TOOL_NAME);
    expect(execTool.config.function.parameters).toMatchObject({
      type: "object",
      properties: { code: { type: "string" } },
      required: ["code"],
    });
  });

  it("is not concurrency-safe — it reaches arbitrary MCP tools", () => {
    expect(execTool.isConcurrencySafe).toBe(false);
  });

  it("names the sandbox surface without any tunable limit", () => {
    const description = execTool.prompt!({ execPool: pool("mcp__srv__a") })!;
    expect(description).toContain(`tools["${EXEC_RESERVED_NAMESPACE}"].search`);
    // Budgets live in constants.ts and must stay out of model-visible text, or
    // changing one would change the prompt for an unchanged pool. Assert on the
    // budget-denoting form rather than on any bare number: the catalog now
    // renders field-level docs, so legitimate numbers (a field's @default) are
    // expected in the text.
    expect(description).not.toMatch(budgetForm());
  });

  it("documents that an empty query lists the whole pool", () => {
    // The catalog can be truncated, so the model needs an enumeration path that
    // does not depend on guessing a keyword. Both the call form and the field doc
    // come from the schema the host validates against, so the prose cannot teach
    // a shape the host would reject.
    const description = execTool.prompt!({
      execPool: pool("mcp__srv__a"),
    })!;
    expect(description).toContain(
      `tools["${EXEC_RESERVED_NAMESPACE}"].search({`,
    );
    expect(description).toContain("query?: string,");
    expect(description).toMatch(/empty string\) to list the entire pool/);
  });

  it("renders field-level docs from the pool into the description", () => {
    const description = execTool.prompt!({
      execPool: [
        {
          name: "mcp__srv__a",
          description: "A tool",
          inputSchema: {
            type: "object",
            properties: {
              timeout: {
                type: "number",
                description: "how long to wait",
                default: 30000,
              },
            },
            required: [],
          },
        },
      ],
    })!;

    expect(description).toContain(
      [
        "tools.mcp__srv__a({",
        "  /**",
        "   * how long to wait",
        "   * @default 30000",
        "   */",
        "  timeout?: number,",
        "})",
      ].join("\n"),
    );
    // ...and that numeric default is exactly what the bare-number form would
    // have rejected, which is why the assertion above is form-based.
    expect(description).toMatch(/\d{3,}/);
    expect(description).not.toMatch(budgetForm());
  });

  it("renders the catalog for the supplied pool", () => {
    const description = execTool.prompt!({
      execPool: pool("mcp__srv__a", "mcp__srv__b"),
    })!;

    expect(description).toContain("tools.mcp__srv__a");
    expect(description).toContain("tools.mcp__srv__b");
    expect(description).not.toContain("PARTIAL");
  });

  it("is byte-identical for an unchanged pool", () => {
    const first = execTool.prompt!({ execPool: pool("mcp__srv__a") })!;
    const second = execTool.prompt!({ execPool: pool("mcp__srv__a") })!;
    expect(first).toBe(second);
  });

  it("says so when no pool is supplied", () => {
    expect(execTool.prompt!({})).toContain(
      "No MCP tools are currently available",
    );
  });

  it("previews nothing in the collapsed row", () => {
    // The row prints the tool name itself; the script is a multi-line blob whose
    // first line usually says nothing, so there is no compact text at all.
    expect(execTool.formatCompactParams).toBeUndefined();
  });
});

describe("execTool execution", () => {
  it("requires code", async () => {
    const result = await execTool.execute({}, contextWith());
    expect(result.success).toBe(false);
    expect(result.error).toContain(`missing required parameter "code"`);
  });

  it("rejects blank code", async () => {
    const result = await execTool.execute({ code: "   \n " }, contextWith());
    expect(result.success).toBe(false);
    expect(result.error).toContain("missing required parameter");
  });

  it("reports a missing MCP manager instead of throwing", async () => {
    const result = await execTool.execute({ code: "return 1;" }, {
      workdir: "/tmp",
    } as unknown as ToolContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain("MCP manager is not available");
  });

  it("runs a script against the pool and formats the outcome", async () => {
    const execute = vi.fn(async (name: string) => ({
      success: true,
      content: `ok:${name}`,
    }));
    const context = contextWith([mcpConfig("mcp__srv__a")], { execute });

    const result = await execTool.execute(
      {
        code: `
          console.log("step 1");
          const r = await tools.mcp__srv__a({ input: "hi" });
          return { got: r.content };
        `,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("step 1");
    expect(result.content).toContain('{"got":"ok:mcp__srv__a"}');
    expect(result.shortResult).toBe("1 tool call\nmcp__srv__a");
    expect(execute).toHaveBeenCalledWith(
      "mcp__srv__a",
      { input: "hi" },
      context,
    );
  });

  it("lists only the two most recent calls under the count", async () => {
    const context = contextWith(
      ["a", "b", "c"].map((suffix) => mcpConfig(`mcp__srv__${suffix}`)),
    );

    const result = await execTool.execute(
      {
        code: `
          await tools.mcp__srv__a({});
          await tools.mcp__srv__b({});
          await tools.mcp__srv__c({});
        `,
      },
      context,
    );

    expect(result.shortResult).toBe(
      "... 3 tool calls\nmcp__srv__b\nmcp__srv__c",
    );
  });

  it("reports a script that never reaches a tool", async () => {
    const result = await execTool.execute(
      { code: `console.log("nothing to call"); return 1;` },
      contextWith([mcpConfig("mcp__srv__a")]),
    );

    expect(result.shortResult).toBe("0 tool calls");
  });

  it("updates the summary while the script is still running", async () => {
    // Hold both calls open so the summary can be observed mid-run: the live
    // update is the whole point (the row is all the user sees while it runs).
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const execute = vi.fn(async (name: string) => {
      await pending;
      return { success: true, content: `ok:${name}` };
    });
    const updates: string[] = [];
    const context = contextWith(
      [mcpConfig("mcp__srv__a"), mcpConfig("mcp__srv__b")],
      { execute, onShortResultUpdate: (summary) => updates.push(summary) },
    );

    const run = execTool.execute(
      {
        code: `
          await tools.mcp__srv__a({});
          await tools.mcp__srv__b({});
        `,
      },
      context,
    );

    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toBe("1 tool call\nmcp__srv__a");

    release();
    const result = await run;

    expect(updates[updates.length - 1]).toBe(
      "2 tool calls\nmcp__srv__a\nmcp__srv__b",
    );
    expect(result.shortResult).toBe(updates[updates.length - 1]);
  });

  it("excludes denied tools from the pool it exposes to the sandbox", async () => {
    const context = contextWith(
      [mcpConfig("mcp__srv__allowed"), mcpConfig("mcp__srv__denied")],
      { denied: (name) => name === "mcp__srv__denied" },
    );

    const result = await execTool.execute(
      {
        code: `
          try {
            await tools.mcp__srv__denied({});
            return { outcome: "called" };
          } catch (error) {
            return { outcome: error.message };
          }
        `,
      },
      context,
    );

    expect(result.success).toBe(true);
    expect(JSON.parse(result.content).outcome).toContain("mcp__srv__denied");
  });

  it("surfaces a script failure as an unsuccessful result", async () => {
    const result = await execTool.execute(
      { code: `throw new Error("bad script")` },
      contextWith([mcpConfig("mcp__srv__a")]),
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("bad script");
    expect(result.content).toContain("bad script");
    expect(result.shortResult).toBe("failed");
  });

  it("keeps console output produced before a failure", async () => {
    const result = await execTool.execute(
      { code: `console.log("before"); throw new Error("after");` },
      contextWith([mcpConfig("mcp__srv__a")]),
    );

    expect(result.success).toBe(false);
    expect(result.content).toContain("before");
    expect(result.content).toContain("after");
  });

  it("passes images from nested MCP calls through to the tool result", async () => {
    const context = contextWith([mcpConfig("mcp__srv__shot")], {
      execute: vi.fn(async () => ({
        success: true,
        content: "screenshot",
        images: [{ data: "AAAA", mediaType: "image/png" }],
      })),
    });

    const result = await execTool.execute(
      { code: `return await tools.mcp__srv__shot({});` },
      context,
    );

    expect(result.success).toBe(true);
    expect(result.images).toEqual([{ data: "AAAA", mediaType: "image/png" }]);
  });
});
