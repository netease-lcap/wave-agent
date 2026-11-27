import { afterEach, describe, expect, it } from "vitest";
import {
  acquireReplSandbox,
  releaseReplSandbox,
  setReplStepBudget,
  type ReplRunOptions,
  type ReplSandbox,
  type ReplSandboxHost,
} from "../../src/repl/replSandbox.js";

interface FakeHostState {
  toolCalls: Array<{ name: string; args: unknown }>;
  shellCommands: string[];
  /** The `timeout` each command carried, in ms (`undefined` when it brought none). */
  shellTimeouts: Array<number | undefined>;
  ring: string[];
  dropped: number;
  searchCalls: Array<{ query: unknown; max: unknown }>;
  selfLogs: unknown[][];
}

interface FakeHostOptions {
  tools?: string[];
  toolResult?: unknown;
  behavior?: (name: string, args: unknown) => unknown;
  shell?: (command: string) => unknown;
  ringCap?: number;
}

type FakeHost = ReplSandboxHost & { state: FakeHostState };

/** A host with just enough behaviour to observe the sandbox from the outside. */
function makeHost(options: FakeHostOptions = {}): FakeHost {
  const state: FakeHostState = {
    toolCalls: [],
    shellCommands: [],
    shellTimeouts: [],
    ring: [],
    dropped: 0,
    searchCalls: [],
    selfLogs: [],
  };
  const ringCap = options.ringCap ?? 3;
  return {
    state,
    async callTool(name, args) {
      state.toolCalls.push({ name, args });
      if (options.behavior) return options.behavior(name, args);
      return options.toolResult ?? { ok: name };
    },
    async searchTools(query, max) {
      state.searchCalls.push({ query, max });
      return [
        { name: "Read", about: "read a file", input: "{ file_path: string }" },
      ];
    },
    async describeTool(name) {
      return { name, description: "a tool", input: "{}" };
    },
    listToolNames: () => options.tools ?? [],
    async runShell(command, shellOptions) {
      state.shellCommands.push(command);
      state.shellTimeouts.push(
        (shellOptions as { timeout?: number } | undefined)?.timeout,
      );
      return options.shell
        ? options.shell(command)
        : { stdout: "hi\n", stderr: "", exitCode: 0 };
    },
    selfLog(values) {
      // The sandbox owns `outcome.logs`; this hook is the live-streaming one.
      state.selfLogs.push(values);
    },
    consoleWrite(level, values) {
      state.ring.push(`${level}: ${values.join(" ")}`);
      while (state.ring.length > ringCap) {
        state.ring.shift();
        state.dropped += 1;
      }
    },
    consoleTail: (n) => state.ring.slice(-n).join("\n"),
    consoleBuffer: () => state.ring.join("\n"),
    consoleDropped: () => state.dropped,
    running: () => [
      { id: 1, snippet: "poll()", state: "running", settled: false },
    ],
    stepError: () => new Error("REPL script stopped: step budget exhausted"),
  };
}

const keys: string[] = [];
let counter = 0;

function open(host: ReplSandboxHost = makeHost()): ReplSandbox {
  counter += 1;
  const key = `repl-test-${counter}`;
  keys.push(key);
  return acquireReplSandbox(key, host);
}

function opts(
  toolNames: readonly string[] = [],
  timeoutMs = 2_000,
): ReplRunOptions {
  return { toolNames, timeoutMs };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

afterEach(() => {
  while (keys.length > 0) {
    const key = keys.pop() as string;
    releaseReplSandbox(key);
  }
  setReplStepBudget(0);
});

describe("repl sandbox: long-lived context", () => {
  it("keeps variables and functions across runs", async () => {
    const sandbox = open();
    const first = await sandbox.run(
      "const n = 41; function bump(x) { return x + 1 }",
      opts(),
    );
    expect(first.ok).toBe(true);

    const second = await sandbox.run("return bump(n)", opts());
    expect(second).toMatchObject({ ok: true, value: "42" });
  });

  it("keeps declarations written by a run that threw", async () => {
    const sandbox = open();
    const thrown = await sandbox.run(
      'const kept = "yes"; throw new Error("boom")',
      opts(),
    );
    expect(thrown.ok).toBe(false);
    expect(thrown.error).toContain("boom");

    const after = await sandbox.run("return kept", opts());
    expect(after.value).toBe("yes");
  });

  it("runs a semicolon-free script whose statement starts with a call", async () => {
    const sandbox = open();
    const run = await sandbox.run(
      [
        "const n = 41",
        "self.log(n)",
        "const bumped = n + 1",
        "return bumped",
      ].join("\n"),
      opts(),
    );
    expect(run).toMatchObject({ ok: true, value: "42" });
  });

  it("runs a semicolon-free script whose statement starts with an await", async () => {
    const sandbox = open();
    const run = await sandbox.run(
      [
        "const first = await tools.Read({ file_path: '/a' })",
        "await tools.Read({ file_path: '/b' })",
        "return first.ok",
      ].join("\n"),
      opts(["Read"]),
    );
    expect(run).toMatchObject({ ok: true, value: "Read" });
  });

  it("does not clear a name the run declared but never reached", async () => {
    const sandbox = open();
    await sandbox.run("const kept = 'first'", opts());

    const failed = await sandbox.run(
      "throw new Error('boom')\nconst kept = 'second'",
      opts(),
    );
    expect(failed.ok).toBe(false);

    const after = await sandbox.run("return kept", opts());
    expect(after.value).toBe("first");
  });

  it("resets a name an earlier run defined when the script writes `let` without a value", async () => {
    const sandbox = open();
    await sandbox.run("const value = 5", opts());
    await sandbox.run("let value", opts());
    expect((await sandbox.run("return typeof value", opts())).value).toBe(
      "undefined",
    );
  });

  it("persists names bound by a top-level destructuring declaration", async () => {
    const sandbox = open();
    const run = await sandbox.run(
      "const { a, b } = { a: 1, b: 2 }\nreturn a + b",
      opts(),
    );
    expect(run).toMatchObject({ ok: true, value: "3" });
    expect((await sandbox.run("return b", opts())).value).toBe("2");
  });

  it("keeps a script's own top-level `p` out of the wrapper's binding", async () => {
    // The wrapper that hands the run's promise back to the host used to name its
    // local `const p`, and that binding sat between the script body and the
    // context global: a synchronous `const p` landed in its TDZ (ReferenceError),
    // and one written after an `await` assigned to a const (TypeError). `p` is the
    // first name a model reaches for when it holds a path — 19 runs on 2026-11-27.
    const sandbox = open();
    const immediate = await sandbox.run('const p = "C:/a"', opts());
    expect(immediate).toMatchObject({ ok: true });
    expect((await sandbox.run("return p", opts())).value).toBe("C:/a");

    const afterAwait = await sandbox.run(
      "const first = await Promise.resolve(1)\nconst p = first + 1\nreturn p",
      opts(),
    );
    expect(afterAwait).toMatchObject({ ok: true, value: "2" });
  });

  it("refuses a script that declares the wrapper's own binding", async () => {
    const sandbox = open();
    const refused = await sandbox.run("const __replRun = 1", opts());
    expect(refused).toMatchObject({ ok: false, rejected: true });
    expect(refused.error).toContain("ReplGlobalOverwrite");
  });

  it("reuses the context through acquire/release and drops it on release", async () => {
    counter += 1;
    const key = `repl-shared-${counter}`;
    const host = makeHost();
    const a = acquireReplSandbox(key, host);
    await a.run("const shared = 7", opts());

    const b = acquireReplSandbox(key, host);
    expect((await b.run("return shared", opts())).value).toBe("7");

    releaseReplSandbox(key);
    keys.push(key);
    const c = acquireReplSandbox(key, host);
    expect((await c.run("return typeof shared", opts())).value).toBe(
      "undefined",
    );
  });

  it("clears timers when the script that created them ends", async () => {
    const sandbox = open();
    const first = await sandbox.run(
      [
        "globalThis.fired = 0;",
        "setTimeout(() => { globalThis.fired = 1 }, 5);",
        "setInterval(() => { globalThis.fired = 2 }, 5);",
      ].join("\n"),
      opts(),
    );
    expect(first.ok).toBe(true);

    await sleep(40);
    const after = await sandbox.run("return String(globalThis.fired)", opts());
    expect(after.value).toBe("0");
  });
});

describe("repl sandbox: values", () => {
  it("returns the last expression, an explicit return, and nothing when there is none", async () => {
    const sandbox = open();
    expect((await sandbox.run("1 + 1", opts())).value).toBe("2");
    expect((await sandbox.run("return 42", opts())).value).toBe("42");
    expect((await sandbox.run("const only = 1", opts())).value).toBeUndefined();
    expect((await sandbox.run('return "done"', opts())).value).toBe("done");
  });

  it("hands the script plain-realm copies with function fields dropped", async () => {
    const host = makeHost({
      toolResult: { a: 1, fn: () => 1, nested: { b: 2 } },
    });
    const sandbox = open(host);
    const result = await sandbox.run(
      [
        "const r = await Some({});",
        "return [",
        "  Object.getPrototypeOf(r) === Object.prototype,",
        "  r.fn === undefined,",
        "  typeof r.constructor === 'function',",
        "  Object.getPrototypeOf(r.nested) === Object.prototype,",
        "  r.a,",
        "  r.nested.b,",
        "  String(r),",
        '].join("|");',
      ].join("\n"),
      opts(["Some"]),
    );
    expect(result.value).toBe("true|true|true|true|1|2|[object Object]");
  });

  it("leaves a tool failure stringifiable instead of throwing", async () => {
    const host = makeHost({
      toolResult: { error: "Command failed with exit code: 1" },
    });
    const sandbox = open(host);
    const result = await sandbox.run(
      [
        "const r = await Some({});",
        'return [typeof r, r.error, String(r), `${r}`].join("|");',
      ].join("\n"),
      opts(["Some"]),
    );
    expect(result.value).toBe(
      "object|Command failed with exit code: 1|[object Object]|[object Object]",
    );
  });

  it("keeps the host copy isolated from script mutations", async () => {
    const shared = { a: 1, nested: { b: 2 } };
    const host = makeHost({ toolResult: shared });
    const sandbox = open(host);
    const result = await sandbox.run(
      "const r = await Some({}); r.nested.b = 99; return r.nested.b",
      opts(["Some"]),
    );
    expect(result.value).toBe("99");
    expect(shared.nested.b).toBe(2);
  });

  it("truncates arrays past 4096 entries and reports truncatedFrom", async () => {
    const sandbox = open();
    const outbound = await sandbox.run(
      "return Array.from({ length: 5000 }, (_, i) => i)",
      opts(),
    );
    const parsed = JSON.parse(outbound.value as string) as {
      items: number[];
      truncatedFrom: number;
    };
    expect(parsed.items).toHaveLength(4096);
    expect(parsed.items[0]).toBe(0);
    expect(parsed.truncatedFrom).toBe(5000);

    const host = makeHost({ toolResult: { big: new Array(5000).fill(1) } });
    const inboundSandbox = open(host);
    const inbound = await inboundSandbox.run(
      "const r = await Big({}); return r.big.items.length + ':' + r.big.truncatedFrom",
      opts(["Big"]),
    );
    expect(inbound.value).toBe("4096:5000");
  });

  it("reports a clear error for a circular return value", async () => {
    const sandbox = open();
    const result = await sandbox.run(
      "const a = {}; a.self = a; return a",
      opts(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("circular reference");
  });
});

describe("repl sandbox: sealed context", () => {
  it("leaves host globals undefined", async () => {
    const sandbox = open();
    const result = await sandbox.run(
      "return [typeof require, typeof process, typeof Buffer, typeof module, typeof fetch, typeof XMLHttpRequest].join(',')",
      opts(),
    );
    expect(result.value).toBe(
      "undefined,undefined,undefined,undefined,undefined,undefined",
    );
  });

  it("refuses eval and new Function", async () => {
    const sandbox = open();
    const viaEval = await sandbox.run("return eval('1 + 1')", opts());
    expect(viaEval.ok).toBe(false);
    expect(viaEval.error).toContain("EvalError");

    const viaFunction = await sandbox.run(
      'return new Function("return 1")()',
      opts(),
    );
    expect(viaFunction.ok).toBe(false);
    expect(viaFunction.error).toContain("EvalError");
  });

  it("hands out only realm callables, so .constructor cannot re-enter the host", async () => {
    const sandbox = open(makeHost({ tools: ["Read"] }));
    const escape = await sandbox.run(
      'return Read.constructor("return process")()',
      opts(["Read"]),
    );
    expect(escape.ok).toBe(false);
    expect(escape.error).toContain("EvalError");

    const realm = await sandbox.run(
      [
        "return [",
        "Read.constructor === Function,",
        "preview.constructor === Function,",
        "$.constructor === Function,",
        "console.log.constructor === Function,",
        "setTimeout.constructor === Function,",
        "Object.isFrozen(Function),",
        "Object.isFrozen(Object)",
        '].join("|")',
      ].join("\n"),
      opts(["Read"]),
    );
    expect(realm.value).toBe("true|true|true|true|true|true|true");
  });

  it("rejects all three module forms before the script runs", async () => {
    const sandbox = open();
    const scripts = [
      'import fs from "node:fs";',
      'await import("node:fs");',
      'require("node:fs");',
    ];
    for (const script of scripts) {
      const result = await sandbox.run(script, opts());
      expect(result.ok).toBe(false);
      expect(result.rejected).toBeUndefined();
      expect(result.error).toContain("sealed");
      // Claude Code's shape: names the pool's tools, never a flat-only one (Read
      // while enableReplCoreTools is off).
      expect(result.error).toContain("Glob({ pattern");
      expect(result.error).toContain("Grep({ pattern");
      expect(result.error).not.toContain("Read({");
    }
  });

  it("rejects a top-level declaration that would overwrite a helper, a tool or a built-in", async () => {
    const host = makeHost({ tools: ["Read"] });
    const sandbox = open(host);

    const builtin = await sandbox.run(
      "const Read = 1; return 2",
      opts(["Read"]),
    );
    expect(builtin).toMatchObject({ ok: false, rejected: true });
    expect(builtin.error).toContain("ReplGlobalOverwrite");
    expect(builtin.error).toContain("declare it inside a function");
    expect(host.state.toolCalls).toHaveLength(0);

    const jsBuiltin = await sandbox.run("function Object() {}", opts());
    expect(jsBuiltin.rejected).toBe(true);
    expect(jsBuiltin.error).toContain("Object");

    const helper = await sandbox.run("const preview = 1", opts());
    expect(helper.rejected).toBe(true);
  });

  it("lets a later script reuse a name an earlier script defined", async () => {
    // The reservation set is built-ins, helpers and tool names — frozen when the
    // context was made. An earlier script's own variable is not in it, so declaring
    // the name again simply overwrites it, which is what Claude Code does (2.1.326
    // `za` filters top-level declarations through `isGlobalName` only).
    const sandbox = open();

    const first = await sandbox.run("const kept = 1", opts());
    expect(first.rejected).toBeUndefined();

    const redeclared = await sandbox.run("const kept = 2", opts());
    expect(redeclared.rejected).toBeUndefined();
    expect(redeclared.ok).toBe(true);

    const read = await sandbox.run("return kept", opts());
    expect(read.value).toBe("2");

    // A function can be replaced the same way.
    await sandbox.run("function twice(n) { return n * 2 }", opts());
    const replaced = await sandbox.run(
      "function twice(n) { return n * 3 } return twice(2)",
      opts(),
    );
    expect(replaced.value).toBe("6");
  });

  it("still refuses a helper name after a script defined its own", async () => {
    // Reusing a script's own name must not widen into reusing a helper's: the
    // helpers are installed on the global object itself, and only the three
    // reserved categories are refusable.
    const host = makeHost({ tools: ["Read"] });
    const sandbox = open(host);

    await sandbox.run("const kept = 1", opts());
    const helper = await sandbox.run("const log = 2", opts());
    expect(helper.rejected).toBe(true);
    expect(helper.error).toContain("log");
  });

  it("resets the context when a managed global becomes non-configurable", async () => {
    const sandbox = open();
    await sandbox.run("const kept = 7", opts());

    const poison = await sandbox.run(
      'Object.defineProperty(globalThis, "console", { value: 1, configurable: false }); return "poisoned"',
      opts(),
    );
    expect(poison.value).toBe("poisoned");

    const next = await sandbox.run("return typeof kept", opts());
    expect(next.ok).toBe(false);
    expect(next.error).toContain("REPL context was reset");
    expect(next.error).toContain("Re-run the script");

    const after = await sandbox.run("return 1 + 1", opts());
    expect(after.value).toBe("2");
  });

  it("resets the context when globalThis itself is broken", async () => {
    const sandbox = open();
    const poison = await sandbox.run(
      'Object.defineProperty(globalThis, "globalThis", { value: 5 }); return "poisoned"',
      opts(),
    );
    expect(poison.value).toBe("poisoned");

    const next = await sandbox.run("return 1", opts());
    expect(next.ok).toBe(false);
    expect(next.error).toContain("REPL context was reset");
  });
});

describe("repl sandbox: globals", () => {
  it("installs bare tool globals, tools members and tools.list()", async () => {
    const host = makeHost({ tools: ["Read", "weird-name"] });
    const sandbox = open(host);
    const result = await sandbox.run(
      [
        'return [typeof Read, typeof tools.Read, typeof tools["weird-name"],',
        '  tools.list().join(","), typeof sharedMissing].join("|");',
      ].join("\n"),
      opts(["Read", "weird-name"]),
    );
    expect(result.value).toBe(
      "function|function|function|Read,weird-name|undefined",
    );
  });

  it("adds and removes tool members when the pool changes", async () => {
    const host = makeHost({ tools: ["Read", "Write"] });
    const sandbox = open(host);

    const withWrite = await sandbox.run(
      "return typeof Write",
      opts(["Read", "Write"]),
    );
    expect(withWrite.value).toBe("function");

    const withoutWrite = await sandbox.run(
      'return [typeof Write, typeof tools.Write].join("|")',
      opts(["Read"]),
    );
    expect(withoutWrite.value).toBe("undefined|undefined");
  });

  it("passes tool arguments through unchanged, and rejects non-plain data", async () => {
    const host = makeHost();
    const sandbox = open(host);

    const ok = await sandbox.run(
      'await Read({ file_path: "a b", nested: { x: 1 }, when: undefined })',
      opts(["Read"]),
    );
    expect(ok.ok).toBe(true);
    expect(host.state.toolCalls[0]).toEqual({
      name: "Read",
      args: { file_path: "a b", nested: { x: 1 } },
    });

    const classInstance = await sandbox.run(
      "await Read({ when: new Date() })",
      opts(["Read"]),
    );
    expect(classInstance.ok).toBe(false);
    expect(classInstance.error).toContain("plain data");

    const fnField = await sandbox.run(
      "await Read({ cb: () => 1 })",
      opts(["Read"]),
    );
    expect(fnField.ok).toBe(false);
    expect(fnField.error).toContain("is a function");
  });

  it("raises a ReferenceError for a name that is not reachable", async () => {
    const sandbox = open();
    const result = await sandbox.run("await Nope({})", opts());
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Nope is not defined");
  });

  it("exposes searchTools, describeTool, running and self", async () => {
    const host = makeHost();
    const sandbox = open(host);
    const result = await sandbox.run(
      [
        'const found = await searchTools("read", 3);',
        "const described = await describeTool(found[0].name);",
        "const list = running();",
        'return [found.length, described.name, list[0].id, self === globalThis].join("|");',
      ].join("\n"),
      opts(),
    );
    expect(result.value).toBe("1|Read|1|true");
    expect(host.state.searchCalls[0]).toEqual({ query: "read", max: 3 });
  });

  it("keeps self.log out of the console ring, and vice versa", async () => {
    const host = makeHost();
    const sandbox = open(host);
    const result = await sandbox.run(
      [
        'self.log("hello", { a: 1 });',
        'console.log("noise-one");',
        'console.log("noise-two");',
        'console.log("noise-three");',
        'console.log("noise-four");',
        'return console.tail(2) + "|" + console.dropped();',
      ].join("\n"),
      opts(),
    );
    expect(result.logs).toEqual(['hello {"a":1}']);
    expect(host.state.selfLogs).toEqual([["hello", '{"a":1}']]);
    expect(result.value).toBe("log: noise-three\nlog: noise-four|1");
  });
});

describe("repl sandbox: $ and preview", () => {
  it("quotes interpolations one word each, honours raw, and exposes text()", async () => {
    const host = makeHost({
      shell: () => ({ stdout: "out\n", stderr: "", exitCode: 0 }),
    });
    const sandbox = open(host);
    const result = await sandbox.run(
      [
        'const who = "a b";',
        'const file = "it\'s.txt";',
        "const many = ['x y', 'z'];",
        "await $`grep ${who} ${file}`;",
        "await $`echo ${{ raw: '--flag=a b' }}`;",
        "await $`echo ${many}`;",
        "return (await $`echo hi`).text();",
      ].join("\n"),
      opts(),
    );
    expect(result.ok).toBe(true);
    expect(host.state.shellCommands).toEqual([
      "grep 'a b' 'it'\\''s.txt'",
      "echo --flag=a b",
      "echo 'x y' 'z'",
      "echo hi",
    ]);
    expect(result.value).toBe("out\n");
  });

  it("throws ShellError on a non-zero exit and resolves with nothrow()", async () => {
    const host = makeHost({
      shell: () => ({ stdout: "partial", stderr: "boom", exitCode: 2 }),
    });
    const sandbox = open(host);

    const thrown = await sandbox.run("await $`false`", opts());
    expect(thrown.ok).toBe(false);
    expect(thrown.error).toContain("ShellError");
    expect(thrown.error).toContain("boom");

    const handled = await sandbox.run(
      "const r = await $`false`.nothrow(); return r.exitCode + ':' + r.stderr + ':' + r.text()",
      opts(),
    );
    expect(handled.value).toBe("2:boom:partial");
  });

  it("carries an explicit timeout and exposes the background task", async () => {
    const host = makeHost({
      shell: () => ({
        stdout: "",
        stderr: "moved to the background",
        exitCode: null,
        running: { taskId: "bg-7", outputPath: "/tmp/bg-7.log" },
      }),
    });
    const sandbox = open(host);
    const result = await sandbox.run(
      [
        "const out = await $`bun build`.timeout(900000);",
        "return [String(out.exitCode), out.running.taskId, out.running.outputPath, out.stderr].join('|');",
      ].join("\n"),
      opts(),
    );
    expect(result.ok).toBe(true);
    expect(host.state.shellTimeouts).toEqual([900000]);
    expect(result.value).toBe(
      "null|bg-7|/tmp/bg-7.log|moved to the background",
    );
  });

  it("runs a command given as a plain string with its own timeout", async () => {
    const host = makeHost({});
    const sandbox = open(host);
    const result = await sandbox.run(
      "return (await $('echo hi', 5000)).text();",
      opts(),
    );
    expect(result.ok).toBe(true);
    expect(host.state.shellCommands).toEqual(["echo hi"]);
    expect(host.state.shellTimeouts).toEqual([5000]);
  });

  it("previews the first 200 characters by default and marks the truncation", async () => {
    const sandbox = open();
    const result = await sandbox.run('return preview("x".repeat(300))', opts());
    expect(result.value).toBe(`${"x".repeat(200)}…[+100 chars]`);

    const custom = await sandbox.run(
      'return preview("y".repeat(50), 10)',
      opts(),
    );
    expect(custom.value).toBe(`${"y".repeat(10)}…[+40 chars]`);
  });

  it("previews undefined and null as empty text", async () => {
    const sandbox = open();
    const result = await sandbox.run(
      'return preview(undefined) + "|" + preview(null)',
      opts(),
    );
    expect(result.value).toBe("|");
  });

  it("previews a saved shell result with its header first", async () => {
    const header =
      "Output too large (42000 characters). Full output saved to: /tmp/spill.txt";
    const host = makeHost({
      shell: () => ({
        stdout: "line one\nline two\n",
        stderr: "",
        exitCode: 0,
        truncated: true,
        file: "/tmp/spill.txt",
        savedOutput: { header, after: "" },
      }),
    });
    const sandbox = open(host);

    const whole = await sandbox.run(
      "return preview(await $`cat big.log`)",
      opts(),
    );
    expect(whole.value).toBe(`${header}\n\nline one\nline two`);

    const cut = await sandbox.run(
      "return preview(await $`cat big.log`, 10)",
      opts(),
    );
    expect(cut.value).toBe(`${header}\n\nline one\n...`);
  });
});

describe("repl sandbox: termination", () => {
  it("stops a synchronous spin at the sync wall clock and keeps the context", async () => {
    // The sync phase belongs to the vm `timeout` alone: letting the step counter
    // check the same clock — its deadline starts at the same `timeoutMs` — makes
    // the two trip on the same millisecond. Whichever loses rejects the run
    // promise, and when that lands before the wrapper attached its quiet handler
    // the rejection surfaces as an unhandled one the caller never sees (it hit
    // `check (agent-sdk, 2)` once in 400 spins). The counter takes over only
    // after `runInContext` has handed the promise back.
    let stepErrors = 0;
    const host = makeHost();
    const counting: ReplSandboxHost = {
      ...host,
      stepError: () => {
        stepErrors += 1;
        return host.stepError();
      },
    };
    const sandbox = open(counting);
    await sandbox.run("const before = 1", opts());

    // Repeated because the race is a millisecond-wide window, not a state; every
    // round is a fresh chance for the counter to fire first.
    for (let i = 0; i < 60; i++) {
      const spun = await sandbox.run("while (true) {}", {
        toolNames: [],
        timeoutMs: 2,
      });
      expect(spun.ok).toBe(false);
      expect(spun.error).toContain("wall clock 2 ms");
    }
    // vm stopped every one of them: the counter never fired in the sync phase.
    expect(stepErrors).toBe(0);

    const after = await sandbox.run("return before", opts());
    expect(after.value).toBe("1");
  });

  it("stops a spinning loop at the step budget", async () => {
    setReplStepBudget(2_000);
    const sandbox = open();
    const result = await sandbox.run("let i = 0; while (true) { i++ }", {
      toolNames: [],
      timeoutMs: 5_000,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("step budget");
  });

  it("stops a spin that starts after an await, where vm's timeout no longer applies", async () => {
    const sandbox = open();
    const result = await sandbox.run("await 0;\nwhile (true) {}", {
      toolNames: [],
      timeoutMs: 100,
    });
    expect(result.ok).toBe(false);
    // The message is the host's step error, not vm's ERR_SCRIPT_EXECUTION_TIMEOUT:
    // proof that the injected counter stopped it.
    expect(result.error).toContain("step budget");
    expect(result.error).not.toContain("wall clock");
  });

  it("counts only the synchronous segments against the timeout", async () => {
    const host = makeHost({
      behavior: async () => {
        await sleep(120);
        return { ok: true };
      },
    });
    const sandbox = open(host);
    // The call takes longer than `timeoutMs`, and the work after it would trip a
    // deadline that had not been refreshed when the host handed control back.
    const result = await sandbox.run(
      [
        "const out = await Slow({});",
        "let total = 0;",
        "for (let k = 0; k < 20000; k++) { total += k }",
        "return out.ok + ':' + total",
      ].join("\n"),
      { toolNames: ["Slow"], timeoutMs: 50 },
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe("true:199990000");
  });

  it("returns as soon as the run is aborted, without disposing the context", async () => {
    const host = makeHost({ behavior: () => new Promise(() => {}) });
    const sandbox = open(host);
    await sandbox.run("const kept = 5", opts());

    const controller = new AbortController();
    const pendingRun = sandbox.run("await Slow({})", {
      toolNames: ["Slow"],
      timeoutMs: 5_000,
      abortSignal: controller.signal,
    });
    setTimeout(() => controller.abort(), 10);
    const aborted = await pendingRun;
    expect(aborted.ok).toBe(false);
    expect(aborted.error).toBe("REPL script was aborted.");

    const after = await sandbox.run("return kept", opts());
    expect(after.value).toBe("5");
  });

  it("reports a syntax error and keeps the context", async () => {
    const sandbox = open();
    const broken = await sandbox.run("const = 1", opts());
    expect(broken.ok).toBe(false);
    expect((broken.error ?? "").toLowerCase()).toContain("syntax error");
    // A position alone reads as "the statements above it ran"; the receipt has
    // to say the whole script was rejected.
    expect(broken.error ?? "").toContain(
      "The script did not run: it failed to parse, so nothing in it was executed.",
    );
    expect((await sandbox.run("return 3", opts())).value).toBe("3");
  });

  it("points at the failing line and warns about the outer template literal", async () => {
    const sandbox = open();
    // A shell default-value expansion inside an outer template literal: the
    // shape that made a real probe script fail to parse. `${V:-x}` is read as
    // an interpolation and `V:` is where acorn stops.
    const result = await sandbox.run(
      [
        "const w = `const cases = [",
        '  "DIR=/tmp/wave-${V:-x}; rm -rf $DIR",',
        "];`;",
      ].join("\n"),
      opts(),
    );
    expect(result.ok).toBe(false);
    const text = result.error ?? "";
    expect(text).toContain("at line 2, column 21");
    expect(text).toContain('"DIR=/tmp/wave-${V:-x}; rm -rf $DIR",');
    expect(text).toContain("template literal");
  });

  it("adds no hint when the source holds no backtick", async () => {
    const sandbox = open();
    const result = await sandbox.run("const = 1", opts());
    const text = result.error ?? "";
    expect(text).toContain("Script syntax error:");
    expect(text).not.toContain("Hint:");
  });

  it("warns when an empty template literal called the next one as a tag", async () => {
    const sandbox = open();
    // `` `a``b` `` parses: the empty-ish first literal ends at its backtick, so the
    // next literal tags it and a string is called.
    const result = await sandbox.run("const s = `a``b`;", opts());
    expect(result.ok).toBe(false);
    const text = result.error ?? "";
    expect(text).toContain("is not a function");
    expect(text).toContain("two backticks in a row");
  });

  it("adds no runtime hint when the source holds no doubled backtick", async () => {
    const sandbox = open();
    const result = await sandbox.run("throw new TypeError('boom')", opts());
    const text = result.error ?? "";
    expect(text).toContain("boom");
    expect(text).not.toContain("Hint:");
  });

  it("maps an error inside a loop back to the line the script wrote", async () => {
    const sandbox = open();
    const result = await sandbox.run(
      [
        "const rows = [1, 2, 3];",
        "for (const row of rows) {",
        '  if (row === 2) throw new Error("row two");',
        "}",
      ].join("\n"),
      opts(),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain("row two");
    expect(result.error).toContain(
      '  in <anonymous> (line 3): if (row === 2) throw new Error("row two");',
    );
    expect(result.error).not.toContain("repl-script.js");
  });

  it("quotes up to four script frames and leaves the wrapper's own out", async () => {
    const sandbox = open();
    const result = await sandbox.run(
      [
        "function a() {",
        "  b();",
        "}",
        "function b() {",
        "  c();",
        "}",
        "function c() {",
        "  d();",
        "}",
        "function d() {",
        '  throw new Error("deep");',
        "}",
        "a();",
      ].join("\n"),
      opts(),
    );
    expect(result.ok).toBe(false);
    const text = result.error ?? "";
    expect(text).toContain(
      "deep\nThrown at (statements quoted from the script):",
    );
    expect(text.split("\n").filter((line) => line.startsWith("  in "))).toEqual(
      [
        '  in d (line 11): throw new Error("deep");',
        "  in c (line 8): d();",
        "  in b (line 5): c();",
        "  in a (line 2): b();",
      ],
    );
    expect(text).not.toContain("line 13");
    expect(text).not.toMatch(/:\d+:\d+/);
  });

  it("keeps one of consecutive identical frames", async () => {
    const sandbox = open();
    const result = await sandbox.run(
      [
        'function f(n) { if (n === 0) throw new Error("bottom"); f(n - 1); }',
        "f(3);",
      ].join("\n"),
      opts(),
    );
    const text = result.error ?? "";
    const quoted = text.split("\n").filter((line) => line.startsWith("  in "));
    expect(quoted).toEqual([
      '  in f (line 1): function f(n) { if (n === 0) throw new Error("bottom"); f(n - 1); }',
      "  in <anonymous> (line 2): f(3);",
    ]);
  });
});
