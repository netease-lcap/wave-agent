import { describe, it, expect, vi } from "vitest";
import type { ChatCompletionFunctionTool } from "openai/resources.js";
import { execTool } from "../../src/tools/execTool.js";
import { EXEC_TOOL_NAME } from "../../src/constants/tools.js";
import { EXEC_SEARCH_NAME } from "../../src/exec/constants.js";
import type { ExecPoolEntry } from "../../src/exec/catalog.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import type { ToolContext } from "../../src/tools/types.js";

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
    /** Which tools the manager's pool leaves out, standing in for a denial. */
    denied?: (name: string) => boolean;
    execute?: ReturnType<typeof vi.fn>;
    onShortResultUpdate?: (shortResult: string) => void;
  } = {},
): ToolContext {
  const executeMcpTool =
    options.execute ??
    vi.fn(async (name: string) => ({
      success: true,
      content: `ok:${name}`,
      output: `ok:${name}`,
    }));

  // The pool is the manager's answer, not something Exec derives from the MCP
  // manager: who is deferred (and who is denied) is decided in one place
  // (`ToolManager.getExecPool`), and this double stands in for its verdict.
  const pool: ExecPoolEntry[] = configs
    .filter((config) => !options.denied?.(config.function.name))
    .map((config) => ({
      name: config.function.name,
      isMcp: true,
      description: config.function.description,
    }));

  return {
    workdir: "/tmp",
    mcpManager: {
      executeMcpTool,
    } as unknown as McpManager,
    toolManager: {
      getExecPool: () => pool,
    } as unknown as ToolContext["toolManager"],
    ...(options.onShortResultUpdate
      ? { onShortResultUpdate: options.onShortResultUpdate }
      : {}),
  } as unknown as ToolContext;
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
    const description = execTool.prompt!()!;
    expect(description).toContain(`tools.${EXEC_SEARCH_NAME}(`);
    // The execution budgets live in constants.ts and must stay out of
    // model-visible text: the description is byte-frozen for any pool, and a
    // number here would invite the model to reason about the limit instead of
    // about the script. (The only digits it may contain are a word count like
    // "5-10".)
    expect(description).not.toMatch(/\b\d{3,}\b/);
  });

  it("is the same text the tool manager declares", () => {
    expect(execTool.prompt!()).toBe(execTool.config.function.description);
  });

  it("renders no pool, no tool name and no truncation notice", () => {
    // The description has to be byte-identical for every pool: `tools[]` is inside
    // the cached prefix, so a server connecting would otherwise drop the whole
    // prefix. The pool is a tail announcement instead
    // (`tests/exec/catalogAnnouncement.test.ts`).
    const description = execTool.prompt!()!;
    expect(description).not.toContain("mcp__");
    expect(description).not.toContain("PARTIAL");
    expect(description).not.toContain("tools.mcp__");
  });

  it("names the search entry point without teaching its call form", () => {
    // The call shape belongs to `search`'s own schema — that is the one place the
    // model reads the parameters from, and a second copy here could drift from it.
    const description = execTool.prompt!()!;
    expect(description).not.toContain("query");
    expect(description).not.toContain("max_results");
  });

  it("guides the model to describe the script, like Bash does", () => {
    // The parameter slot shows the description, so the description has to be
    // asked for. Same sentence as the Bash tool's, with the subject swapped.
    expect(execTool.prompt!()!).toContain(
      "It is very helpful if you write a clear, concise description of what this script does in 5-10 words.",
    );
  });

  it("takes an optional description alongside the required code", () => {
    const parameters = execTool.config.function.parameters as {
      properties: Record<string, { type: string; description?: string }>;
      required: string[];
    };

    expect(parameters.properties.code.type).toBe("string");
    expect(parameters.properties.description).toMatchObject({
      type: "string",
      description:
        "Clear, concise description of what this script does in 5-10 words.",
    });
    // Optional: the script runs with or without it.
    expect(parameters.required).toEqual(["code"]);
  });

  it("previews the description in the collapsed row", () => {
    expect(execTool.formatCompactParams).toBeTypeOf("function");
  });
});

describe("execTool compact params", () => {
  /** The hook takes a context; the description must not be read from it. */
  function preview(params: Record<string, unknown>): string {
    return execTool.formatCompactParams!(params, {} as unknown as ToolContext);
  }

  it("returns the model's description verbatim", () => {
    // No prefix, no rewrite, no truncation — the row already prints `Exec`.
    expect(
      preview({
        code: "return await tools.mcp__srv__a({});",
        description: "Search the web for today's news",
      }),
    ).toBe("Search the web for today's news");
  });

  it("returns nothing without a description", () => {
    // Unlike Bash there is no fallback (`command` has no script equivalent), and
    // the first line of a multi-line blob usually says nothing — so the slot
    // stays blank instead of inventing text.
    expect(preview({ code: `await tools.mcp__srv__a({});` })).toBe("");
  });

  it("returns nothing for an empty or non-string description", () => {
    expect(preview({ code: "return 1;", description: "" })).toBe("");
    expect(preview({ code: "return 1;", description: 42 })).toBe("");
    expect(preview({ code: "return 1;", description: null })).toBe("");
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

  it("reports a missing tool manager instead of throwing", async () => {
    const result = await execTool.execute({ code: "return 1;" }, {
      workdir: "/tmp",
    } as unknown as ToolContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain("tool manager is not available");
  });

  it("runs a script against the pool and formats the outcome", async () => {
    const execute = vi.fn(async (name: string) => ({
      success: true,
      content: `ok:${name}`,
      output: `ok:${name}`,
    }));
    const context = contextWith([mcpConfig("mcp__srv__a")], { execute });

    const result = await execTool.execute(
      {
        code: `
          console.log("step 1");
          const r = await tools.mcp__srv__a({ input: "hi" });
          return { got: r };
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

  it("records every nested call by name, in order, repeats kept", async () => {
    // A deferred tool leaves no block of its own, so this record is the only
    // trace of the call a host-side judgment can read (spec: 记录并展示实际的内层调用).
    const context = contextWith([
      mcpConfig("mcp__srv__a"),
      mcpConfig("mcp__srv__b"),
    ]);

    const result = await execTool.execute(
      {
        code: `
          await tools.mcp__srv__a({ input: "1" });
          await tools.mcp__srv__b({ input: "2" });
          await tools.mcp__srv__a({ input: "3" });
          return 1;
        `,
      },
      context,
    );

    expect(result.nestedToolCalls).toEqual([
      "mcp__srv__a",
      "mcp__srv__b",
      "mcp__srv__a",
    ]);
  });

  it("omits the record when the script called nothing", async () => {
    const result = await execTool.execute(
      { code: "return 1;" },
      contextWith([mcpConfig("mcp__srv__a")]),
    );

    expect(result.nestedToolCalls).toBeUndefined();
  });

  it("keeps the record when the script fails after calling", async () => {
    // A call that happened still happened, failure or not.
    const context = contextWith([mcpConfig("mcp__srv__a")]);
    const result = await execTool.execute(
      {
        code: `await tools.mcp__srv__a({ input: "1" }); throw new Error("boom");`,
      },
      context,
    );

    expect(result.success).toBe(false);
    expect(result.nestedToolCalls).toEqual(["mcp__srv__a"]);
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
      return { success: true, content: `ok:${name}`, output: `ok:${name}` };
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

  it("reaches exactly what the manager's pool offers and nothing else", async () => {
    // A denied tool is absent from the pool rather than rejected at call time —
    // the same shape a deferred or simply undiscovered tool has inside the
    // sandbox, so there is no "off the list but still callable" state.
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
        output: "screenshot",
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
