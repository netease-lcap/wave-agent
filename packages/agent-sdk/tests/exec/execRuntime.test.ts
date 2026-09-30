import { describe, it, expect, vi } from "vitest";
import type { ToolContext } from "../../src/tools/types.js";
import type { McpManager } from "../../src/managers/mcpManager.js";
import { runExecScript } from "../../src/exec/execRuntime.js";
import type { ExecPoolEntry } from "../../src/exec/catalog.js";

interface FakeMcpOptions {
  content?: string;
  /** What the nested `await` resolves to; defaults to `content` (a text-only
   * result resolves to its text). Pass `null` for a tool that returned nothing. */
  output?: unknown;
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
      const content = options.content ?? `ok:${name}`;
      return {
        success: true,
        content,
        // `??` would fold the explicit `null` case back into the text.
        output: "output" in options ? options.output : content,
      };
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
  // `isMcp` is what picks the dispatch funnel, and `buildExecPool` is its only
  // producer: a pool entry that says nothing routes to the built-in path.
  { name: "mcp__srv__echo", isMcp: true, description: "Echo back" },
  { name: "mcp__srv__sum", isMcp: true, description: "Add numbers" },
];

function run(
  code: string,
  options: FakeMcpOptions & {
    pool?: ExecPoolEntry[];
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
      console.log("first", first);
      return { first, second };
    `);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({
      first: "ok:mcp__srv__echo",
      second: "ok:mcp__srv__sum",
    });
    expect(result.logs).toEqual(["first ok:mcp__srv__echo"]);
    expect(result.toolCalls).toBe(2);
  });

  it("resolves to the tool's output rather than an envelope", async () => {
    // What the signature promises (`Promise<T>`) is what the script gets: the
    // value itself, so `note.foo` works instead of `note.output.foo`.
    const result = await run(`
      const r = await tools.mcp__srv__echo({});
      return { type: typeof r, value: r };
    `);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({
      type: "string",
      value: "ok:mcp__srv__echo",
    });
  });

  it("resolves a structured result to the object, not to its text", async () => {
    const result = await run(
      `
        const r = await tools.mcp__srv__echo({});
        return { id: r.id, keys: Object.keys(r) };
      `,
      { content: '{"id":"7"}', output: { id: "7" } },
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({ id: "7", keys: ["id"] });
  });

  it("resolves a tool that returned nothing to null", async () => {
    // `content` is the display text (a placeholder for a silent tool); the value
    // must be `null`, not the placeholder — a script has to be able to tell
    // "said nothing" from "said 'No content'".
    const result = await run(
      `
        const r = await tools.mcp__srv__echo({});
        return { value: r, silent: r === null };
      `,
      { content: "No content", output: null },
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({ value: null, silent: true });
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
    expect(outcome).toContain(
      `tools["$codemode"].search({ query: "...", max_results: 0 })`,
    );
  });

  it("offers search over the full pool", async () => {
    const result = await run(`
      const all = await tools["$codemode"].search({ query: "" });
      const sums = await tools["$codemode"].search({ query: "sum" });
      return { all: all.total, sums: sums.matches.map((t) => t.name) };
    `);

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({
      all: 2,
      sums: ["mcp__srv__sum"],
    });
  });

  it("reports how many hits the cap hid", async () => {
    // Without `total` the model reads "five hits" as "five matches", which is the
    // same failure a silently truncated announcement would cause.
    const pool = Array.from({ length: 8 }, (_, i) => ({
      name: `mcp__srv__tool${i}`,
    }));
    const result = await run(
      `
        const found = await tools["$codemode"].search({ query: "tool", max_results: 2 });
        return { shown: found.matches.length, total: found.total };
      `,
      { pool },
    );

    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({ shown: 2, total: 8 });
  });

  it("fails a search whose arguments do not match the documented shape", async () => {
    // A typo'd field used to fall through as "no query" and answer with the whole
    // pool — a wrong call dressed up as a successful search.
    const result = await run(`
      try {
        const res = await tools["$codemode"].search({ q: "sum" });
        return { outcome: "returned " + res.total };
      } catch (error) {
        return { outcome: error.message };
      }
    `);

    expect(result.ok).toBe(true);
    const { outcome } = JSON.parse(result.value!);
    expect(outcome).toContain(`does not take "q"`);
    expect(outcome).toContain(
      `tools["$codemode"].search({ query: "...", max_results: 0 })`,
    );
  });

  it("returns the rendered signature rather than the raw JSON Schema", async () => {
    // The point of search is that the model can copy the result verbatim into a
    // call, so the entry must carry the same rendering the signature renderer
    // produces — and must not leak the schema object itself.
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
        return found.matches;
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
          "}): Promise<unknown>",
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

describe("runExecScript — built-in dispatch", () => {
  /** A pool of one built-in, and a context whose tool manager records the call. */
  function builtInRun(
    code: string,
    result:
      | { success: true; content: string; images?: Array<{ data: string }> }
      | { success: false; error: string },
  ) {
    const execute = vi.fn(async () => result);
    const { context } = contextWith();
    context.toolManager = { execute } as unknown as ToolContext["toolManager"];
    return {
      execute,
      promise: runExecScript({
        code,
        pool: [{ name: "WebFetch", description: "Fetch a URL" }],
        context,
      }),
    };
  }

  it("routes a non-MCP tool through the tool manager and resolves to its text", async () => {
    const { execute, promise } = builtInRun(
      `
        const r = await tools.WebFetch({ url: "https://example.com" });
        return { type: typeof r, value: r };
      `,
      { success: true, content: "hello" },
    );

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({
      type: "string",
      value: "hello",
    });
    // `ToolManager.execute` is the built-ins' funnel: it supplies the enhanced
    // context a built-in reads its permission manager out of. Routing around it
    // would hand the tool a context missing the managers it needs.
    expect(execute).toHaveBeenCalledWith(
      "WebFetch",
      { url: "https://example.com" },
      expect.objectContaining({ workdir: "/tmp" }),
    );
  });

  it("rejects a built-in that reports failure, so the script's catch sees it", async () => {
    // `execute()` signals failure in the result rather than by throwing; both tool
    // kinds have to behave the same way inside the script, or a failed call would
    // resolve to something that looks like a successful empty answer.
    const { promise } = builtInRun(
      `
        try {
          await tools.WebFetch({ url: "https://example.com" });
          return { outcome: "resolved" };
        } catch (error) {
          return { outcome: error.message };
        }
      `,
      { success: false, error: "Permission denied by user" },
    );

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value!)).toEqual({
      outcome: "Permission denied by user",
    });
  });

  it("propagates images from a built-in call", async () => {
    const { promise } = builtInRun(`return await tools.WebFetch({});`, {
      success: true,
      content: "with image",
      images: [{ data: "BBB" }],
    });

    expect((await promise).images).toEqual([{ data: "BBB" }]);
  });

  it("refuses a built-in call when the context carries no tool manager", async () => {
    const { context } = contextWith();
    const result = await runExecScript({
      code: `return await tools.WebFetch({});`,
      pool: [{ name: "WebFetch" }],
      context,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Tool manager is not available");
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
    // has code generation enabled — a way straight back out. A structured result
    // is therefore the value to test with: a bare string has no prototype chain
    // to walk in the first place.
    const result = await run(
      `
        const r = await tools.mcp__srv__echo({});
        try {
          return { outcome: "escaped:" + r.constructor.constructor("return typeof process")() };
        } catch (error) {
          return { outcome: "blocked:" + error.constructor.name };
        }
      `,
      { output: { nested: { deep: true } } },
    );

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
          try { outcomes.push(await tools.mcp__srv__echo({ i })); }
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
          try { outcomes.push(await tools.mcp__srv__echo({ i })); }
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
        output: "with image",
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
