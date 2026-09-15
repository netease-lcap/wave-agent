import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "../../src/tools/types.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import { runExecScript } from "../../src/exec/execRuntime.js";

interface FakeMcpOptions {
  content?: string;
  images?: Array<{ data: string; mediaType?: string }>;
  /** Resolve/reject per call, keyed by tool name. */
  behavior?: (name: string, args: Record<string, unknown>) => unknown;
}

function contextWith(options: FakeMcpOptions = {}): {
  context: ToolContext;
  executeMcpTool: ReturnType<typeof vi.fn>;
} {
  const executeMcpTool = vi.fn(
    async (name: string, args: Record<string, unknown>) => {
      if (options.behavior) {
        const outcome = options.behavior(name, args);
        if (outcome instanceof Error) throw outcome;
        if (outcome !== undefined) return outcome;
      }
      return { success: true, content: options.content ?? `ok:${name}` };
    },
  );

  const context = {
    workdir: "/tmp",
    mcpManager: {
      executeMcpTool,
      getMcpToolsConfig: () => [],
    } as unknown as McpManager,
  } as unknown as ToolContext;

  return { context, executeMcpTool };
}

const POOL = [
  { name: "mcp__srv__echo", description: "Echo back" },
  { name: "mcp__srv__sum", description: "Add numbers" },
];

function run(
  code: string,
  options: FakeMcpOptions & {
    pool?: typeof POOL;
    timeoutMs?: number;
    maxToolCalls?: number;
    maxLogChars?: number;
    maxResultChars?: number;
    abortSignal?: AbortSignal;
    onToolCall?: (name: string) => void;
  } = {},
) {
  const { context } = contextWith(options);
  if (options.abortSignal) context.abortSignal = options.abortSignal;
  return runExecScript({
    code,
    pool: options.pool ?? POOL,
    context,
    timeoutMs: options.timeoutMs,
    maxToolCalls: options.maxToolCalls,
    maxLogChars: options.maxLogChars,
    maxResultChars: options.maxResultChars,
    onToolCall: options.onToolCall,
  });
}

describe("runExecScript — the bridge", () => {
  it("awaits a tool call and hands the value back into the script", async () => {
    const result = await run(`
      const first = await tools.mcp__srv__echo({ q: "hi" });
      const second = await tools["mcp__srv__sum"]({ a: 1, b: 2 });
      console.log("first", first.content);
      return { first: first.content, second: second.content };
    `);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({
      first: "ok:mcp__srv__echo",
      second: "ok:mcp__srv__sum",
    });
    expect(result.logs).toEqual(["first ok:mcp__srv__echo"]);
    expect(result.toolCalls).toBe(2);
  });

  it("resolves the tool-call result without extra wrapping", async () => {
    const result = await run(`
      const r = await tools.mcp__srv__echo({});
      return { content: r.content, images: r.images };
    `);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({
      content: "ok:mcp__srv__echo",
      images: 0,
    });
  });

  it("passes the arguments through to the MCP tool untouched", async () => {
    const { context, executeMcpTool } = contextWith();
    await runExecScript({
      code: `return await tools.mcp__srv__sum({ a: 1, nested: { b: [2, "x"] } });`,
      pool: POOL,
      context,
    });

    expect(executeMcpTool).toHaveBeenCalledWith(
      "mcp__srv__sum",
      { a: 1, nested: { b: [2, "x"] } },
      context,
    );
  });

  it("lets the script catch a denied tool call and keep going", async () => {
    const result = await run(
      `
        let denial = null;
        try {
          await tools.mcp__srv__echo({});
        } catch (error) {
          denial = error.message;
        }
        return { denial };
      `,
      {
        behavior: (name) =>
          name === "mcp__srv__echo"
            ? new Error("Permission denied by user")
            : undefined,
      },
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({
      denial: "Permission denied by user",
    });
  });

  it("rejects a tool name that is not in the pool and points at search", async () => {
    const result = await run(`
      try {
        await tools.mcp__srv__nope({});
        return { outcome: "called" };
      } catch (error) {
        return { outcome: error.message };
      }
    `);

    expect(result.ok).toBe(true);
    const { outcome } = JSON.parse(result.value!);
    expect(outcome).toContain("mcp__srv__nope");
    // The pointer names a call the host actually accepts, derived from the same
    // schema the tool description is rendered from.
    expect(outcome).toContain(`tools["$codemode"].search({ query: "..." })`);
  });

  it("offers search over the full pool", async () => {
    const result = await run(`
      const all = await tools["$codemode"].search({ query: "" });
      const sums = await tools["$codemode"].search({ query: "sum" });
      return { all: JSON.parse(all.content).length, sums: JSON.parse(sums.content).map((t) => t.name) };
    `);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({
      all: 2,
      sums: ["mcp__srv__sum"],
    });
  });

  it("fails a search whose arguments do not match the documented shape", async () => {
    // A typo'd field used to fall through as "no query" and answer with the whole
    // pool — a wrong call dressed up as a successful search.
    const result = await run(`
      try {
        const res = await tools["$codemode"].search({ q: "sum" });
        return { outcome: "returned " + JSON.parse(res.content).length };
      } catch (error) {
        return { outcome: error.message };
      }
    `);

    expect(result.ok).toBe(true);
    const { outcome } = JSON.parse(result.value!);
    expect(outcome).toContain(`does not take "q"`);
    expect(outcome).toContain(`tools["$codemode"].search({ query: "..." })`);
  });

  it("returns the rendered signature rather than the raw JSON Schema", async () => {
    // The point of search is that the model can copy the result verbatim into a
    // call, so the entry must carry the same rendering the catalog uses — and
    // must not leak the schema object itself.
    const pool = [
      {
        name: "mcp__srv__sum",
        description: "Add numbers",
        inputSchema: {
          type: "object",
          properties: {
            a: { type: "number", description: "first addend" },
            b: { type: "number" },
          },
          required: ["a", "b"],
        },
      },
    ];
    const result = await run(
      `
        const found = await tools["$codemode"].search({ query: "sum" });
        return JSON.parse(found.content);
      `,
      { pool },
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual([
      {
        name: "mcp__srv__sum",
        description: "Add numbers",
        signature: [
          "tools.mcp__srv__sum({",
          "  /** first addend */",
          "  a: number,",
          "  b: number,",
          "})",
        ].join("\n"),
      },
    ]);
  });

  it("rejects arguments that are not a plain object", async () => {
    const result = await run(`
      try {
        await tools.mcp__srv__echo("not-an-object");
        return "called";
      } catch (error) {
        return error.message;
      }
    `);

    expect(result.ok).toBe(true);
    expect(result.value).toContain("plain object");
  });
});

describe("runExecScript — isolation", () => {
  it("blocks eval, new Function and import at the engine level", async () => {
    const result = await run(`
      const outcomes = {};
      try { eval("1 + 1"); outcomes.eval = "allowed"; } catch (e) { outcomes.eval = e.constructor.name; }
      try { new Function("return 1")(); outcomes.fn = "allowed"; } catch (e) { outcomes.fn = e.constructor.name; }
      try { await import("node:fs"); outcomes.import = "allowed"; } catch (e) { outcomes.import = e.constructor.name; }
      return outcomes;
    `);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({
      eval: "EvalError",
      fn: "EvalError",
      import: "TypeError",
    });
  });

  it("gives the script no way back to code generation through returned values", async () => {
    // The value crosses two boundaries: structured clone into the worker, then
    // the context-realm deep clone. Without that second clone the object would
    // still carry a worker-realm Object constructor, and the worker's Function
    // has code generation enabled — a way straight back out.
    const result = await run(`
      const r = await tools.mcp__srv__echo({});
      try {
        return { outcome: "escaped:" + r.constructor.constructor("return typeof process")() };
      } catch (error) {
        return { outcome: "blocked:" + error.constructor.name };
      }
    `);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({ outcome: "blocked:TypeError" });
  });

  it("gives the script no way back through a tool wrapper", async () => {
    const result = await run(`
      try {
        return { outcome: "escaped:" + tools.mcp__srv__echo.constructor("return typeof process")() };
      } catch (error) {
        return { outcome: "blocked:" + error.constructor.name };
      }
    `);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({ outcome: "blocked:EvalError" });
  });
});

describe("runExecScript — budgets and lifecycle", () => {
  it("terminates a synchronous spin", async () => {
    const result = await run("while (true) {}", { timeoutMs: 400 });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("budget");
  });

  it("terminates a script that yields and then spins", async () => {
    // `vm`'s own `{ timeout }` cannot catch this: the async function returns to
    // the event loop before spinning, so only terminating the worker stops it.
    const result = await run("await 0; while (true) {}", { timeoutMs: 400 });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("budget");
  });

  it("terminates a script awaiting a promise that never settles", async () => {
    const result = await run("await new Promise(() => {});", {
      timeoutMs: 400,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("budget");
  });

  it("stops at the tool-call limit without killing the run", async () => {
    const result = await run(
      `
        const outcomes = [];
        for (let i = 0; i < 3; i++) {
          try { outcomes.push((await tools.mcp__srv__echo({ i })).content); }
          catch (error) { outcomes.push("rejected"); }
        }
        return outcomes;
      `,
      { maxToolCalls: 1 },
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual([
      "ok:mcp__srv__echo",
      "rejected",
      "rejected",
    ]);
  });

  it("reports each call as it is issued, in order", async () => {
    const names: string[] = [];

    await run(
      `
        await tools.mcp__srv__echo({});
        await tools.mcp__srv__sum({});
      `,
      { onToolCall: (name) => names.push(name) },
    );

    expect(names).toEqual(["mcp__srv__echo", "mcp__srv__sum"]);
  });

  it("reports a call the tool-call limit refuses", async () => {
    const names: string[] = [];

    const result = await run(
      `
        const outcomes = [];
        for (let i = 0; i < 3; i++) {
          try { outcomes.push((await tools.mcp__srv__echo({ i })).content); }
          catch (error) { outcomes.push("rejected"); }
        }
        return outcomes;
      `,
      { maxToolCalls: 1, onToolCall: (name) => names.push(name) },
    );

    // The host saw all three attempts, so the caller's summary can count them
    // even though only the first one actually ran.
    expect(result.toolCalls).toBe(3);
    expect(names).toEqual([
      "mcp__srv__echo",
      "mcp__srv__echo",
      "mcp__srv__echo",
    ]);
  });

  it("returns a bare string as-is and serializes anything else", async () => {
    expect((await run(`return "plain text";`)).value).toBe("plain text");
    expect((await run(`return { a: [1, 2] };`)).value).toBe('{"a":[1,2]}');
    expect((await run(`return undefined;`)).value).toBe("undefined");
  });

  it("reports a script error instead of rejecting", async () => {
    const result = await run(`throw new Error("boom")`);
    expect(result.ok).toBe(false);
    expect(result.error).toBe("boom");
  });

  it("caps console output", async () => {
    const result = await run(
      `for (let i = 0; i < 100; i++) console.log("x".repeat(100)); return "done";`,
      { maxLogChars: 250 },
    );

    expect(result.ok).toBe(true);
    expect(result.logs.join("").length).toBeLessThanOrEqual(400);
  });

  it("caps the value handed back to the model", async () => {
    // The flat MCP path bounds its own results (toolResultStorage), so an
    // unbounded return value here would make the nested call bigger than the
    // call it replaced.
    const result = await run(`return "y".repeat(5000);`, {
      maxResultChars: 200,
    });

    expect(result.ok).toBe(true);
    expect(result.value).toBe(
      "y".repeat(200) +
        "\n... (returned value truncated: 5000 characters total)",
    );
  });

  it("propagates images from nested calls", async () => {
    const result = await run(`return await tools.mcp__srv__echo({});`, {
      behavior: () => ({
        success: true,
        content: "with image",
        images: [{ data: "AAA", mediaType: "image/png" }],
      }),
    });

    expect(result.ok).toBe(true);
    expect(result.images).toEqual([{ data: "AAA", mediaType: "image/png" }]);
  });

  it("aborts immediately when the signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await run(`return "never runs";`, {
      abortSignal: controller.signal,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("aborted");
  });

  it("aborts a running script when the signal fires", async () => {
    const controller = new AbortController();
    const pending = run(`await new Promise(() => {});`, {
      abortSignal: controller.signal,
      timeoutMs: 30_000,
    });
    controller.abort();

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.error).toContain("aborted");
  });
});
