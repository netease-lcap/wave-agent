import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateScript,
  parseScript,
  executeScript,
} from "../../src/workflow/scriptRuntime.js";

const VALID_META = `export const meta = { name: "test-workflow", description: "A test workflow" };`;

function scriptOf(code: string): string {
  return `${VALID_META}\n${code}`;
}

const agent = vi.fn(async (prompt: string) => `agent-result: ${prompt}`);
const log = vi.fn();

const mockApis = {
  agent,
  parallel: async (thunks: Array<() => Promise<unknown>>) =>
    Promise.all(thunks.map((thunk) => thunk())),
  pipeline: async (
    items: unknown[],
    ...stages: Array<
      (prev: unknown, item: unknown, index: number) => Promise<unknown>
    >
  ) => {
    const results: unknown[] = [];
    for (let i = 0; i < items.length; i++) {
      let value = items[i];
      for (const stage of stages) {
        value = await stage(value, items[i], i);
      }
      results.push(value);
    }
    return results;
  },
  phase: () => {},
  log,
  args: {},
  budget: { total: null, spent: () => 0, remaining: () => Infinity },
  getFailures: () => [],
  recordFailure: () => {},
};

beforeEach(() => {
  agent.mockClear();
  log.mockClear();
});

describe("validateScript", () => {
  it("valid script passes validation", () => {
    const result = validateScript(scriptOf("const x = 1;"));
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("catches missing export const meta", () => {
    const result = validateScript(`const x = 1;`);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Script must start with 'export const meta = {...}'",
    );
  });

  it("accepts timestamps and randomness as code (they fail at runtime, not at validation)", () => {
    const result = validateScript(
      scriptOf(
        "const t = Date.now(); const r = Math.random(); const d = new Date();",
      ),
    );
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  describe("scenario 1: real escapes are rejected with a position", () => {
    it.each([
      [`await import("node:fs");`, "dynamic import() is not available"],
      [`const fs = require("fs");`, '"require" is not available'],
      [`process.exit(1);`, '"process" is not available'],
      [`await fetch("https://example.com");`, '"fetch" is not available'],
      [`import fs from "node:fs";`, "import statements are not available"],
      [`child_process.execSync("ls");`, '"child_process" is not available'],
      [`globalThis.process.exit(1);`, '"globalThis" is not available'],
    ])("rejects %s", (code, expected) => {
      const result = validateScript(scriptOf(code));
      expect(result.valid).toBe(false);
      // Every violation names the offending construct *and* where it is.
      expect(result.errors.join("\n")).toContain(expected);
      expect(result.errors.join("\n")).toMatch(/at line \d+, column \d+/);
    });

    it("points at the exact line and column of the violation", () => {
      const result = validateScript(scriptOf(`const a = 1;\nprocess.exit(1);`));
      expect(result.errors).toContain(
        '"process" is not available at line 3, column 1',
      );
    });

    it("rejects before anything runs, so the script has no side effects", async () => {
      const script = scriptOf(
        `const fs = require("fs");\nawait agent("must not run");\nlog("must not run");`,
      );
      await expect(executeScript(script, mockApis)).rejects.toThrow(
        "Script validation failed",
      );
      expect(agent).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    });

    it("rejects a dynamic import without touching the module system", async () => {
      const script = scriptOf(
        `const fs = await import("node:fs");\nawait agent("must not run");`,
      );
      await expect(executeScript(script, mockApis)).rejects.toThrow(
        "dynamic import() is not available",
      );
      expect(agent).not.toHaveBeenCalled();
    });
  });

  describe("scenario 2: strings and comments never participate", () => {
    it("accepts banned words that only appear in a prompt string or a comment", () => {
      const script = scriptOf(
        [
          `// do NOT call require("fs") or read process.env, and never use fetch()`,
          `const out = await agent("Read the file with fs.readFileSync(path), check process.env and call fetch('http://x') instead");`,
          `/* XMLHttpRequest, child_process and eval() are off limits too */`,
          `return out;`,
        ].join("\n"),
      );
      const result = validateScript(script);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });

    it("accepts banned words inside a template-literal prompt", () => {
      const script = scriptOf(
        "const out = await agent(`never use eval() or __dirname here`);\nreturn out;",
      );
      expect(validateScript(script).valid).toBe(true);
    });

    it("still runs such a script end to end", async () => {
      const script = scriptOf(
        `return await agent("explain why require('fs') is unavailable");`,
      );
      const { result } = await executeScript(script, mockApis);
      expect(result).toBe(
        "agent-result: explain why require('fs') is unavailable",
      );
    });
  });

  describe("scenario 4: syntax errors carry a position", () => {
    it("rejects TypeScript syntax with a line/column diagnostic", async () => {
      const script = scriptOf(`const x: number = 1;`);
      const result = validateScript(script);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatch(/^Script syntax error: /);
      expect(result.errors[0]).toContain("line 2, column 8");

      await expect(executeScript(script, mockApis)).rejects.toThrow(
        "Script syntax error",
      );
      expect(agent).not.toHaveBeenCalled();
    });

    it("rejects an unbalanced bracket with a line/column diagnostic", () => {
      const result = validateScript(scriptOf("const total = compute("));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Script syntax error:");
      expect(result.errors[0]).toMatch(/line 2, column \d+/);
    });

    it("rejects an unterminated string", () => {
      const result = validateScript(scriptOf(`const x = "unterminated;`));
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain("Script syntax error:");
      expect(result.errors[0]).toMatch(/line \d+, column \d+/);
    });
  });

  describe("scenario 5: meta must be a plain literal", () => {
    it.each([
      ["identifier reference", `{ name: wfName, description: "d" }`],
      ["function call", `{ name: buildName(), description: "d" }`],
      ["template interpolation", "{ name: `wf-${suffix}`, description: 'd' }"],
      ["spread element", `{ ...base, name: "x", description: "d" }`],
      ["computed key", `{ ["na" + "me"]: "x", description: "d" }`],
      ["new expression", `{ name: new String("x"), description: "d" }`],
      ["member access", `{ name: config.name, description: "d" }`],
    ])("rejects meta with %s", (category, literal) => {
      const script = `export const meta = ${literal};`;
      const result = validateScript(script);
      expect(result.valid).toBe(false);
      expect(result.errors.join("\n")).toContain(category);
      expect(result.errors.join("\n")).toMatch(/at line \d+, column \d+/);
    });

    it("rejects a meta that is not an object literal at all", () => {
      const result = validateScript(`export const meta = defineMeta("x");`);
      expect(result.valid).toBe(false);
      expect(result.errors.join("\n")).toContain("function call");
    });

    it("accepts nested literals and negative numbers", () => {
      const script = `export const meta = { name: "literal", description: "d", phases: [{ title: "Scan", detail: "grep", model: "haiku" }], retries: -1, tags: ["a", true, null] };`;
      const result = validateScript(script);
      expect(result.errors).toEqual([]);
      expect(result.valid).toBe(true);
    });
  });

  describe("scenario 6: meta must be the first statement", () => {
    it("rejects a meta that comes after another statement", () => {
      const script = `const before = 1;\nexport const meta = { name: "x", description: "d" };`;
      const result = validateScript(script);
      expect(result.valid).toBe(false);
      expect(result.errors.join("\n")).toContain(
        "`export const meta = { name, description, phases }` must be the first statement",
      );
      expect(result.errors.join("\n")).toContain("at line 2, column 1");
    });

    it("rejects a meta that follows a directive prologue", () => {
      const script = `"use strict";\nexport const meta = { name: "x", description: "d" };`;
      expect(validateScript(script).valid).toBe(false);
    });

    it("accepts leading comments before the meta", () => {
      const script = `// a workflow that does nothing\nexport const meta = { name: "x", description: "d" };\nreturn 1;`;
      expect(validateScript(script).errors).toEqual([]);
    });
  });

  it("reports every offending export, not just the meta", () => {
    const script = `export const meta = { name: "x", description: "d" };\nexport const other = 1;`;
    const result = validateScript(script);
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toContain(
      "only `export const meta` may be exported",
    );
  });
});

describe("parseScript", () => {
  it("extracts meta and body correctly", () => {
    const parsed = parseScript(
      scriptOf(`const result = await agent("hello");`),
    );
    expect(parsed.meta.name).toBe("test-workflow");
    expect(parsed.meta.description).toBe("A test workflow");
    expect(parsed.body).toContain('agent("hello")');
    expect(parsed.body).not.toContain("export const meta");
  });

  it("handles JS object syntax: unquoted keys", () => {
    const parsed = parseScript(
      `export const meta = { name: "js-obj", description: "desc" };\nlog("hi");`,
    );
    expect(parsed.meta.name).toBe("js-obj");
    expect(parsed.meta.description).toBe("desc");
  });

  it("handles JS object syntax: trailing commas", () => {
    const parsed = parseScript(
      `export const meta = { name: "trail", description: "desc", };\nlog("hi");`,
    );
    expect(parsed.meta.name).toBe("trail");
  });

  it("keeps whenToUse and drops unknown fields", () => {
    const parsed = parseScript(
      `export const meta = { name: "n", description: "d", whenToUse: "w", extra: 1 };`,
    );
    expect(parsed.meta.whenToUse).toBe("w");
    expect(parsed.meta).toEqual({
      name: "n",
      description: "d",
      whenToUse: "w",
    });
  });

  describe("phases filtering", () => {
    it("drops malformed phases and keeps the valid ones", () => {
      const script = `export const meta = { name: "p", description: "d", phases: ["改写", { title: "校验" }, { title: 1 }] };`;
      expect(parseScript(script).meta.phases).toEqual([{ title: "校验" }]);
    });

    it("keeps detail and model when they are strings", () => {
      const script = `export const meta = { name: "p", description: "d", phases: [{ title: "Scan", detail: "grep", model: "haiku" }] };`;
      expect(parseScript(script).meta.phases).toEqual([
        { title: "Scan", detail: "grep", model: "haiku" },
      ]);
    });

    it("treats phases as absent when every entry is malformed", () => {
      const script = `export const meta = { name: "p", description: "d", phases: ["改写", { title: 1 }] };`;
      expect(parseScript(script).meta.phases).toBeUndefined();
    });

    it("treats a non-array phases value as absent", () => {
      const script = `export const meta = { name: "p", description: "d", phases: "改写" };`;
      expect(parseScript(script).meta.phases).toBeUndefined();
    });
  });

  it("throws on missing meta declaration", () => {
    expect(() => parseScript("const x = 1;")).toThrow(
      "Script must contain 'export const meta = {...}'",
    );
  });

  it("throws on missing name", () => {
    expect(() =>
      parseScript(`export const meta = { description: "no name" };\n`),
    ).toThrow("meta.name is required and must be a string");
  });

  it("throws on missing description", () => {
    expect(() =>
      parseScript(`export const meta = { name: "no-desc" };\n`),
    ).toThrow("meta.description is required and must be a string");
  });

  it("never evaluates the meta object", () => {
    const script = `export const meta = { name: getMeta(), description: "d" };`;
    expect(() => parseScript(script)).toThrow("function call");
  });
});

describe("executeScript", () => {
  it("runs a simple script and returns the result", async () => {
    const { meta, result } = await executeScript(
      scriptOf(`return await agent("hello");`),
      mockApis,
    );
    expect(meta.name).toBe("test-workflow");
    expect(result).toBe("agent-result: hello");
  });

  it("returns undefined when the script returns nothing", async () => {
    const { result } = await executeScript(scriptOf(`const x = 1;`), mockApis);
    expect(result).toBeUndefined();
  });

  it("throws before execution when banned patterns are present", async () => {
    await expect(
      executeScript(scriptOf(`const x = require('fs');`), mockApis),
    ).rejects.toThrow("Script validation failed");
  });

  it("keeps script line numbers in stack traces", async () => {
    // Line 1 is the meta declaration, line 2 the first body statement, so the
    // throw on line 3 must be reported as line 3 — not shifted by the wrapper.
    const script = scriptOf(`const a = 1;\nthrow new Error("boom");`);
    let stack = "";
    try {
      await executeScript(script, mockApis);
    } catch (error) {
      stack = error instanceof Error ? (error.stack ?? "") : "";
    }
    expect(stack).toContain("workflow-script.js:3");
  });

  describe("scenario 3: determinism shims", () => {
    it("throws on Date.now() instead of returning the clock", async () => {
      await expect(
        executeScript(scriptOf(`return Date.now();`), mockApis),
      ).rejects.toThrow("Date.now() would break resume determinism");
    });

    it("throws on Math.random() instead of returning a random value", async () => {
      await expect(
        executeScript(scriptOf(`return Math.random();`), mockApis),
      ).rejects.toThrow("Math.random() would break resume determinism");
    });

    it("throws on an argument-less new Date()", async () => {
      await expect(
        executeScript(scriptOf(`return new Date();`), mockApis),
      ).rejects.toThrow("new Date() would break resume determinism");
    });

    it("throws from a nested call too", async () => {
      await expect(
        executeScript(
          scriptOf(`return [1, 2].map(() => Date.now());`),
          mockApis,
        ),
      ).rejects.toThrow("Date.now() would break resume determinism");
    });

    it("still supports the rest of Date and Math", async () => {
      const { result } = await executeScript(
        scriptOf(
          `const stamps = [new Date(0).getTime(), Date.UTC(2024, 0, 1), new Date("2020-01-01T00:00:00.000Z").toISOString()];\nreturn { stamps, max: Math.max(1, 2), round: Math.round(1.4) };`,
        ),
        mockApis,
      );
      expect(result).toEqual({
        stamps: [0, 1704067200000, "2020-01-01T00:00:00.000Z"],
        max: 2,
        round: 1,
      });
    });
  });

  describe("sandbox surface", () => {
    it("exposes the orchestration APIs, timers and a bridged console", async () => {
      const { result } = await executeScript(
        scriptOf(
          [
            `log("from log()");`,
            `console.log("from console", 1);`,
            `console.warn("warn");`,
            `console.error({ code: 2 });`,
            `await new Promise((resolve) => setTimeout(resolve, 0));`,
            `return typeof clearTimeout;`,
          ].join("\n"),
        ),
        mockApis,
      );
      expect(result).toBe("function");
      expect(log).toHaveBeenNthCalledWith(1, "from log()");
      expect(log).toHaveBeenNthCalledWith(2, "from console 1");
      expect(log).toHaveBeenNthCalledWith(3, "warn");
      expect(log).toHaveBeenNthCalledWith(4, '{"code":2}');
    });

    it("does not leak the host console", async () => {
      const { result } = await executeScript(
        scriptOf(`return typeof console.dir;`),
        mockApis,
      );
      expect(result).toBe("undefined");
    });

    it("sanitizes the result so no VM prototype escapes", async () => {
      const { result } = await executeScript(
        scriptOf(`const value = { nested: { list: [1, 2] } };\nreturn value;`),
        mockApis,
      );
      expect(result).toEqual({ nested: { list: [1, 2] } });
      expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
      expect(Object.getPrototypeOf((result as { nested: object }).nested)).toBe(
        Object.prototype,
      );
    });

    it("rejects with 'Workflow aborted' when the run is aborted", async () => {
      const controller = new AbortController();
      const pending = executeScript(
        scriptOf(`await new Promise(() => {});\nreturn "never";`),
        mockApis,
        controller.signal,
      );
      await Promise.resolve();
      controller.abort();
      await expect(pending).rejects.toThrow("Workflow aborted");
    });
  });

  it("pipeline: single-stage passes (item, index) to first stage", async () => {
    const script = scriptOf(
      [
        `const results = await pipeline([10, 20], async (item, originalItem, index) => {`,
        `  if (item !== originalItem) throw new Error("first stage must receive the item twice");`,
        `  return item + index;`,
        `});`,
        `return results;`,
      ].join("\n"),
    );
    const { result } = await executeScript(script, mockApis);
    // For first stage: prev=item (10), item=item (10), index=0 → 10+0=10
    // For second item: prev=item (20), item=item (20), index=1 → 20+1=21
    expect(result).toEqual([10, 21]);
  });

  it("pipeline: two-stage passes (prevResult, item, index) to second stage", async () => {
    const script = scriptOf(
      [
        `const results = await pipeline(`,
        `  [1, 2],`,
        `  async (item) => item * 10,`,
        `  async (prev, item, index) => prev + index,`,
        `);`,
        `return results;`,
      ].join("\n"),
    );
    const { result } = await executeScript(script, mockApis);
    expect(result).toEqual([10, 21]);
  });
});

describe("sandbox realm boundary", () => {
  // A value that crosses into the sandbox must not carry the host realm's
  // `Function`: `codeGeneration: {strings: false}` only restricts the sandbox's
  // own Function, while a borrowed constructor compiles in the realm that owns
  // it — handing the script the real `process` object.
  const ESCAPES = [
    `agent.constructor("return typeof process")()`,
    `console.log.constructor("return typeof process")()`,
    `setTimeout.constructor("return typeof process")()`,
    `args.constructor.constructor("return typeof process")()`,
    `budget.constructor.constructor("return typeof process")()`,
  ];

  it.each(ESCAPES)("does not lend the host Function: %s", async (escape) => {
    const { result } = await executeScript(
      scriptOf(`try { return ${escape} } catch { return "blocked" }`),
      mockApis,
    );
    expect(result).toBe("blocked");
  });

  it("copies the result of a host call into the sandbox realm", async () => {
    const { result } = await executeScript(
      scriptOf(
        [
          `const value = await agent("x");`,
          `try { return value.constructor.constructor("return typeof process")() }`,
          `catch { return "blocked" }`,
        ].join("\n"),
      ),
      { ...mockApis, agent: async () => ({ ok: true }) },
    );
    expect(result).toBe("blocked");
  });

  it("surfaces a host failure as a realm-local error", async () => {
    const { result } = await executeScript(
      scriptOf(
        [
          `try { await agent("x"); return "no throw"; }`,
          `catch (error) {`,
          `  try { return error.constructor.constructor("return typeof process")() }`,
          `  catch { return { name: error.name, message: error.message } }`,
          `}`,
        ].join("\n"),
      ),
      {
        ...mockApis,
        agent: async () => {
          throw new Error("api exploded");
        },
      },
    );
    expect(result).toEqual({ name: "Error", message: "api exploded" });
  });

  it("copies args in instead of sharing the host object", async () => {
    const hostArgs = { topic: "x", nested: { keep: 1 } };
    const { result } = await executeScript(
      scriptOf(`args.nested.keep = 99;\nreturn args.topic;`),
      { ...mockApis, args: hostArgs },
    );
    expect(result).toBe("x");
    expect(hostArgs).toEqual({ topic: "x", nested: { keep: 1 } });
  });

  it("hands the script a proto-less, frozen budget view", async () => {
    const { result } = await executeScript(
      scriptOf(
        [
          `let reassignment = "allowed";`,
          `try { budget.total = 5; } catch { reassignment = "blocked"; }`,
          `return {`,
          `  proto: typeof budget.constructor,`,
          `  reassignment,`,
          `  total: budget.total,`,
          `  spent: budget.spent(),`,
          `};`,
        ].join("\n"),
      ),
      {
        ...mockApis,
        budget: { total: null, spent: () => 7, remaining: () => Infinity },
      },
    );
    expect(result).toEqual({
      proto: "undefined",
      reassignment: "blocked",
      total: null,
      spent: 7,
    });
  });

  it("keeps timer handles out of the host realm", async () => {
    const { result } = await executeScript(
      scriptOf(
        [
          `const handle = setTimeout(() => {}, 0);`,
          `clearTimeout(handle);`,
          `return typeof handle;`,
        ].join("\n"),
      ),
      mockApis,
    );
    expect(result).toBe("number");
  });

  it("lets the script read and append the run's failure list", async () => {
    const failures = ["pipeline[1] failed: boom"];
    const recordFailure = vi.fn((message: string) => {
      failures.push(message);
    });
    const { result } = await executeScript(
      scriptOf(
        [
          `const before = getFailures();`,
          `recordFailure('item 9 gave up');`,
          `const copy = getFailures();`,
          `copy.push('mutated from the script');`,
          `return { before, copy, live: getFailures(), returned: copy.length };`,
        ].join("\n"),
      ),
      { ...mockApis, getFailures: () => [...failures], recordFailure },
    );

    expect(recordFailure).toHaveBeenCalledWith("item 9 gave up");
    expect(result).toEqual({
      before: ["pipeline[1] failed: boom"],
      // The array the script got back is a realm-local copy it may mutate…
      copy: [
        "pipeline[1] failed: boom",
        "item 9 gave up",
        "mutated from the script",
      ],
      returned: 3,
      // …and the host list is untouched by that mutation.
      live: ["pipeline[1] failed: boom", "item 9 gave up"],
    });
  });
});
