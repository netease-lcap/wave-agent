import { afterEach, describe, expect, it, vi } from "vitest";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ReplPoolEntry } from "../../src/repl/catalog.js";
import {
  REPL_ASYNC_CONCURRENCY_LIMIT,
  REPL_ASK_MODE_TOTAL_MS,
  REPL_DEFAULT_NATIVE_TIMEOUT_MS,
  REPL_BACKGROUND_MAX_MS,
  REPL_MAX_IMAGES,
  REPL_MAX_PDFS,
  REPL_MAX_TIMEOUT_MS,
  REPL_SHELL_DEFAULT_WAIT_MS,
  REPL_SYNC_WAIT_MS,
} from "../../src/repl/constants.js";
import {
  drainReplEvents,
  disposeReplRuntime,
  listRunningReplScripts,
  replPendingEventCount,
  runReplScript,
  waitForReplEvents,
  type RunReplOptions,
  type ReplRunResult,
} from "../../src/repl/replRuntime.js";
import { setReplStepBudget } from "../../src/repl/replSandbox.js";
import type { ToolContext, ToolResult } from "../../src/tools/types.js";
import { buildPersistedOutputMessage } from "../../src/utils/toolResultStorage.js";

/**
 * Directories that really exist, for `.cwd()`: the directory of this file and the
 * package root above it. Resolved from the module URL rather than the process
 * cwd, so the test does not depend on where vitest was started.
 */
const REPL_TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));
const AGENT_SDK_ROOT = path.resolve(REPL_TESTS_DIR, "..", "..");

/**
 * The host side of the REPL, exercised through the real sandbox.
 *
 * Nothing here mocks `node:vm`: the value of a test at this level is that a
 * script crosses the boundary for real — the assertion is about what the *model*
 * reads (the value, the logs, the failure text), not about an internal call. The
 * only test double is the tool layer beneath the two funnels (`ToolManager.execute`
 * and `McpManager.executeMcpTool`), which is exactly the seam the runtime is
 * supposed to go through.
 */

const POOL: ReplPoolEntry[] = [
  { name: "Echo", description: "Echo back the arguments it was given" },
  { name: "Fail", description: "Answer with a failure result" },
  { name: "Slow", description: "Wait for the host to answer" },
  { name: "Pic", description: "Return an image attachment" },
  {
    name: "mcp__srv__boom",
    isMcp: true,
    description: "An MCP tool that throws",
  },
];

function ok(content: string): ToolResult {
  // A built-in hands the script its `data`, not the text the model reads (spec
  // core/repl-tool.md「在 REPL 里编排一轮内的多步调用」场景 2). This fixture is a
  // tool whose structured result happens to be that same string.
  return { success: true, content, data: content };
}

type Behavior = (
  name: string,
  args: Record<string, unknown>,
  toolContext: ToolContext,
) => ToolResult | Promise<ToolResult>;

type McpBehavior = (name: string, args: Record<string, unknown>) => unknown;

interface Harness {
  context: ToolContext;
  /** Every built-in call the runtime actually dispatched, in order. */
  dispatched: Array<{ name: string; args: Record<string, unknown> }>;
  /** The context each built-in call ran under, in order (`$` derives one). */
  contexts: ToolContext[];
  /** Every MCP call, in order. */
  mcpCalls: Array<{ name: string; args: Record<string, unknown> }>;
}

/**
 * The tool layer, with both funnels replaced by plain functions.
 *
 * `dispatched.length` is the number of calls that were *answered*: a call the
 * budget, the limit or the abort grace declines never reaches the tool.
 */
function harness(
  behavior: Behavior = () => ok("built-in"),
  mcpBehavior: McpBehavior = () => ok("mcp"),
): Harness {
  const dispatched: Harness["dispatched"] = [];
  const contexts: Harness["contexts"] = [];
  const mcpCalls: Harness["mcpCalls"] = [];
  const context = {
    workdir: "/tmp",
    toolManager: {
      execute: (
        name: string,
        args: Record<string, unknown>,
        toolContext: ToolContext,
      ) => {
        dispatched.push({ name, args });
        contexts.push(toolContext);
        return Promise.resolve().then(() => behavior(name, args, toolContext));
      },
      getReplPool: () => POOL,
    },
    mcpManager: {
      executeMcpTool: (name: string, args: Record<string, unknown>) => {
        mcpCalls.push({ name, args });
        return Promise.resolve().then(() => mcpBehavior(name, args));
      },
    },
  } as unknown as ToolContext;
  return { context, dispatched, contexts, mcpCalls };
}

/** Context keys this file created, released after each case. */
const liveKeys = new Set<string>();
let keySeq = 0;

function newKey(): string {
  keySeq += 1;
  return `exec-runtime-${keySeq}`;
}

function runRepl(
  h: Harness,
  code: string,
  overrides: Partial<RunReplOptions> = {},
): Promise<ReplRunResult> {
  const sessionKey = overrides.sessionKey ?? newKey();
  liveKeys.add(sessionKey);
  return runReplScript({
    code,
    pool: POOL,
    context: h.context,
    sessionKey,
    ...overrides,
  });
}

/** A real macrotask: lets a chain of host promises settle without moving a fake clock. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/** Under fake timers, the same thing: yield long enough for microtasks to drain. */
async function settleFake(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

/** A call that is waiting for the host: the shape of an approval dialog. */
function blocked(): Promise<ToolResult> {
  return new Promise<ToolResult>(() => {
    /* resolved by the test, or never */
  });
}

afterEach(() => {
  vi.useRealTimers();
  // Non-positive restores the sandbox's own default.
  setReplStepBudget(0);
  for (const key of liveKeys) disposeReplRuntime(key);
  liveKeys.clear();
  drainReplEvents();
});

describe("the two dispatch funnels", () => {
  it("hands a built-in failure back as a value the script can read", async () => {
    const h = harness(() => ({
      success: false,
      error: "permission denied",
      content: "Bash(rm -rf /) is not allowed",
    }));

    const result = await runRepl(
      h,
      `
      const r = await tools.Fail({});
      self.log(JSON.stringify(r));
      self.log(String(r));
      return typeof r.error;
    `,
    );

    // No throw: a refusal is ordinary operation, so the script keeps its own flow.
    expect(result.ok).toBe(true);
    expect(result.value).toBe("string");
    // `error` is the short tag, `content` the actionable half; neither is dropped.
    expect(result.logs).toEqual([
      JSON.stringify({
        error: "permission denied\nBash(rm -rf /) is not allowed",
      }),
      // Plain-realm copies (as in Claude Code): stringifying one is not a throw,
      // so a script can concatenate a failed call's value and keep going.
      "[object Object]",
    ]);
    expect(result.toolsUsed).toEqual(["Fail"]);
  });

  it("does not judge a script call by this request's flat declarations", async () => {
    const h = harness();
    // What the host really carries: the names `tools[]` declared. A pooled tool is
    // by definition missing from it, and a script's call is second-hop, so the set
    // must not follow the frame in — otherwise every `tools.Echo(...)` and every
    // `$` would be rejected as an undeclared model call (spec
    // `core/repl-tool.md`「开关把核心文件与 shell 工具也收进 REPL」场景 5).
    (h.context as ToolContext).declaredToolNames = new Set(["REPL"]);

    const result = await runRepl(h, `return await tools.Echo({ a: 1 });`);

    expect(result.ok).toBe(true);
    expect(h.dispatched).toEqual([{ name: "Echo", args: { a: 1 } }]);
    expect(h.contexts[0].declaredToolNames).toBeUndefined();
  });

  it("throws an MCP failure into the script instead of returning it", async () => {
    const h = harness(undefined, () => {
      throw new Error(
        'Tool execution failed: {"code":500,"message":"upstream down"}',
      );
    });

    const result = await runRepl(
      h,
      `
      try {
        await tools["mcp__srv__boom"]({});
        self.log("did not throw");
      } catch (e) {
        self.log(e.message);
      }
      return "after";
    `,
    );

    expect(result.ok).toBe(true);
    expect(result.value).toBe("after");
    expect(result.logs[0]).toContain(
      'MCP tool "mcp__srv__boom" failed; this is a tool failure, not a script error.',
    );
  });

  it("fails the script with the annotated message when an MCP error is uncaught", async () => {
    const h = harness(undefined, () => {
      throw new Error("upstream down");
    });

    const result = await runRepl(
      h,
      `return await tools["mcp__srv__boom"]({});`,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("upstream down");
    expect(result.error).toContain('MCP tool "mcp__srv__boom" failed');
  });

  it("keeps the hook's own wording for an MCP call a hook refused", async () => {
    const h = harness(undefined, () => {
      throw new Error(
        "PreToolUse:mcp__srv__boom hook error: blocked by policy",
      );
    });

    const result = await runRepl(
      h,
      `return await tools["mcp__srv__boom"]({});`,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("PreToolUse:mcp__srv__boom hook error");
    // The tool-failure clarification would be noise on a deliberate refusal.
    expect(result.error).not.toContain("not a script error");
  });

  it("parses an MCP answer that is JSON text into the value the script reads", async () => {
    const h = harness(undefined, () => ({
      output: '{"items":[{"id":1},{"id":2}],"total":2}',
      images: [],
    }));

    const result = await runRepl(
      h,
      `
      const r = await tools["mcp__srv__boom"]({});
      return [typeof r, r.items.length, r.total];
    `,
    );

    // A server that answers in JSON text hands the script the parsed value: the
    // caller reads a field instead of `JSON.parse`-ing every answer (spec
    // core/repl-tool.md「在 REPL 里编排一轮内的多步调用」场景 2).
    expect(result.ok).toBe(true);
    expect(JSON.parse(result.value as string)).toEqual(["object", 2, 2]);
  });

  it("keeps an MCP answer that is not JSON as the text it was", async () => {
    const h = harness(undefined, () => ({
      output: "nothing to report",
      images: [],
    }));

    const result = await runRepl(
      h,
      `
      const r = await tools["mcp__srv__boom"]({});
      return [typeof r, r];
    `,
    );

    expect(JSON.parse(result.value as string)).toEqual([
      "string",
      "nothing to report",
    ]);
  });

  it("hands structured content through without a text pass", async () => {
    const h = harness(undefined, () => ({
      output: { items: [1] },
      images: [],
    }));

    const result = await runRepl(
      h,
      `
      const r = await tools["mcp__srv__boom"]({});
      return [typeof r, r.items[0]];
    `,
    );

    expect(JSON.parse(result.value as string)).toEqual(["object", 1]);
  });

  it("leaves a name outside the pool undefined", async () => {
    const h = harness();

    const result = await runRepl(h, `return Nope();`);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Nope is not defined");
    // The engine's own error, and nothing more: a host-side "search for it" hint
    // would invite the model to look for a tool it was never granted.
    expect(result.error).toContain("ReferenceError");
    expect(result.error).not.toContain("searchTools");
    expect(h.dispatched).toEqual([]);
  });

  it("leaves the same name undefined on `tools`, as a TypeError", async () => {
    const h = harness();

    const result = await runRepl(h, `return await tools.Nope({});`);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("tools.Nope is not a function");
    expect(result.error).not.toContain("searchTools");
    expect(h.dispatched).toEqual([]);
  });
});

describe("the catalog, reached from the script", () => {
  it("answers searchTools with name/about/input hits and no total", async () => {
    const h = harness();

    const result = await runRepl(
      h,
      `
      const hits = await searchTools("echo");
      self.log(JSON.stringify(hits));
      return hits.length;
    `,
    );

    expect(result.value).toBe("1");
    const hits = JSON.parse(result.logs[0]) as Array<Record<string, unknown>>;
    expect(hits).toHaveLength(1);
    expect(hits[0].name).toBe("Echo");
    expect(hits[0].about).toContain("Echo back");
    expect(typeof hits[0].input).toBe("string");
    // A capped hit list is not a count of matches: there is no `total`. The fourth
    // field is the return type, which is what lets the script go straight on to
    // reading `r.<field>` instead of probing the shape first.
    expect(Object.keys(hits[0]).sort()).toEqual([
      "about",
      "input",
      "name",
      "output",
    ]);
  });

  it("answers describeTool with the schema, and with { error } for a miss", async () => {
    const h = harness();

    const result = await runRepl(
      h,
      `
      const one = await describeTool("Echo");
      self.log(JSON.stringify(Object.keys(one).sort()));
      self.log(typeof one.inputSchema);
      const miss = await describeTool("Nope");
      self.log(JSON.stringify(Object.keys(miss)));
      return typeof miss.error;
    `,
    );

    expect(result.value).toBe("string");
    expect(JSON.parse(result.logs[0])).toEqual([
      "description",
      "inputSchema",
      "name",
      "output",
    ]);
    // A JSON Schema object the script can walk, not a rendering of one.
    expect(result.logs[1]).toBe("object");
    expect(JSON.parse(result.logs[2])).toEqual(["error"]);
  });

  it("hands searchTools' usage error to the script instead of swallowing it", async () => {
    const h = harness();

    const result = await runRepl(
      h,
      `
      try {
        await searchTools("");
        self.log("did not throw");
      } catch (e) {
        self.log(e.message);
      }
      return "after";
    `,
    );

    expect(result.value).toBe("after");
    expect(result.logs[0]).toContain("searchTools: pass the words to look for");
  });

  it("lists the reachable tool names without an await", async () => {
    const h = harness();

    const result = await runRepl(h, `return tools.list().join(",");`);

    expect(result.ok).toBe(true);
    expect(result.value).toBe("Echo,Fail,Pic,Slow,mcp__srv__boom");
  });

  it("reports a helper lookup to the row without counting it as a call", async () => {
    // Spec「在沙箱内搜索工具形状」场景 13: the helpers are not tool calls — no
    // permission decision, no hook, no budget — but the row still has to show them
    // instead of staying silent, which is why they reach `onToolCall` at all. The
    // kind is what lets the caller print the line without inflating the count.
    const h = harness();
    const seen: Array<{
      name: string;
      args: Record<string, unknown>;
      kind: string;
    }> = [];

    const result = await runRepl(
      h,
      `
      await searchTools("echo");
      await Echo({ ping: true });
      await describeTool("Nope");
      return "after";
      `,
      {
        onToolCall: (name, args, kind) => seen.push({ name, args, kind }),
      },
    );

    expect(result.ok).toBe(true);
    expect(seen).toEqual([
      { name: "searchTools", args: { query: "echo" }, kind: "helper" },
      { name: "Echo", args: { ping: true }, kind: "call" },
      { name: "describeTool", args: { name: "Nope" }, kind: "helper" },
    ]);
    // One real call: the helpers spent no budget and reached no tool.
    expect(result.toolCalls).toBe(1);
    expect(result.toolsUsed).toEqual(["Echo"]);
    expect(h.dispatched).toEqual([{ name: "Echo", args: { ping: true } }]);
  });

  it("reports a failed lookup as well, instead of going quiet", async () => {
    // `searchTools("")` throws its usage error into the script. The lookup still
    // happened, so the row is told about it before the throw.
    const h = harness();
    const seen: string[] = [];

    const result = await runRepl(
      h,
      `
      try { await searchTools(""); } catch (error) { self.log(error.message); }
      return "after";
      `,
      { onToolCall: (name) => seen.push(name) },
    );

    expect(result.ok).toBe(true);
    expect(seen).toEqual(["searchTools"]);
    expect(result.logs[0]).toContain("searchTools: pass the words to look for");
  });
});

describe("$ — the shell template", () => {
  it("runs the command through the Bash tool and returns pure data", async () => {
    const h = harness(() => ({
      success: true,
      content: "hi\n",
      data: { exitCode: 0 },
    }));

    const result = await runRepl(
      h,
      `
      const out = await $\`echo hi\`;
      self.log(out.stdout.trim(), String(out.exitCode), out.command);
      return typeof out;
    `,
    );

    expect(result.ok).toBe(true);
    expect(h.dispatched).toEqual([
      {
        name: "Bash",
        args: { command: "echo hi", timeout: REPL_SHELL_DEFAULT_WAIT_MS },
      },
    ]);
    expect(result.logs).toEqual(["hi 0 echo hi"]);
    expect(result.value).toBe("object");
    // The command is an inner call like any other: it shows up in the summary.
    expect(result.toolsUsed).toEqual(["Bash"]);
  });

  it("turns a non-zero exit into a catchable ShellError", async () => {
    const h = harness(() => ({
      success: false,
      content: "boom",
      error: "Command failed with exit code: 2",
      data: { exitCode: 2 },
    }));

    const result = await runRepl(
      h,
      `
      try {
        await $\`exit 2\`;
        self.log("did not throw");
      } catch (e) {
        self.log(e.name, String(e.exitCode));
      }
      return "after";
    `,
    );

    expect(result.ok).toBe(true);
    expect(result.value).toBe("after");
    expect(result.logs).toEqual(["ShellError 2"]);
  });

  it("hands a command that outlived its wait back as a running task", async () => {
    const h = harness(() => ({
      success: true,
      content:
        "Command exceeded the timeout (600s) and was moved to the background with ID: bg-1.",
      backgroundTaskId: "bg-1",
    }));

    const result = await runRepl(
      h,
      `
      const out = await $\`bun build\`.timeout(900000);
      self.log(String(out.exitCode), out.running.taskId, typeof out.running.outputPath, String(out.running.movedByUser));
      return out.stdout === "" ? "empty" : out.stdout;
    `,
    );

    expect(result.ok).toBe(true);
    // A longer wait than the 600000 ms default is the command's own to declare.
    expect(h.dispatched[0].args.timeout).toBe(900000);
    // exitCode null is not a failure: the script is answered and carries on.
    expect(result.logs).toEqual(["null bg-1 string undefined"]);
    expect(result.value).toBe("empty");
  });

  it("says so when the user moved the command to the background", async () => {
    const h = harness(() => ({
      success: true,
      content: "Command was moved to the background with ID: bg-2.",
      backgroundTaskId: "bg-2",
      backgroundedByUser: true,
    }));

    const result = await runRepl(
      h,
      `
      const out = await $\`bun build\`;
      self.log(String(out.exitCode), out.running.taskId, String(out.running.movedByUser));
      return out.running.movedByUser === true ? "user" : "not-user";
    `,
    );

    expect(result.ok).toBe(true);
    // A user who pressed Ctrl+B is told apart from the wait running out, so the
    // script does not read that decision as its own timeout.
    expect(result.logs).toEqual(["null bg-2 true"]);
    expect(result.value).toBe("user");
  });

  it("refuses $ when the context has no tool manager to run it", async () => {
    const h = harness();
    h.context = { workdir: "/tmp" } as unknown as ToolContext;

    const result = await runRepl(h, `await $\`echo hi\`; return "after";`);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot run a command here");
  });

  it("reads the output as lines, and as parsed JSON", async () => {
    const h = harness(() => ({
      success: true,
      content: '{"a":1}',
      data: { exitCode: 0 },
    }));

    const result = await runRepl(
      h,
      `
      const out = await $\`cat x.json\`;
      self.log(out.lines().join("|"), String(out.json().a));
      const parsed = await $\`cat x.json\`.json();
      return String(parsed.a);
    `,
    );

    expect(result.ok).toBe(true);
    // No trailing empty entry, and the reader works before and after the await.
    expect(result.logs).toEqual(['{"a":1} 1']);
    expect(result.value).toBe("1");
  });

  it("rejects .json() with a SyntaxError that names the parse failure", async () => {
    const h = harness(() => ({
      success: true,
      content: "not json, a log line",
      data: { exitCode: 0 },
    }));

    const result = await runRepl(
      h,
      `
      try {
        await $\`cat x\`.json();
        self.log("did not throw");
      } catch (e) {
        self.log(e.name, e.message.indexOf("not JSON") === -1 ? e.message : "named");
      }
      return "after";
    `,
    );

    expect(result.ok).toBe(true);
    expect(result.logs).toEqual(["SyntaxError named"]);
  });

  it("shows stdout, the tool's reading and the exit code in output", async () => {
    // The tool appends `Exit code 2` to stdout (CC does the same in its Bash tool);
    // `$` renders `[exit 2]` itself, so it strips the tool's line first — otherwise
    // the same fact shows up twice.
    const h = harness(() => ({
      success: false,
      content: "boom\nExit code 2",
      error: "Command failed with exit code: 2",
      data: { exitCode: 2 },
    }));

    const result = await runRepl(
      h,
      `const out = await $\`false\`.nothrow(); return out.output;`,
    );

    expect(result.value).toBe(
      "boom\n[stderr] Command failed with exit code: 2\n[exit 2]",
    );
  });

  it("gives a silent command empty stdout rather than the sentence the tool writes", async () => {
    // `Bash` answers a command that printed nothing with a sentence, so a model
    // reading only the tool result learns it ended. A script reads `stdout` as data,
    // and prose there would be a lie about what the command printed.
    const h = harness(() => ({
      success: true,
      content: "Command executed with exit code: 0",
      data: { exitCode: 0 },
    }));

    const result = await runRepl(
      h,
      `
      const viaDollar = await $\`true\`;
      const viaTool = await Echo({});
      return JSON.stringify([viaDollar.stdout, viaDollar.output, viaTool]);
    `,
    );

    // Claude Code's shell result: nothing at all reads as `[exit 0]`, and no exit
    // line appears when there was output. The built-in hands the script its `data`,
    // so the sentence the tool writes for a model never reaches `stdout` at all.
    expect(JSON.parse(result.value as string)).toEqual([
      "",
      "[exit 0]",
      { exitCode: 0 },
    ]);
  });

  it("keeps the sentence when the command printed it", async () => {
    const h = harness(() => ({
      success: true,
      content: "first line\nCommand executed with exit code: 0",
      data: { exitCode: 0 },
    }));

    const result = await runRepl(
      h,
      `const out = await $\`true\`; return out.stdout;`,
    );

    expect(result.value).toBe("first line\nCommand executed with exit code: 0");
  });

  it("keeps it even as the whole output, because the tool says it printed", async () => {
    // Found on a real machine: `echo 'Command executed with exit code: 0'` came
    // back as an empty `stdout`, since the command's entire output looked exactly
    // like `Bash`'s own filler. `shortResult` is derived from the raw streams, so
    // it is present exactly when there was something to print.
    const h = harness(() => ({
      success: true,
      content: "Command executed with exit code: 0",
      shortResult: "Command executed with exit code: 0",
      data: { exitCode: 0 },
    }));

    const result = await runRepl(
      h,
      `const out = await $\`true\`; return JSON.stringify([out.stdout, out.output]);`,
    );

    expect(JSON.parse(result.value as string)).toEqual([
      "Command executed with exit code: 0",
      "Command executed with exit code: 0",
    ]);
  });

  it("takes the cd note off stdout and hands it back as cwdNote", async () => {
    // A command that also `cd`s gets the tool's note in front of its result, so
    // the text is no longer the tool's own sentence and the empty-output strip
    // used to leave both in `stdout` (found on a real machine). The note is split
    // out first, then the sentence is stripped as usual.
    const target = path.resolve("/tmp", "wave-elsewhere");
    const h = harness((_name, _args, ctx) => {
      ctx.onCwdChange?.(target);
      return {
        success: true,
        content:
          `Shell working directory changed to ${target}\n` +
          "Command executed with exit code: 0",
        data: { exitCode: 0 },
      };
    });
    h.context.onCwdChange = () => {};

    const result = await runRepl(
      h,
      `
      const out = await $\`cd elsewhere\`;
      return JSON.stringify([out.stdout, out.output, out.cwdNote]);
    `,
    );

    expect(JSON.parse(result.value as string)).toEqual([
      "",
      "[exit 0]",
      `Shell working directory changed to ${target}`,
    ]);
  });

  it("recognises the reset form of the note too", async () => {
    const target = path.resolve("/tmp", "wave-original");
    const h = harness((_name, _args, ctx) => {
      ctx.onCwdChange?.(target);
      return {
        success: true,
        content: `Shell cwd was reset to ${target}\nCommand executed with exit code: 0`,
        data: { exitCode: 0 },
      };
    });
    h.context.onCwdChange = () => {};

    const result = await runRepl(
      h,
      `const out = await $\`cd outside\`; return JSON.stringify([out.stdout, out.cwdNote]);`,
    );

    expect(JSON.parse(result.value as string)).toEqual([
      "",
      `Shell cwd was reset to ${target}`,
    ]);
  });

  it("keeps every byte of a real output while the shell also moved", async () => {
    const target = path.resolve("/tmp", "wave-elsewhere");
    const printed = "line one\n  line two\n";
    const h = harness((_name, _args, ctx) => {
      ctx.onCwdChange?.(target);
      return {
        success: true,
        content: `Shell working directory changed to ${target}\n${printed}`,
        shortResult: "line one\n  line two",
        data: { exitCode: 0 },
      };
    });
    h.context.onCwdChange = () => {};

    const result = await runRepl(
      h,
      `const out = await $\`cd elsewhere; print\`; return JSON.stringify([out.stdout, out.output, out.cwdNote]);`,
    );

    expect(JSON.parse(result.value as string)).toEqual([
      printed,
      printed,
      `Shell working directory changed to ${target}`,
    ]);
  });

  it("keeps a note-looking first line when the shell never moved", async () => {
    // The strip is keyed on the tool having called `onCwdChange`, not on the
    // text: a command printing the exact sentence must not be cut.
    const printed = `Shell cwd was reset to ${path.resolve("/tmp", "x")}\nreal output`;
    const h = harness(() => ({
      success: true,
      content: printed,
      shortResult: printed,
      data: { exitCode: 0 },
    }));

    const result = await runRepl(
      h,
      `const out = await $\`print\`; return JSON.stringify([out.stdout, out.cwdNote]);`,
    );

    expect(JSON.parse(result.value as string)).toEqual([printed, null]);
  });

  it("hands the whole shell data object back, `cd` note included", async () => {
    const target = path.resolve("/tmp", "wave-elsewhere");
    const h = harness((_name, _args, ctx) => {
      ctx.onCwdChange?.(target);
      return {
        success: true,
        content: `Shell working directory changed to ${target}\nCommand executed with exit code: 0`,
        // The `cd` note has a field of its own in the tool data, which is what the
        // script receives; the text is the model-facing rendering of the same fact.
        data: {
          stdout: "",
          stderr: `Shell working directory changed to ${target}`,
          interrupted: false,
          exitCode: 0,
        },
      };
    });
    h.context.onCwdChange = () => {};

    const result = await runRepl(
      h,
      `const out = await tools.Bash({ command: "cd elsewhere" }); return out.stderr;`,
      {
        pool: [...POOL, { name: "Bash", description: "Run a shell command" }],
      },
    );

    expect(result.value).toBe(`Shell working directory changed to ${target}`);
  });

  it("hands a non-zero exit's stdout back instead of an error", async () => {
    // 报告过的现象：`tools.Bash` 只交回 `{ error }` 时，脚本里的 `r.stdout.trim()`
    // 炸成 `Cannot read properties of undefined (reading 'trim')`。退出码非零现在只是
    // 命令的答案（spec core/bash-tools.md「退出码不是工具成败」），整个 `data` 照旧交
    // 回去，读法在 `returnCodeInterpretation` 里。
    // `Exit code N` 照 CC 由工具写进 `stdout`，脚本直接读工具的 `data` 就原样看到它
    // （`$` 那条路才剥：它自己渲染 `[exit N]`，见「shows stdout, the tool's reading…」）。
    const h = harness(() => ({
      success: true,
      content: "no matches\nExit code 1",
      data: {
        stdout: "no matches\nExit code 1",
        interrupted: false,
        exitCode: 1,
        returnCodeInterpretation: "Command failed with exit code: 1",
      },
    }));

    const result = await runRepl(
      h,
      `const out = await tools.Bash({ command: "grep nope f" }); return out.stdout.trim() + "|" + String(out.exitCode);`,
      {
        pool: [...POOL, { name: "Bash", description: "Run a shell command" }],
      },
    );

    expect(result.value).toBe("no matches\nExit code 1|1");
  });

  it("hands run_in_background through to the tool and answers with its task id", async () => {
    // The pool declares the parameter (spec core/repl-tool.md「开关把核心文件与
    // shell 工具也收进 REPL」场景 6), so nothing in the sandbox may filter it: the
    // argument reaches the tool unchanged, which is what makes the declared
    // capability real instead of decorative. The tool's own half — start the task,
    // answer at once, report on the notification lane — is measured on the real
    // machine (2026-11-25) and covered by `tests/tools/bashTool.test.ts`.
    const logPath = path.join("/tmp", "wave-task-task-1.log");
    const h = harness(() => ({
      success: true,
      content: "Command running in background with ID: task-1",
      data: {
        stdout: "",
        interrupted: false,
        backgroundTaskId: "task-1",
        backgroundOutputPath: logPath,
      },
      backgroundTaskId: "task-1",
    }));

    const result = await runRepl(
      h,
      `
      const r = await tools.Bash({ command: "sleep 20; echo done", run_in_background: true });
      self.log(String(r.backgroundTaskId), String(r.backgroundOutputPath));
      return r.stdout === "" ? "empty" : r.stdout;
    `,
      {
        pool: [...POOL, { name: "Bash", description: "Run a shell command" }],
      },
    );

    expect(result.ok).toBe(true);
    // Not "the tool was asked nicely": the argument itself crossed the boundary,
    // which is the difference from the schema that used to omit it.
    expect(h.dispatched).toEqual([
      {
        name: "Bash",
        args: { command: "sleep 20; echo done", run_in_background: true },
      },
    ]);
    expect(result.logs).toEqual([`task-1 ${logPath}`]);
    // No output to show and no failure: the script continues on the task id.
    expect(result.value).toBe("empty");
  });

  it("hands a persisted output back as a preview plus the spill file", async () => {
    const filePath = path.resolve("wave-tool-results", "bash_1.txt");
    const wrapper = buildPersistedOutputMessage(
      42_000,
      filePath,
      "first line\nsecond line\n...",
    );
    const h = harness(() => ({
      success: true,
      content: wrapper,
      data: { exitCode: 0 },
    }));

    const result = await runRepl(
      h,
      `
      const out = await $\`cat big.log\`;
      self.log(String(out.truncated), out.file, "file" in out);
      self.log(out.stdout);
      self.log(preview(out));
      return out.output === out.stdout ? "same" : "differs";
    `,
    );

    expect(result.ok).toBe(true);
    // The wrapper is Bash's own message; the script gets its two facts as fields.
    expect(result.logs[0]).toBe(`true ${filePath} true`);
    expect(result.logs[1]).toBe("first line\nsecond line\n...");
    // The host hands the script a size-and-path header, so a preview of a saved
    // output still says where the rest went.
    expect(result.logs[2]).toBe(
      `Output too large (42000 characters). Full output saved to: ${filePath}\n\nfirst line\nsecond line\n...`,
    );
    expect(result.value).toBe("same");
  });

  it("leaves file off when nothing had to be persisted", async () => {
    const h = harness(() => ({
      success: true,
      content: "small",
      data: { exitCode: 0 },
    }));

    const result = await runRepl(
      h,
      `const out = await $\`echo\`; return String(out.truncated) + " " + ("file" in out);`,
    );

    expect(result.value).toBe("false false");
  });

  it("throws for a search command that exits 1, and carries the tool's reading", async () => {
    // The family table lives in the shell tools now, where CC keeps it (as
    // `returnCodeInterpretation`): `grep` finding nothing is `success: true` with exit
    // code 1, and \`$\` still throws, because CC's \`$\` "throws on a non-zero exit".
    // The tool's reading rides along in the message instead of exempting the exit.
    const h = harness(() => ({
      success: true,
      content: "",
      data: {
        stdout: "",
        exitCode: 1,
        returnCodeInterpretation: "No matches found",
      },
    }));

    const result = await runRepl(
      h,
      `
      try { await $\`grep -n needle src\`; self.log("no throw"); } catch (e) {
        self.log(e.name + ":" + e.exitCode, e.message.indexOf("[note] No matches found") === -1 ? "no note" : "note");
      }
      const miss = await $\`grep -n needle src\`.nothrow();
      return String(miss.exitCode) + " " + miss.note;
    `,
    );

    expect(result.ok).toBe(true);
    expect(result.logs).toEqual(["ShellError:1 note"]);
    expect(result.value).toBe("1 No matches found");
  });

  it("throws on any non-zero exit, note or not", async () => {
    const h = harness(() => ({
      success: true,
      content: "",
      data: { exitCode: 1, returnCodeInterpretation: "Files differ" },
    }));

    const result = await runRepl(
      h,
      `
      for (const run of [$\`git diff --stat\`, $\`exit 1\`]) {
        try { await run; self.log("no throw"); } catch (e) { self.log(e.name + ":" + e.exitCode); }
      }
      return "after";
    `,
    );

    expect(result.ok).toBe(true);
    expect(result.logs).toEqual(["ShellError:1", "ShellError:1"]);
    expect(result.value).toBe("after");
  });

  it("still throws when the call never reached the shell", async () => {
    // A denial has no exit code of its own; the fallback must not read as the
    // exit 1 of a search that found nothing.
    const h = harness(() => ({
      success: false,
      content: "",
      error: "Bash operation denied by user",
    }));

    const result = await runRepl(
      h,
      `
      try { await $\`grep x f\`; self.log("no throw"); } catch (e) { self.log(e.name); }
      return "after";
    `,
    );

    expect(result.logs).toEqual(["ShellError"]);
  });

  it("does not mutate a shell when a chain method is called on it", async () => {
    const h = harness(() => ({
      success: false,
      content: "",
      error: "Command failed with exit code: 1",
      data: { exitCode: 1 },
    }));

    const result = await runRepl(
      h,
      `
      const plain = $\`exit 1\`;
      plain.nothrow();
      try { await plain; self.log("no throw"); } catch (e) { self.log(e.name); }
      return "after";
    `,
    );

    expect(result.logs).toEqual(["ShellError"]);
  });

  it("runs .cwd() in that directory without moving the session", async () => {
    const h = harness(() => ok("hi"));
    h.context.workdir = AGENT_SDK_ROOT;

    const result = await runRepl(
      h,
      `const out = await $\`pwd\`.cwd("tests/repl"); return out.stdout;`,
    );

    expect(result.ok).toBe(true);
    // The command is what the model wrote: no `cd … &&` in front of it.
    expect(h.dispatched[0].args.command).toBe("pwd");
    expect(h.contexts[0].workdir).toBe(REPL_TESTS_DIR);
    // The session keeps its own directory, and nothing may move it from here.
    expect(h.context.workdir).toBe(AGENT_SDK_ROOT);
    expect(h.contexts[0].onCwdChange).toBeUndefined();
  });

  it("refuses a .cwd() that is not a directory, and runs nothing", async () => {
    const h = harness(() => ok("hi"));
    h.context.workdir = AGENT_SDK_ROOT;

    const result = await runRepl(
      h,
      `
      try {
        await $\`ls\`.cwd("no-such-dir-here");
        self.log("ran");
      } catch (e) {
        self.log(e.message.indexOf("not a directory") === -1 ? e.message : "refused");
      }
      return "after";
    `,
    );

    expect(result.logs).toEqual(["refused"]);
    expect(h.dispatched).toEqual([]);
  });

  it("scopes .env() to the call and leaves the command text alone", async () => {
    const h = harness(() => ok("bar"));

    const result = await runRepl(
      h,
      `const out = await $\`printenv FOO\`.env({ FOO: "bar", N: 1, ON: true }); return out.stdout;`,
    );

    expect(result.ok).toBe(true);
    expect(h.dispatched[0].args.command).toBe("printenv FOO");
    expect(h.contexts[0].sessionEnv).toEqual({
      FOO: "bar",
      N: "1",
      ON: "true",
    });
    // Only this call: the session's own context is untouched.
    expect(h.context.sessionEnv).toBeUndefined();
  });

  it("refuses an .env() key that is not a variable name", async () => {
    const h = harness(() => ok("x"));

    const result = await runRepl(
      h,
      `
      try {
        await $\`echo hi\`.env({ "FOO BAR": "1" });
        self.log("ran");
      } catch (e) {
        self.log(
          e.message.indexOf("not an environment variable name") === -1 ? e.message : "refused",
        );
      }
      return "after";
    `,
    );

    expect(result.logs).toEqual(["refused"]);
    expect(h.dispatched).toEqual([]);
  });

  it("carries every chained option onto the one call", async () => {
    const h = harness(() => ok("hi"));
    h.context.workdir = AGENT_SDK_ROOT;

    const result = await runRepl(
      h,
      `
      const out = await $\`ls\`.env({ A: "1" }).timeout(1234).cwd("tests/repl").nothrow();
      return String(out.exitCode);
    `,
    );

    expect(result.ok).toBe(true);
    expect(h.dispatched[0].args).toEqual({ command: "ls", timeout: 1234 });
    expect(h.contexts[0].workdir).toBe(REPL_TESTS_DIR);
    expect(h.contexts[0].sessionEnv).toEqual({ A: "1" });
  });

  it("leaves a sleep command verbatim so Bash stops it instead of backgrounding it", async () => {
    // `Bash` refuses to auto-background a command whose first word is `sleep`
    // (DISALLOWED_AUTO_BACKGROUND_COMMANDS) and kills it instead. An `.env()`
    // prefix would hide that word and turn the wait into a background task the
    // script never hears from again, so the command has to arrive unchanged —
    // and the terminated command is a failure, not a `running` result.
    const h = harness(() => ({
      success: false,
      content: "partial\n\nCommand timed out",
      error: "Command timed out",
      data: { exitCode: 130 },
    }));

    const result = await runRepl(
      h,
      `
      try {
        await $\`sleep 30\`.env({ FOO: "1" }).timeout(50);
        self.log("no throw");
      } catch (e) {
        self.log(e.name + ":" + e.exitCode);
      }
      return "after";
    `,
    );

    expect(result.ok).toBe(true);
    expect(result.logs).toEqual(["ShellError:130"]);
    expect(h.dispatched[0].args.command).toBe("sleep 30");
    expect(h.dispatched[0].args.timeout).toBe(50);
  });
});

describe("the call limit", () => {
  it("does not run the over-limit call and stops answering the rest", async () => {
    vi.useFakeTimers();
    const h = harness();

    const run = runRepl(
      h,
      `
      for (let i = 0; i < 5; i++) {
        await Echo({ i });
      }
      return "done";
    `,
      { timeout: 1000, maxToolCalls: 2, permissionMode: "bypassPermissions" },
    );

    // The window closes while the script hangs on the third call: a receipt, not a
    // result — and the third call was never handed to the tool. The window is the
    // fixed one, not the millisecond `timeout` above: that number bounds only the
    // script's own synchronous running, which is why it cannot cut this short.
    await vi.advanceTimersByTimeAsync(REPL_SYNC_WAIT_MS);
    const result = await run;

    expect(result.ok).toBe(true);
    expect(result.asyncDispatched).toBe(true);
    expect(h.dispatched).toHaveLength(2);
    expect(result.toolCalls).toBe(3);
    expect(result.toolsUsed).toEqual(["Echo", "Echo"]);
    expect(result.refusedCalls).toEqual(["Echo"]);
    expect(result.stderr?.[0]).toContain("REPL tool-call limit reached (2)");
    expect(result.stderr?.[0]).toContain(
      "no later call in this script is answered",
    );
  });

  it("keeps answering calls under the limit", async () => {
    const h = harness();

    const result = await runRepl(
      h,
      `
      for (let i = 0; i < 3; i++) {
        await Echo({ i });
      }
      return "done";
    `,
      { maxToolCalls: 3 },
    );

    expect(result.ok).toBe(true);
    expect(result.value).toBe("done");
    expect(result.refusedCalls).toBeUndefined();
    expect(result.stderr).toBeUndefined();
  });
});

describe("abort", () => {
  it("answers the 20 grace calls and leaves the 21st hanging", async () => {
    const controller = new AbortController();
    let answered = 0;
    const h = harness(() => {
      answered += 1;
      // The user hits stop while the first call's answer is on its way back.
      if (answered === 1) controller.abort();
      return ok("echo");
    });
    h.context.abortSignal = controller.signal;

    const result = await runRepl(
      h,
      `
      for (let i = 0; i < 100; i++) {
        await Echo({ i });
      }
      return "done";
    `,
      { permissionMode: "bypassPermissions" },
    );

    // The caller is released at once: the abort is the answer, not a hang.
    expect(result.ok).toBe(false);
    expect(result.error).toContain("aborted");

    // 1 answered before the abort landed + 20 grace calls; the 22nd never settles.
    await vi.waitFor(() => expect(answered).toBe(21));
    await settle();
    expect(answered).toBe(21);
  });

  it("answers a script that never reached the sandbox at all", async () => {
    const controller = new AbortController();
    controller.abort();
    const h = harness();
    h.context.abortSignal = controller.signal;

    const result = await runRepl(h, `return "never";`);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("aborted");
    expect(h.dispatched).toEqual([]);
  });

  it("does not release the context: variables survive an abort", async () => {
    const controller = new AbortController();
    const h = harness(() => {
      controller.abort();
      return ok("echo");
    });
    h.context.abortSignal = controller.signal;
    const key = newKey();

    const aborted = await runRepl(
      h,
      `const kept = "still here"; await Echo({}); return kept;`,
      { sessionKey: key },
    );
    expect(aborted.ok).toBe(false);
    expect(aborted.error).toContain("aborted");

    // The realm kept running after the host stopped caring, so the declaration
    // reached the context: an abort is not one of the three release points.
    await settle();
    h.context.abortSignal = undefined;
    const next = await runRepl(h, `return typeof kept;`, { sessionKey: key });
    expect(next.value).toBe("string");
  });
});

describe("the per-call watchdog", () => {
  const SHELL_POOL: ReplPoolEntry[] = [
    ...POOL,
    { name: "Bash", description: "Run a shell command" },
    { name: "Grep", description: "Search file contents" },
  ];

  /**
   * Run a script whose only interesting moment is a shell watchdog firing.
   *
   * Every shell gate is past the fixed 30000 ms window (the bonus alone is 30000),
   * so the script is dispatched first and the failure arrives as an event rather
   * than in the receipt.
   */
  async function runToWatchdog(
    h: Harness,
    code: string,
    limitMs: number,
  ): Promise<ReplRunResult> {
    const run = runRepl(h, code, {
      pool: SHELL_POOL,
      permissionMode: "bypassPermissions",
    });
    await vi.advanceTimersByTimeAsync(REPL_SYNC_WAIT_MS);
    expect((await run).asyncDispatched).toBe(true);
    await vi.advanceTimersByTimeAsync(limitMs - REPL_SYNC_WAIT_MS);
    const events = await waitForReplEvents(5_000);
    expect(events).toHaveLength(1);
    return events[0].result;
  }

  it("abandons one call and lets the script continue", async () => {
    vi.useFakeTimers();
    const h = harness((name) => (name === "Grep" ? blocked() : ok("echo")));

    const run = runRepl(
      h,
      `
      let message = "";
      try {
        await Grep({ pattern: "x" });
      } catch (e) {
        message = e.message;
      }
      self.log(message);
      self.log(await Echo({}));
      return "after";
    `,
      { pool: SHELL_POOL, permissionMode: "bypassPermissions" },
    );

    // A file tool takes no timeout of its own: 10000 × 1.5 + 5000 = 20000.
    await vi.advanceTimersByTimeAsync(20000);
    const result = await run;

    expect(result.ok).toBe(true);
    expect(result.value).toBe("after");
    expect(result.logs[0]).toContain("Grep did not return within 20000 ms");
    expect(result.logs[1]).toBe("echo");
  });

  it("counts a shell call from the two minutes the tool gives itself", async () => {
    vi.useFakeTimers();
    const h = harness(() => blocked());

    const result = await runToWatchdog(
      h,
      `try { await Bash({}); } catch (e) { self.log(e.message); } return "after";`,
      // 120000 × 1.5 + 5000 + 30000 = 215000: the tool's own default, plus the
      // room a shell command gets for a spawn or a virus scan it cannot time.
      215000,
    );

    expect(result.ok).toBe(true);
    expect(result.logs[0]).toContain("Bash did not return within 215000 ms");
    expect(result.logs[0]).toContain(
      "120000 ms × 1.5 + 5000 ms + 30000 ms for a shell command",
    );
  });

  it("honours a timeout a shell call declares", async () => {
    vi.useFakeTimers();
    const h = harness(() => blocked());

    const result = await runToWatchdog(
      h,
      `try { await Bash({ timeout: 1000 }); } catch (e) { self.log(e.message); } return "after";`,
      // 1000 × 1.5 + 5000 + 30000 = 36500.
      36500,
    );

    expect(result.logs[0]).toContain("Bash did not return within 36500 ms");
  });

  it("arms nothing for a tool with no timeout of its own", async () => {
    vi.useFakeTimers();
    let release: ((result: ToolResult) => void) | undefined;
    const h = harness(
      () =>
        new Promise<ToolResult>((resolve) => {
          release = resolve;
        }),
    );

    // `Slow` is neither a shell tool nor a file tool, so no base speaks for it —
    // Claude Code leaves that whole class unguarded rather than invent one.
    const run = runRepl(h, `return "after:" + (await Slow({}));`, {
      permissionMode: "bypassPermissions",
    });
    let settled = false;
    void run.then(() => {
      settled = true;
    });

    // One millisecond past where the old catch-all would have cut the call.
    await vi.advanceTimersByTimeAsync(
      REPL_DEFAULT_NATIVE_TIMEOUT_MS * 1.5 + 5000 + 1,
    );
    await settleFake();
    expect(settled).toBe(false);

    release?.(ok("slow"));
    await settleFake();
    const result = await run;
    expect(result.ok).toBe(true);
    expect(result.value).toBe("after:slow");
  });

  it("cancels the call it gives up on, and nothing else", async () => {
    vi.useFakeTimers();
    const h = harness((name, args) =>
      name === "Grep" && args.pattern === "first" ? blocked() : ok("found"),
    );

    const run = runRepl(
      h,
      `
      let message = "";
      try {
        await Grep({ pattern: "first" });
      } catch (e) {
        message = e.message;
      }
      self.log(message);
      self.log(await Grep({ pattern: "second" }));
      return "after";
    `,
      { pool: SHELL_POOL, permissionMode: "bypassPermissions" },
    );
    // A file tool's gate (20000) is inside the fixed 30000 ms window, so this
    // script finishes synchronously and the receipt carries the result.
    await vi.advanceTimersByTimeAsync(20000);
    const result = await run;

    expect(result.ok).toBe(true);
    expect(result.value).toBe("after");
    expect(result.logs[0]).toContain("was cancelled");
    expect(result.logs[1]).toBe("found");
    // The watchdog aborts the very signal the tool was handed — that is what makes
    // `Bash` kill its process tree instead of running on host-side unwatched, and
    // what Claude Code's `V.abort()` does when its own watchdog fires.
    expect(h.contexts[0]?.abortSignal?.aborted).toBe(true);
    // One controller per call: a sibling call keeps a signal nobody aborted, and
    // the run's own context is copied rather than written to.
    const second = h.contexts[1]?.abortSignal;
    expect(second).toBeDefined();
    expect(second).not.toBe(h.contexts[0]?.abortSignal);
    expect(second?.aborted).toBe(false);
    expect(h.context.abortSignal).toBeUndefined();
  });
});

describe("termination reasons are distinguishable", () => {
  it("names the step budget in the error it throws into the script", async () => {
    setReplStepBudget(30);
    const h = harness();

    const result = await runRepl(
      h,
      `
      let rounds = 0;
      while (true) { rounds = rounds + 1; }
      return rounds;
    `,
    );

    expect(result.ok).toBe(false);
    expect(result.error).toContain("step budget");
    // The realm reports both budgets through one callback, so both are named.
    expect(result.error).toContain("synchronous wall clock");
  });

  it("stops an ask-mode script at 600000 ms, counting the wait", async () => {
    vi.useFakeTimers();
    const h = harness(() => blocked());

    let settled = false;
    const run = runRepl(
      h,
      // `Slow` gets no per-call watchdog at all (not a shell tool, no fixed
      // default), so only the script-level ceiling can end this.
      `await Slow({ timeout: 500000 }); return "done";`,
      { permissionMode: "default" },
    );
    void run.then(() => {
      settled = true;
    });

    // One millisecond short of the ceiling the script is still being waited on —
    // the time spent on the approval prompt is part of the budget, not free.
    await vi.advanceTimersByTimeAsync(REPL_ASK_MODE_TOTAL_MS - 1);
    await settleFake();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    const result = await run;

    expect(result.ok).toBe(false);
    expect(result.error).toContain("600000 ms");
    expect(result.error).toContain("permission prompts");
    expect(result.error).toContain("variables and functions are kept");
  });
});

describe("the async lane", () => {
  it("answers with a receipt when the window closes first", async () => {
    vi.useFakeTimers();
    let release: ((result: ToolResult) => void) | undefined;
    const h = harness(
      () =>
        new Promise<ToolResult>((resolve) => {
          release = resolve;
        }),
    );

    const run = runRepl(
      h,
      `const v = await Slow({ timeout: 30000 }); return "value:" + v;`,
      { timeout: 1000, permissionMode: "bypassPermissions" },
    );

    // The wait window is the fixed `REPL_SYNC_WAIT_MS`, counted on the wall clock.
    await vi.advanceTimersByTimeAsync(REPL_SYNC_WAIT_MS);
    const result = await run;

    expect(result.ok).toBe(true);
    expect(result.asyncDispatched).toBe(true);
    expect(result.value).toBeUndefined();
    // The receipt carries no logs: everything the script collects travels with
    // the event, which is the only place the result will appear.
    expect(result.logs).toEqual([]);

    // It is still in flight, and a script waiting on the host still counts as
    // running rather than as settled.
    const running = listRunningReplScripts();
    expect(running).toHaveLength(1);
    expect(running[0].id).toBe(result.evalId);
    expect(running[0].snippet).toContain("await Slow");
    expect(running[0].ageMs).toBeGreaterThanOrEqual(0);
    expect(running[0].state).toBe("waiting");
    expect(running[0].settled).toBe(false);
    expect(running[0].self).toBe(false);

    release?.(ok("slow"));
    await settleFake();

    const events = drainReplEvents();
    expect(events).toHaveLength(1);
    expect(events[0].evalId).toBe(result.evalId);
    expect(events[0].result.ok).toBe(true);
    expect(events[0].result.value).toBe("value:slow");
    // Drained: nothing is left to poll.
    expect(listRunningReplScripts()).toEqual([]);
  });

  it("keeps the window fixed whatever `timeout` says", async () => {
    vi.useFakeTimers();
    const h = harness(() => blocked());

    // `timeout` at its ceiling: the call still comes back as soon as the window
    // closes, because a larger `timeout` cannot buy a longer hold on the turn.
    const run = runRepl(
      h,
      `return "value:" + (await Slow({ timeout: 600000 }));`,
      { timeout: REPL_MAX_TIMEOUT_MS, permissionMode: "bypassPermissions" },
    );
    let settled = false;
    void run.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(REPL_SYNC_WAIT_MS - 1);
    await settleFake();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect((await run).asyncDispatched).toBe(true);
  });

  it("does not let a small `timeout` cut the window short", async () => {
    vi.useFakeTimers();
    const h = harness(() => blocked());

    // `timeout` bounds the synchronous segment, which is not running while the
    // script waits on the host: it cannot fail a waiting script, and it cannot
    // hand the turn back either.
    const run = runRepl(
      h,
      `return "value:" + (await Slow({ timeout: 30000 }));`,
      {
        timeout: 1000,
        permissionMode: "bypassPermissions",
      },
    );
    let settled = false;
    void run.then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(1000);
    await settleFake();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(REPL_SYNC_WAIT_MS - 1000);
    expect((await run).asyncDispatched).toBe(true);
  });

  it("wakes a waiting poll as soon as a script settles", async () => {
    vi.useFakeTimers();
    let release: ((result: ToolResult) => void) | undefined;
    const h = harness(
      () =>
        new Promise<ToolResult>((resolve) => {
          release = resolve;
        }),
    );

    // The nested call gets no per-call watchdog, so nothing but the window can
    // end this wait.
    const run = runRepl(
      h,
      `return "value:" + (await Slow({ timeout: 30000 }));`,
      {
        timeout: 1000,
        permissionMode: "bypassPermissions",
      },
    );
    // `timeout: 1000` does not shorten the window: only the fixed one dispatches.
    await vi.advanceTimersByTimeAsync(REPL_SYNC_WAIT_MS);
    const receipt = await run;
    expect(receipt.asyncDispatched).toBe(true);

    // Nothing has settled yet, so the poll parks instead of answering empty.
    const waiting = waitForReplEvents(5_000);
    release?.(ok("slow"));
    await settleFake();

    const events = await waiting;
    expect(events).toHaveLength(1);
    expect(events[0].evalId).toBe(receipt.evalId);
    expect(events[0].elapsedMs).toBeGreaterThanOrEqual(0);
    expect(events[0].result.value).toBe("value:slow");
  });

  it("answers empty when the wait runs out with nothing settled", async () => {
    vi.useFakeTimers();
    let release: ((result: ToolResult) => void) | undefined;
    const h = harness(
      () =>
        new Promise<ToolResult>((resolve) => {
          release = resolve;
        }),
    );

    const run = runRepl(
      h,
      `return "value:" + (await Slow({ timeout: 30000 }));`,
      {
        timeout: 1000,
        permissionMode: "bypassPermissions",
      },
    );
    await vi.advanceTimersByTimeAsync(REPL_SYNC_WAIT_MS);
    await run;

    const waiting = waitForReplEvents(5_000);
    await vi.advanceTimersByTimeAsync(5_000);
    // An empty answer is the status line's cue, not a failure.
    expect(await waiting).toEqual([]);

    release?.(ok("slow"));
    await settleFake();
    expect(drainReplEvents()).toHaveLength(1);
  });

  it("carries at most `max` settled scripts and leaves the rest queued", async () => {
    const releases: Array<(result: ToolResult) => void> = [];
    const h = harness(
      () =>
        new Promise<ToolResult>((resolve) => {
          releases.push(resolve);
        }),
    );

    await runRepl(h, `return "a" + (await Slow({}));`, {
      detach: true,
      permissionMode: "bypassPermissions",
    });
    await runRepl(h, `return "b" + (await Slow({}));`, {
      detach: true,
      permissionMode: "bypassPermissions",
    });
    for (const release of releases) release(ok("done"));
    // Both scripts have to cross the boundary before there are two events; the
    // count is the async source still owing them.
    await vi.waitFor(() => expect(replPendingEventCount()).toBe(2));

    const first = await waitForReplEvents(5_000, 1);
    expect(first).toHaveLength(1);
    expect(replPendingEventCount()).toBe(1);

    const rest = await waitForReplEvents(5_000, 1);
    expect(rest).toHaveLength(1);
    expect(replPendingEventCount()).toBe(0);
  });

  it("never waits in the fully-dispatched shape", async () => {
    let release: ((result: ToolResult) => void) | undefined;
    const h = harness(
      () =>
        new Promise<ToolResult>((resolve) => {
          release = resolve;
        }),
    );

    const result = await runRepl(h, `return "value:" + (await Slow({}));`, {
      detach: true,
      permissionMode: "bypassPermissions",
    });

    // Answered before the tool answered: the script was dispatched, not run.
    expect(result.ok).toBe(true);
    expect(result.asyncDispatched).toBe(true);
    expect(result.evalId).toBeTypeOf("number");
    expect(listRunningReplScripts()).toHaveLength(1);

    release?.(ok("slow"));
    await settle();

    const events = drainReplEvents();
    expect(events).toHaveLength(1);
    expect(events[0].evalId).toBe(result.evalId);
    expect(events[0].result.value).toBe("value:slow");
  });

  it("lets a background script see itself through running()", async () => {
    const pending: Array<(result: ToolResult) => void> = [];
    const h = harness(
      () =>
        new Promise<ToolResult>((resolve) => {
          pending.push(resolve);
        }),
    );
    const key = newKey();

    const first = await runRepl(h, `await Slow({}); return "a";`, {
      sessionKey: key,
      detach: true,
      permissionMode: "bypassPermissions",
    });
    const second = await runRepl(
      h,
      `await Slow({}); self.log(JSON.stringify(running().map((s) => s.self))); return "b";`,
      { sessionKey: key, detach: true, permissionMode: "bypassPermissions" },
    );

    // The second script is the one asking, so the rows read [sibling, self].
    pending[1](ok("second"));
    await settle();

    const events = drainReplEvents();
    expect(events).toHaveLength(1);
    expect(events[0].evalId).toBe(second.evalId);
    expect(JSON.parse(events[0].result.logs[0])).toEqual([false, true]);
    expect(first.evalId).not.toBe(second.evalId);
  });

  it("terminates a background script at the 2 hour ceiling", async () => {
    vi.useFakeTimers();
    const h = harness();

    const result = await runRepl(
      h,
      `self.log("before"); await new Promise(() => {}); return "never";`,
      { detach: true, permissionMode: "bypassPermissions" },
    );

    await vi.advanceTimersByTimeAsync(REPL_BACKGROUND_MAX_MS);
    const events = drainReplEvents();

    expect(events).toHaveLength(1);
    expect(events[0].evalId).toBe(result.evalId);
    expect(events[0].result.ok).toBe(false);
    expect(events[0].result.error).toContain("background ceiling");
    // What the script logged before the axe fell is still reported.
    expect(events[0].result.logs).toEqual(["before"]);
  });

  it("refuses instead of queueing at the concurrency limit", async () => {
    const h = harness(() => blocked());
    const key = newKey();

    const receipts: ReplRunResult[] = [];
    for (let index = 0; index < REPL_ASYNC_CONCURRENCY_LIMIT; index += 1) {
      receipts.push(
        await runRepl(h, `await Slow({}); return "never";`, {
          sessionKey: key,
          detach: true,
          permissionMode: "bypassPermissions",
        }),
      );
    }
    expect(receipts.every((receipt) => receipt.ok)).toBe(true);
    expect(listRunningReplScripts()).toHaveLength(REPL_ASYNC_CONCURRENCY_LIMIT);

    const refused = await runRepl(h, `return "never started";`, {
      sessionKey: key,
      detach: true,
      permissionMode: "bypassPermissions",
    });

    expect(refused.ok).toBe(false);
    expect(refused.error).toContain("concurrency limit");
    expect(refused.error).toContain("已达并发上限，先用 Poll 等它们 settle");
    expect(refused.error).toContain("This script was not started");
    // A refusal keeps the receipt shape, so the model reads it as an answer from
    // the async lane rather than as a script that ran and failed...
    expect(refused.asyncDispatched).toBe(true);
    // ...but without an id: nothing was started, so there is nothing to wait on
    // with `Poll` and no number is consumed by the refusal.
    expect(refused.evalId).toBeUndefined();
    // Nothing was started: the pool never saw a call for it.
    expect(listRunningReplScripts()).toHaveLength(REPL_ASYNC_CONCURRENCY_LIMIT);
  });

  it("does not dedupe: the same script twice dispatches twice", async () => {
    const h = harness(() => blocked());
    const key = newKey();
    const code = `await Slow({}); return "never";`;

    const first = await runRepl(h, code, {
      sessionKey: key,
      detach: true,
      permissionMode: "bypassPermissions",
    });
    const second = await runRepl(h, code, {
      sessionKey: key,
      detach: true,
      permissionMode: "bypassPermissions",
    });

    expect(first.ok && second.ok).toBe(true);
    expect(first.evalId).not.toBe(second.evalId);
    expect(listRunningReplScripts()).toHaveLength(2);
  });

  it("aborts one background script through running()", async () => {
    const h = harness(() => blocked());

    const receipt = await runRepl(h, `await Slow({}); return "never";`, {
      detach: true,
      permissionMode: "bypassPermissions",
    });

    const [script] = listRunningReplScripts();
    expect(script.self).toBe(false);
    script.abort();
    await settle();

    const events = drainReplEvents();
    expect(events).toHaveLength(1);
    expect(events[0].evalId).toBe(receipt.evalId);
    expect(events[0].result.ok).toBe(false);
    expect(events[0].result.error).toContain("aborted");
  });

  it("stops reporting to the caller's row once the receipt is sent", async () => {
    // The row the collapsed tool block renders belongs to the caller that got the
    // receipt, and that block is already `stage: "end"`. A background script that
    // keeps issuing calls must not keep rewriting it: `updateToolBlock` (and every
    // UI reducer behind it) merges field by field, so one more update carrying
    // `stage: "running"` is not a refresh — it resurrects a finished block.
    vi.useFakeTimers();
    const h = harness();
    const reported: string[] = [];

    const run = runRepl(
      h,
      `
      await Echo({ step: "one" });
      await new Promise((resolve) => setTimeout(resolve, 60000));
      await Echo({ step: "two" });
      return "done";
      `,
      { onToolCall: (name) => reported.push(name) },
    );

    await vi.advanceTimersByTimeAsync(REPL_SYNC_WAIT_MS);
    const receipt = await run;
    expect(receipt.asyncDispatched).toBe(true);
    expect(reported).toEqual(["Echo"]);

    // The script carries on past the window. Its later calls still reach the
    // model's channel, but nothing more goes to the row of a settled block.
    await vi.advanceTimersByTimeAsync(60000);
    await settleFake();
    expect(reported).toEqual(["Echo"]);

    const events = drainReplEvents();
    expect(events).toHaveLength(1);
    expect(events[0].evalId).toBe(receipt.evalId);
    expect(events[0].result.ok).toBe(true);
    expect(events[0].result.value).toBe("done");
    // The model-facing record kept counting calls made after the receipt.
    expect(events[0].result.toolsUsed).toEqual(["Echo", "Echo"]);
    expect(events[0].result.toolCalls).toBe(2);
  });
});

describe("attachments", () => {
  const image = (data: string, mediaType = "image/png") => ({
    data,
    mediaType,
  });

  it("keeps the bytes in the result and hands the script a placeholder", async () => {
    const data = "A".repeat(4000);
    const h = harness(() => ({
      success: true,
      content: "screenshot",
      images: [image(data)],
    }));

    const result = await runRepl(
      h,
      `
      const text = await Pic({});
      self.log(text);
      return text.length > 0;
    `,
    );

    // 4000 base64 characters are 3000 bytes: 3 of every 4 characters carry 2 bytes.
    // The fixture declares no `data`, so the note is all the script gets: the text
    // ("screenshot") is what the model reads, and it stays host-side.
    expect(result.logs[0]).toBe(
      "[4000 base64 chars — 3000 bytes moved to the REPL result, subject to its per-result cap]",
    );
    expect(result.images).toEqual([{ data, mediaType: "image/png" }]);
  });

  it("swaps a base64 field inside the tool data for the same placeholder", async () => {
    // `Read` reports an image as `data.file.base64`; the bytes travel as an
    // attachment, so what crosses into the sandbox is the placeholder.
    const data = "B".repeat(4000);
    const h = harness(() => ({
      success: true,
      content: "",
      data: {
        type: "image",
        file: { base64: data, type: "image/png", originalSize: 3000 },
      },
      images: [image(data)],
    }));

    const result = await runRepl(
      h,
      `
      const out = await Pic({});
      self.log(out.file.base64);
      self.log(out.file.type);
      return out.type;
    `,
    );

    expect(result.logs[0]).toBe(
      "[4000 base64 chars — 3000 bytes moved to the REPL result, subject to its per-result cap]",
    );
    // Everything beside the bytes is untouched.
    expect(result.logs[1]).toBe("image/png");
    expect(result.value).toBe("image");
    expect(result.images).toEqual([{ data, mediaType: "image/png" }]);
  });

  it("caps images at 8 and says what it dropped", async () => {
    const h = harness(() => ({
      success: true,
      content: "many",
      images: Array.from({ length: 12 }, (_, index) => image(`img${index}`)),
    }));

    const result = await runRepl(h, `return await Pic({});`);

    expect(result.images).toHaveLength(REPL_MAX_IMAGES);
    expect(result.images[0]).toEqual({ data: "img0", mediaType: "image/png" });
    expect(result.stderr).toHaveLength(4);
    expect(result.stderr?.[0]).toContain(`at most ${REPL_MAX_IMAGES} images`);
  });

  it("caps PDFs at 4, counted apart from images", async () => {
    const h = harness(() => ({
      success: true,
      content: "docs",
      images: Array.from({ length: 5 }, (_, index) =>
        image(`pdf${index}`, "application/pdf"),
      ),
    }));

    const result = await runRepl(h, `return await Pic({});`);

    expect(result.images).toHaveLength(REPL_MAX_PDFS);
    expect(result.images[0].mediaType).toBe("application/pdf");
    expect(result.stderr?.[0]).toContain(`at most ${REPL_MAX_PDFS} PDFs`);
  });
});

describe("the console ring is not the result", () => {
  it("keeps console output out of the logs and readable through tail()", async () => {
    const h = harness();

    const result = await runRepl(
      h,
      `
      console.log("noise", 1);
      console.warn("careful");
      self.log("kept");
      self.log(console.tail(1));
      return String(console.dropped());
    `,
    );

    expect(result.logs).toEqual(["kept", "[warn] careful"]);
    expect(result.value).toBe("0");
  });

  it("says in the result that the ring was used", async () => {
    // The trap this note closes: a script that "logged" to the console hands back a
    // result with none of it, and nothing else in the answer says why.
    const h = harness();

    const result = await runRepl(
      h,
      `
      console.log("noise", 1);
      console.error("more noise");
      return "done";
    `,
    );

    expect(result.stderr).toHaveLength(1);
    expect(result.stderr?.[0]).toContain(
      "[console.log wrote 2 lines to the console ring, not to this output",
    );
    expect(result.stderr?.[0]).toContain("console.tail()");
  });

  it("counts in the singular, and stays out of a run that never used the ring", async () => {
    const h = harness();

    const one = await runRepl(h, `console.log("noise"); return "done";`);
    expect(one.stderr?.[0]).toContain("wrote 1 line to the console ring");

    const clean = await runRepl(h, `return "done";`);
    expect(clean.stderr).toBeUndefined();
  });
});

describe("the long-resident context", () => {
  it("is one context per session key, released only by dispose", async () => {
    const h = harness();
    const key = newKey();

    const first = await runRepl(h, `const shared = 41; return typeof shared;`, {
      sessionKey: key,
    });
    expect(first.value).toBe("number");

    const second = await runRepl(h, `return shared + 1;`, { sessionKey: key });
    expect(second.value).toBe("42");

    // A different key is a different context, as if the session had just started.
    const other = await runRepl(h, `return typeof shared;`);
    expect(other.value).toBe("undefined");

    disposeReplRuntime(key);

    const afterDispose = await runRepl(h, `return typeof shared;`, {
      sessionKey: key,
    });
    expect(afterDispose.value).toBe("undefined");
  });

  it("reports a context reset for the next script, not for the one that poisoned it", async () => {
    const h = harness();
    const key = newKey();

    const poison = await runRepl(
      h,
      `Object.defineProperty(globalThis, "tools", { configurable: false }); return "poisoned";`,
      { sessionKey: key },
    );
    expect(poison.ok).toBe(true);

    const after = await runRepl(h, `return 1;`, { sessionKey: key });

    expect(after.ok).toBe(false);
    expect(after.contextReset).toBe(true);
    expect(after.error).toContain("REPL context was reset");
  });
});

describe("the mark the GUI judges a block by", () => {
  /**
   * REPL 里的 `$` 用的是 Bash 工具、也真的登记了前台任务，但这次调用没有自己的
   * 块 —— 名字只落在 `nestedToolCalls` 里。界面按块名判「能不能转到后台」时，
   * 命令跑着的时候反而没有那颗按钮（远控页还没有 Ctrl+B 这条后路），所以运行时
   * 把这件事直接写在 REPL 块上（spec multi-agent/task-background-execution.md
   * 场景 3 / 7，读方是 `webview` 的 `hasRunningBackgroundableTool`）。
   */
  function withBlock(h: Harness): Array<Record<string, unknown>> {
    const updates: Array<Record<string, unknown>> = [];
    h.context = {
      ...(h.context as ToolContext),
      toolCallId: "tool_repl_1",
      messageManager: {
        updateToolBlock: (params: Record<string, unknown>) => {
          updates.push(params);
        },
      },
    } as unknown as ToolContext;
    return updates;
  }

  it("is set while a `$` command runs, and cleared when it answers", async () => {
    const h = harness(() => ok("done"));
    const updates = withBlock(h);

    const result = await runRepl(h, "return (await $`ls`).stdout;");

    expect(result.ok).toBe(true);
    // Transitions only, on the REPL's own block: the block is not re-opened after
    // its row is closed, and a script with two calls in flight stays marked.
    expect(updates).toEqual([
      { id: "tool_repl_1", stage: "running", backgroundable: true },
      { id: "tool_repl_1", stage: "running", backgroundable: false },
    ]);
  });

  it("is set for a shell call made through tools.Bash too", async () => {
    const h = harness(() => ok("done"));
    const updates = withBlock(h);

    const result = await runRepl(
      h,
      'await tools.Bash({ command: "ls" }); return "done";',
      {
        pool: [...POOL, { name: "Bash", description: "Run a shell command" }],
      },
    );

    expect(result.ok).toBe(true);
    expect(updates.map((u) => u.backgroundable)).toEqual([true, false]);
  });

  it("is never set by a call that holds no foreground task", async () => {
    const h = harness();
    const updates = withBlock(h);

    const result = await runRepl(
      h,
      'await tools.Echo({ a: 1 }); return "done";',
    );

    expect(result.ok).toBe(true);
    // `Read`/`Grep`/`Echo`-style calls register nothing to move, so the GUI must
    // not be told about them — that is the "button that does nothing" the spec
    // forbids.
    expect(updates).toEqual([]);
  });
});
