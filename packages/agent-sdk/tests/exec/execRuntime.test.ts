import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecPoolEntry } from "../../src/exec/catalog.js";
import {
  EXEC_ASYNC_CONCURRENCY_LIMIT,
  EXEC_ASK_MODE_TOTAL_MS,
  EXEC_BACKGROUND_MAX_MS,
  EXEC_MAX_IMAGES,
  EXEC_MAX_PDFS,
  EXEC_SHELL_DEFAULT_WAIT_MS,
} from "../../src/exec/constants.js";
import {
  drainReplEvents,
  disposeReplRuntime,
  listRunningReplScripts,
  replPendingEventCount,
  runReplScript,
  waitForReplEvents,
  type RunReplOptions,
  type ReplRunResult,
} from "../../src/exec/execRuntime.js";
import { setReplStepBudget } from "../../src/exec/replSandbox.js";
import type { ToolContext, ToolResult } from "../../src/tools/types.js";

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

const POOL: ExecPoolEntry[] = [
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
  return { success: true, content };
}

type Behavior = (
  name: string,
  args: Record<string, unknown>,
) => ToolResult | Promise<ToolResult>;

type McpBehavior = (name: string, args: Record<string, unknown>) => unknown;

interface Harness {
  context: ToolContext;
  /** Every built-in call the runtime actually dispatched, in order. */
  dispatched: Array<{ name: string; args: Record<string, unknown> }>;
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
  const mcpCalls: Harness["mcpCalls"] = [];
  const context = {
    workdir: "/tmp",
    toolManager: {
      execute: (name: string, args: Record<string, unknown>) => {
        dispatched.push({ name, args });
        return Promise.resolve().then(() => behavior(name, args));
      },
      getExecPool: () => POOL,
    },
    mcpManager: {
      executeMcpTool: (name: string, args: Record<string, unknown>) => {
        mcpCalls.push({ name, args });
        return Promise.resolve().then(() => mcpBehavior(name, args));
      },
    },
  } as unknown as ToolContext;
  return { context, dispatched, mcpCalls };
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
    ]);
    expect(result.toolsUsed).toEqual(["Fail"]);
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

  it("leaves a name outside the pool undefined", async () => {
    const h = harness();

    const result = await runRepl(h, `return Nope();`);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Nope is not defined");
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
    // A capped hit list is not a count of matches: there is no `total`.
    expect(Object.keys(hits[0]).sort()).toEqual(["about", "input", "name"]);
  });

  it("answers describeTool with the schema, and with { error } for a miss", async () => {
    const h = harness();

    const result = await runRepl(
      h,
      `
      const one = await describeTool("Echo");
      self.log(JSON.stringify(Object.keys(one).sort()));
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
    ]);
    expect(JSON.parse(result.logs[1])).toEqual(["error"]);
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
});

describe("$ — the shell template", () => {
  it("runs the command through the Bash tool and returns pure data", async () => {
    const h = harness(() => ({
      success: true,
      content: "hi\n",
      metadata: { exitCode: 0 },
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
        args: { command: "echo hi", timeout: EXEC_SHELL_DEFAULT_WAIT_MS },
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
      metadata: { exitCode: 2 },
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
      self.log(String(out.exitCode), out.running.taskId, typeof out.running.outputPath);
      return out.stdout === "" ? "empty" : out.stdout;
    `,
    );

    expect(result.ok).toBe(true);
    // A longer wait than the 600000 ms default is the command's own to declare.
    expect(h.dispatched[0].args.timeout).toBe(900000);
    // exitCode null is not a failure: the script is answered and carries on.
    expect(result.logs).toEqual(["null bg-1 string"]);
    expect(result.value).toBe("empty");
  });

  it("refuses $ when the context has no tool manager to run it", async () => {
    const h = harness();
    h.context = { workdir: "/tmp" } as unknown as ToolContext;

    const result = await runRepl(h, `await $\`echo hi\`; return "after";`);

    expect(result.ok).toBe(false);
    expect(result.error).toContain("cannot run a command here");
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
    // result — and the third call was never handed to the tool.
    await vi.advanceTimersByTimeAsync(1000);
    const result = await run;

    expect(result.ok).toBe(true);
    expect(result.dispatched).toBe(result.evalId);
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
  it("abandons one call and lets the script continue", async () => {
    vi.useFakeTimers();
    const h = harness((name) => (name === "Slow" ? blocked() : ok("echo")));

    const run = runRepl(
      h,
      `
      let message = "";
      try {
        await Slow({ timeout: 1000 });
      } catch (e) {
        message = e.message;
      }
      self.log(message);
      self.log(await Echo({}));
      return "after";
    `,
      { permissionMode: "bypassPermissions" },
    );

    // 1000 × 1.5 + 5000 = 6500: the declarer's own timeout plus the base term.
    await vi.advanceTimersByTimeAsync(6500);
    const result = await run;

    expect(result.ok).toBe(true);
    expect(result.value).toBe("after");
    expect(result.logs[0]).toContain("Slow did not return within 6500 ms");
    expect(result.logs[1]).toBe("echo");
  });

  it("measures a call that declares no timeout against the 10000 ms default", async () => {
    vi.useFakeTimers();
    const h = harness(() => blocked());

    const run = runRepl(
      h,
      `
      try {
        await Slow({});
      } catch (e) {
        self.log(e.message);
      }
      return "after";
    `,
      { permissionMode: "bypassPermissions" },
    );

    await vi.advanceTimersByTimeAsync(20000);
    const result = await run;

    expect(result.ok).toBe(true);
    expect(result.logs[0]).toContain("did not return within 20000 ms");
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
      // The call declares a timeout long enough that its own watchdog (the call
      // level guard) cannot fire first: this test is about the script level one.
      `await Slow({ timeout: 500000 }); return "done";`,
      { permissionMode: "default" },
    );
    void run.then(() => {
      settled = true;
    });

    // One millisecond short of the ceiling the script is still being waited on —
    // the time spent on the approval prompt is part of the budget, not free.
    await vi.advanceTimersByTimeAsync(EXEC_ASK_MODE_TOTAL_MS - 1);
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

    // The wait window is the model's own `timeout`, counted on the wall clock.
    await vi.advanceTimersByTimeAsync(1000);
    const result = await run;

    expect(result.ok).toBe(true);
    expect(result.dispatched).toBe(result.evalId);
    expect(result.value).toBeUndefined();
    // The receipt carries no logs: everything the script collects travels with
    // the event, which is the only place the result will appear.
    expect(result.logs).toEqual([]);

    // It is still in flight, and a script waiting on the host still counts as
    // running rather than as settled.
    const running = listRunningReplScripts();
    expect(running).toHaveLength(1);
    expect(running[0].id).toBe(result.dispatched);
    expect(running[0].snippet).toContain("await Slow");
    expect(running[0].ageMs).toBeGreaterThanOrEqual(0);
    expect(running[0].state).toBe("waiting");
    expect(running[0].settled).toBe(false);
    expect(running[0].self).toBe(false);

    release?.(ok("slow"));
    await settleFake();

    const events = drainReplEvents();
    expect(events).toHaveLength(1);
    expect(events[0].evalId).toBe(result.dispatched);
    expect(events[0].result.ok).toBe(true);
    expect(events[0].result.value).toBe("value:slow");
    // Drained: nothing is left to poll.
    expect(listRunningReplScripts()).toEqual([]);
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

    const run = runRepl(h, `return "value:" + (await Slow({}));`, {
      timeout: 1000,
      permissionMode: "bypassPermissions",
    });
    await vi.advanceTimersByTimeAsync(1000);
    const receipt = await run;
    expect(receipt.dispatched).toBeTypeOf("number");

    // Nothing has settled yet, so the poll parks instead of answering empty.
    const waiting = waitForReplEvents(5_000);
    release?.(ok("slow"));
    await settleFake();

    const events = await waiting;
    expect(events).toHaveLength(1);
    expect(events[0].evalId).toBe(receipt.dispatched);
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

    const run = runRepl(h, `return "value:" + (await Slow({}));`, {
      timeout: 1000,
      permissionMode: "bypassPermissions",
    });
    await vi.advanceTimersByTimeAsync(1000);
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
    expect(result.dispatched).toBeTypeOf("number");
    expect(listRunningReplScripts()).toHaveLength(1);

    release?.(ok("slow"));
    await settle();

    const events = drainReplEvents();
    expect(events).toHaveLength(1);
    expect(events[0].evalId).toBe(result.dispatched);
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
    expect(events[0].evalId).toBe(second.dispatched);
    expect(JSON.parse(events[0].result.logs[0])).toEqual([false, true]);
    expect(first.dispatched).not.toBe(second.dispatched);
  });

  it("terminates a background script at the 2 hour ceiling", async () => {
    vi.useFakeTimers();
    const h = harness();

    const result = await runRepl(
      h,
      `self.log("before"); await new Promise(() => {}); return "never";`,
      { detach: true, permissionMode: "bypassPermissions" },
    );

    await vi.advanceTimersByTimeAsync(EXEC_BACKGROUND_MAX_MS);
    const events = drainReplEvents();

    expect(events).toHaveLength(1);
    expect(events[0].evalId).toBe(result.dispatched);
    expect(events[0].result.ok).toBe(false);
    expect(events[0].result.error).toContain("background ceiling");
    // What the script logged before the axe fell is still reported.
    expect(events[0].result.logs).toEqual(["before"]);
  });

  it("refuses instead of queueing at the concurrency limit", async () => {
    const h = harness(() => blocked());
    const key = newKey();

    const receipts: ReplRunResult[] = [];
    for (let index = 0; index < EXEC_ASYNC_CONCURRENCY_LIMIT; index += 1) {
      receipts.push(
        await runRepl(h, `await Slow({}); return "never";`, {
          sessionKey: key,
          detach: true,
          permissionMode: "bypassPermissions",
        }),
      );
    }
    expect(receipts.every((receipt) => receipt.ok)).toBe(true);
    expect(listRunningReplScripts()).toHaveLength(EXEC_ASYNC_CONCURRENCY_LIMIT);

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
    // the async lane rather than as a script that ran and failed.
    expect(refused.dispatched).toBe(refused.evalId);
    const usedIds = receipts.map((receipt) => receipt.dispatched);
    expect(usedIds).not.toContain(refused.dispatched);
    // Nothing was started: the pool never saw a call for it.
    expect(listRunningReplScripts()).toHaveLength(EXEC_ASYNC_CONCURRENCY_LIMIT);
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
    expect(first.dispatched).not.toBe(second.dispatched);
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
    expect(events[0].evalId).toBe(receipt.dispatched);
    expect(events[0].result.ok).toBe(false);
    expect(events[0].result.error).toContain("aborted");
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
    expect(result.logs[0]).toBe(
      "screenshot\n[4000 base64 chars — 3000 bytes moved to the REPL result, subject to its per-result cap]",
    );
    expect(result.images).toEqual([{ data, mediaType: "image/png" }]);
  });

  it("caps images at 8 and says what it dropped", async () => {
    const h = harness(() => ({
      success: true,
      content: "many",
      images: Array.from({ length: 12 }, (_, index) => image(`img${index}`)),
    }));

    const result = await runRepl(h, `return await Pic({});`);

    expect(result.images).toHaveLength(EXEC_MAX_IMAGES);
    expect(result.images[0]).toEqual({ data: "img0", mediaType: "image/png" });
    expect(result.stderr).toHaveLength(4);
    expect(result.stderr?.[0]).toContain(`at most ${EXEC_MAX_IMAGES} images`);
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

    expect(result.images).toHaveLength(EXEC_MAX_PDFS);
    expect(result.images[0].mediaType).toBe("application/pdf");
    expect(result.stderr?.[0]).toContain(`at most ${EXEC_MAX_PDFS} PDFs`);
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
