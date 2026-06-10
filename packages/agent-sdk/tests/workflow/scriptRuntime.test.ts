import { describe, it, expect } from "vitest";
import {
  validateScript,
  parseScript,
  executeScript,
} from "../../src/workflow/scriptRuntime.js";

const VALID_META = `export const meta = {
  name: "test-workflow",
  description: "A test workflow",
};
`;

describe("validateScript", () => {
  it("valid script passes validation", () => {
    const script = `${VALID_META}\nconst x = 1;`;
    const result = validateScript(script);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("catches missing export const meta", () => {
    const script = `const x = 1;`;
    const result = validateScript(script);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(
      "Script must start with 'export const meta = {...}'",
    );
  });

  it.each([
    [
      "require()",
      `require('fs')`,
      "require() is not available in workflow scripts",
    ],
    [
      "process.",
      `process.env`,
      "process.* is not available in workflow scripts",
    ],
    ["eval()", `eval('x')`, "eval() is not available in workflow scripts"],
    [
      "import",
      `import fs from 'fs'`,
      "import statements are not available in workflow scripts",
    ],
    ["Date.now", `Date.now()`, "Date.now() would break resume determinism"],
    [
      "Math.random",
      `Math.random()`,
      "Math.random() would break resume determinism",
    ],
  ])("catches banned pattern: %s", (_label, code, expectedMessage) => {
    const script = `${VALID_META}\n${code};`;
    const result = validateScript(script);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(expectedMessage);
  });
});

describe("parseScript", () => {
  it("extracts meta and body correctly", () => {
    const script = `${VALID_META}\nconst result = await agent("hello");`;
    const parsed = parseScript(script);

    expect(parsed.meta.name).toBe("test-workflow");
    expect(parsed.meta.description).toBe("A test workflow");
    expect(parsed.body).toContain('agent("hello")');
  });

  it("handles JS object syntax: unquoted keys", () => {
    const script = `export const meta = { name: "js-obj", description: "desc" };\nlog("hi");`;
    const parsed = parseScript(script);
    expect(parsed.meta.name).toBe("js-obj");
    expect(parsed.meta.description).toBe("desc");
  });

  it("handles JS object syntax: trailing commas", () => {
    const script = `export const meta = { name: "trail", description: "desc", };\nlog("hi");`;
    const parsed = parseScript(script);
    expect(parsed.meta.name).toBe("trail");
  });

  it("throws on missing meta declaration", () => {
    expect(() => parseScript("const x = 1;")).toThrow(
      "Script must contain 'export const meta = {...}'",
    );
  });

  it("throws on missing name", () => {
    const script = `export const meta = { description: "no name" };\n`;
    expect(() => parseScript(script)).toThrow(
      "meta.name is required and must be a string",
    );
  });

  it("throws on missing description", () => {
    const script = `export const meta = { name: "no-desc" };\n`;
    expect(() => parseScript(script)).toThrow(
      "meta.description is required and must be a string",
    );
  });
});

describe("executeScript", () => {
  const mockApis = {
    agent: async (prompt: string) => `agent-result: ${prompt}`,
    parallel: async (thunks: Array<() => Promise<unknown>>) =>
      Promise.all(thunks.map((t) => t())),
    pipeline: async (
      items: unknown[],
      ...stages: Array<
        (prev: unknown, item: unknown, index: number) => Promise<unknown>
      >
    ) => {
      const results: unknown[] = [];
      for (let i = 0; i < items.length; i++) {
        let val = items[i];
        for (const stage of stages) {
          val = await stage(val, items[i], i);
        }
        results.push(val);
      }
      return results;
    },
    phase: () => {},
    log: () => {},
    args: {},
    budget: {},
  };

  it("runs a simple script and returns the result", async () => {
    const script = `${VALID_META}\nreturn await agent("hello");`;
    const { meta, result } = await executeScript(script, mockApis);

    expect(meta.name).toBe("test-workflow");
    expect(result).toBe("agent-result: hello");
  });

  it("throws before execution when banned patterns are present", async () => {
    const script = `${VALID_META}\nconst x = require('fs');`;
    await expect(executeScript(script, mockApis)).rejects.toThrow(
      "Script validation failed",
    );
  });

  it("pipeline: single-stage passes (item, index) to first stage", async () => {
    const script2 = `${VALID_META}
const results = await pipeline([10, 20], async (item, _item2, index) => {
  return item + index;
});
return results;`;

    const { result } = await executeScript(script2, mockApis);
    // For first stage: prev=item (10), item=item (10), index=0 → 10+0=10
    // For second item: prev=item (20), item=item (20), index=1 → 20+1=21
    expect(result).toEqual([10, 21]);
  });

  it("pipeline: two-stage passes (prevResult, item, index) to second stage", async () => {
    const script = `${VALID_META}
const results = await pipeline(
  [1, 2],
  async (item) => item * 10,
  async (prev, item, index) => prev + index,
);
return results;`;

    const { result } = await executeScript(script, mockApis);
    // Item 1: stage1=10, stage2=10+0=10
    // Item 2: stage1=20, stage2=20+1=21
    expect(result).toEqual([10, 21]);
  });
});
