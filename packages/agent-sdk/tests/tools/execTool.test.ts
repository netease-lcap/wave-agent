import { describe, it, expect, vi, beforeEach } from "vitest";
import { execTool, execToolAliases } from "../../src/tools/execTool.js";
import {
  EXEC_TOOL_NAME,
  REPL_TOOL_ALIASES,
} from "../../src/constants/tools.js";
import {
  renderSearchCallForm,
  renderSearchSignature,
} from "../../src/exec/catalog.js";
import type { ExecPoolEntry } from "../../src/exec/catalog.js";
import {
  EXEC_ASK_MODE_TOTAL_MS,
  EXEC_BACKGROUND_MAX_MS,
  EXEC_DEFAULT_TIMEOUT_MS,
  EXEC_MAX_TIMEOUT_MS,
  EXEC_PART_CHAR_LIMIT,
  EXEC_SHELL_DEFAULT_WAIT_MS,
} from "../../src/exec/constants.js";
import type {
  RunReplOptions,
  ReplRunResult,
} from "../../src/exec/execRuntime.js";
import type { ToolContext } from "../../src/tools/types.js";

/**
 * The runtime is replaced wholesale: this suite is about the tool layer — the
 * declaration, the parameter handling and the rendering of an outcome — not about
 * running JavaScript. Every shape asserted here is a field of `ReplRunResult`, so
 * a change to the contract shows up as a failing assertion rather than as a test
 * that quietly stops exercising the branch.
 */
const { runReplScript } = vi.hoisted(() => ({
  runReplScript: vi.fn<(options: RunReplOptions) => Promise<ReplRunResult>>(),
}));

vi.mock("../../src/exec/execRuntime.js", () => ({ runReplScript }));

/** A successful run with nothing in it, used as the base of every case. */
function runResult(overrides: Partial<ReplRunResult> = {}): ReplRunResult {
  return { ok: true, logs: [], toolCalls: 0, images: [], ...overrides };
}

function contextWith(
  options: {
    pool?: ExecPoolEntry[];
    onShortResultUpdate?: (shortResult: string) => void;
    /** The registered tools a summary line may ask for a compact parameter. */
    tools?: Array<{
      name: string;
      formatCompactParams?: (args: Record<string, unknown>) => string;
    }>;
  } = {},
): ToolContext {
  return {
    workdir: "/tmp",
    toolManager: {
      getExecPool: () => options.pool ?? [],
      list: () => options.tools ?? [],
    },
    ...(options.onShortResultUpdate
      ? { onShortResultUpdate: options.onShortResultUpdate }
      : {}),
  } as unknown as ToolContext;
}

/**
 * The elapsed time is measured by the tool itself, so it differs on every run;
 * normalize it to compare whole documents.
 */
function withoutMs(content: string): string {
  return content.replace(/ ms="\d+"/, ' ms="0"');
}

const NO_OUTPUT_TEXT =
  "The script finished without a return value and without any self.log() output.";

beforeEach(() => {
  runReplScript.mockReset();
  runReplScript.mockResolvedValue(runResult());
});

describe("execTool declaration", () => {
  it("is named REPL and takes code plus an optional timeout", () => {
    expect(EXEC_TOOL_NAME).toBe("REPL");
    expect(execTool.name).toBe(EXEC_TOOL_NAME);
    expect(execTool.config.function.name).toBe(EXEC_TOOL_NAME);

    const parameters = execTool.config.function.parameters as {
      properties: Record<string, { type: string; description?: string }>;
      required: string[];
    };
    expect(parameters.properties.code.type).toBe("string");
    expect(parameters.properties.timeout).toMatchObject({ type: "number" });
    // Only the script is required: the timeout has a default in the runtime.
    expect(parameters.required).toEqual(["code"]);
  });

  it("documents the timeout as a synchronous wall clock, not a total", () => {
    const parameters = execTool.config.function.parameters as {
      properties: Record<string, { description?: string }>;
    };
    const description = parameters.properties.timeout.description ?? "";
    expect(description).toContain(String(EXEC_DEFAULT_TIMEOUT_MS));
    expect(description).toContain(String(EXEC_MAX_TIMEOUT_MS));
    // The whole point of the budget: waiting on a nested call is free.
    expect(description).toMatch(/synchronous/i);
    expect(description).toMatch(/nested tool call/i);
    expect(description).toMatch(/does not count/i);
  });

  it("answers to the older spelling of its name", () => {
    // Claude Code accepted `Eval` before `REPL`; a settings file or permission
    // rule naming the old spelling has to land on this tool. Re-exported from the
    // constants so registration and the deferral judgment cannot disagree.
    expect(execToolAliases).toEqual([...REPL_TOOL_ALIASES]);
    expect(execToolAliases).toContain("Eval");
  });

  it("is not concurrency-safe — it reaches arbitrary MCP tools", () => {
    expect(execTool.isConcurrencySafe).toBe(false);
  });

  it("is the same text the tool manager declares", () => {
    expect(execTool.prompt!()).toBe(execTool.config.function.description);
  });

  it("renders the same bytes for any pool", () => {
    // `tools[]` sits inside the cached prefix: a description that mentioned the
    // session's tools would rewrite that prefix whenever a server connected. The
    // pool is a tail announcement instead (`exec/catalogAnnouncement.ts`).
    const withPool = execTool.prompt!({
      availableTools: ["Read", "mcp__srv__a", "mcp__srv__b"],
    });
    const withoutPool = execTool.prompt!({ availableTools: [] });
    expect(withPool).toBe(withoutPool);
    expect(withPool).not.toContain("mcp__");
    expect(withPool).not.toContain("srv");
    expect(withPool).not.toContain("PARTIAL");
  });

  it("teaches the search entry point its own shape", () => {
    // The pool is announced by name only, so search is the one entry whose
    // parameters have to be in the description: left out, the model can only
    // guess a name and wait for the error to correct it.
    const indented = renderSearchSignature()
      .split("\n")
      .map((line) => `  ${line}`)
      .join("\n");
    expect(execTool.prompt!()!).toContain(indented);
    // Search results carry no return type any more; `describeTool` is the channel.
    expect(execTool.prompt!()!).not.toContain("gives each tool's return type");
    expect(execTool.prompt!()!).toContain("describeTool(name)");
  });

  it("keeps the lean prompt to the one-line call form", () => {
    const lean = execTool.leanPrompt;
    expect(typeof lean).toBe("string");
    expect(String(lean)).toContain(renderSearchCallForm());
    expect(String(lean)).not.toMatch(/^- - /m);
  });
});

describe("execTool description", () => {
  function description(): string {
    return execTool.prompt!()!;
  }

  it("asks for one call, and says why", () => {
    expect(description()).toContain("Put every operation in ONE call");
    expect(description()).toContain("full model round-trip");
    // The reason has to be the round-trip, not a vague "be efficient".
    expect(description()).toMatch(/inside the script are essentially free/);
  });

  it("defines what the output is", () => {
    expect(description()).toContain("value of the last expression");
    expect(description()).toContain("self.log(...)");
    expect(description()).toContain("awaited for you");
    expect(description()).toContain("const p = f(); use(p)");
  });

  it("separates the console ring from self.log, and names preview's default", () => {
    expect(description()).toContain("in-memory ring");
    expect(description()).toContain("console.tail(n)");
    expect(description()).toContain("console.buffer()");
    expect(description()).toContain("console.dropped()");
    expect(description()).toContain("preview(value, n?)");
    expect(description()).toContain("first 200 characters by default");
  });

  it("states the per-part cap and the escaping", () => {
    expect(description()).toContain(String(EXEC_PART_CHAR_LIMIT));
    expect(description()).toContain("chars elided");
    expect(description()).toContain("head and the tail");
    expect(description()).toContain("&amp;");
    expect(description()).toContain("&lt;");
    expect(description()).toContain("&gt;");
    // Escaping is display-only and the description has to say so, or the model
    // will think the value itself changed.
    expect(description()).toMatch(/display only/);
  });

  it("explains the async lane, receipts included", () => {
    expect(description()).toContain("(dispatched #N)");
    expect(description()).toMatch(/already running/);
    expect(description()).toContain("runs it twice");
    expect(description()).toContain("`Poll`");
    expect(description()).toContain(
      `after ${EXEC_SHELL_DEFAULT_WAIT_MS / 60_000} minutes`,
    );
    expect(description()).toContain(
      `after ${EXEC_BACKGROUND_MAX_MS / 3_600_000} hours`,
    );
  });

  it("bounds the persistent context", () => {
    for (const boundary of ["restart", "resume", "fork", "wake"]) {
      expect(description()).toContain(boundary);
    }
    expect(description()).toContain("context is new");
  });

  it("gives the two shell spellings", () => {
    expect(description()).toContain("heredoc");
    expect(description()).toContain("here-string");
    expect(description()).toMatch(/single quote/);
    // `$` and Bash are the two doors to a command; the sandbox has no child_process.
    expect(description()).toContain("child_process");
  });

  it("states the ask-mode ceiling and what it counts", () => {
    expect(description()).toContain(`${EXEC_ASK_MODE_TOTAL_MS} ms`);
    expect(description()).toContain("approval prompt");
    expect(description()).toMatch(/counts from the start/);
  });

  it("declares the globals the sandbox actually injects", () => {
    for (const injected of [
      "tools.list()",
      "running()",
      "self.log(...)",
      "describeTool(name)",
      "searchTools(query, max?)",
      "preview(value, n?)",
      "setTimeout",
      "clearTimeout",
      "setInterval",
      "clearInterval",
    ]) {
      expect(description()).toContain(injected);
    }
  });

  it("warns subagents about tools they were not granted", () => {
    expect(description()).toContain("tools[]");
    expect(description()).toMatch(/not granted/);
    expect(description()).toContain("tools.list()");
  });
});

describe("execTool compact params", () => {
  /** The hook takes a context; the description must not be read from it. */
  function preview(params: Record<string, unknown>): string {
    return execTool.formatCompactParams!(params, {} as unknown as ToolContext);
  }

  it("returns the model's description verbatim", () => {
    // No prefix, no rewrite, no truncation — the row already prints the name.
    expect(
      preview({
        code: "return await tools.Read({ file_path: 'x' });",
        description: "Search the web for today's news",
      }),
    ).toBe("Search the web for today's news");
  });

  it("returns nothing without a description", () => {
    // Unlike Bash there is no fallback (`command` has no script equivalent), and
    // the first line of a multi-line blob usually says nothing.
    expect(preview({ code: "await tools.Read({});" })).toBe("");
  });

  it("returns nothing for an empty or non-string description", () => {
    expect(preview({ code: "return 1;", description: "" })).toBe("");
    expect(preview({ code: "return 1;", description: 42 })).toBe("");
    expect(preview({ code: "return 1;", description: null })).toBe("");
  });
});

describe("execTool execution", () => {
  it("requires code and never starts a script without it", async () => {
    const result = await execTool.execute({}, contextWith());
    expect(result.success).toBe(false);
    expect(result.error).toContain(`missing required parameter "code"`);
    // A parameter error must not cost a context start or a resume.
    expect(runReplScript).not.toHaveBeenCalled();
  });

  it("rejects blank code", async () => {
    const result = await execTool.execute({ code: "   \n " }, contextWith());
    expect(result.success).toBe(false);
    expect(result.error).toContain("missing required parameter");
    expect(runReplScript).not.toHaveBeenCalled();
  });

  it("reports a missing tool manager instead of throwing", async () => {
    const result = await execTool.execute({ code: "return 1;" }, {
      workdir: "/tmp",
    } as unknown as ToolContext);
    expect(result.success).toBe(false);
    expect(result.error).toContain("tool manager is not available");
    expect(runReplScript).not.toHaveBeenCalled();
  });

  it("passes the model's timeout through to the runtime", async () => {
    await execTool.execute(
      { code: "return 1;", timeout: 45_000 },
      contextWith(),
    );
    expect(runReplScript).toHaveBeenCalledWith(
      expect.objectContaining({ timeout: 45_000 }),
    );
  });

  it("leaves the default and the clamp to the runtime", async () => {
    // One place decides what a missing or oversized timeout means; the tool only
    // forwards what the model wrote.
    await execTool.execute({ code: "return 1;" }, contextWith());
    expect(runReplScript.mock.calls[0][0].timeout).toBeUndefined();

    await execTool.execute(
      { code: "return 1;", timeout: 9_000_000 },
      contextWith(),
    );
    expect(runReplScript.mock.calls[1][0].timeout).toBe(9_000_000);
  });

  it("runs against the pool the manager offers", async () => {
    const pool: ExecPoolEntry[] = [{ name: "Read", isMcp: false }];
    await execTool.execute({ code: "return 1;" }, contextWith({ pool }));
    expect(runReplScript).toHaveBeenCalledWith(
      expect.objectContaining({ pool }),
    );
  });

  it("forwards the session's permission mode", async () => {
    // The runtime derives the ask-mode ceiling from it; the tool only relays what
    // the session already decided.
    await execTool.execute({ code: "return 1;" }, {
      ...contextWith(),
      permissionMode: "plan",
    } as ToolContext);
    expect(runReplScript).toHaveBeenCalledWith(
      expect.objectContaining({ permissionMode: "plan" }),
    );
  });

  it("files the run under the agent's own REPL context key", async () => {
    // One context per `(session, agent)`: a subagent shares the session but not the
    // variables, and this key is also what the agent releases on the way out.
    await execTool.execute({ code: "return 1;" }, {
      ...contextWith(),
      replSessionKey: "session-1::7",
    } as ToolContext);
    expect(runReplScript).toHaveBeenCalledWith(
      expect.objectContaining({ sessionKey: "session-1::7" }),
    );
  });

  it("renders the markup contract: attributes and fixed child order", async () => {
    runReplScript.mockResolvedValue(
      runResult({
        value: "42",
        logs: ["step one"],
        stderr: ["warning: deprecated"],
        toolsUsed: ["Read", "Grep"],
        refusedCalls: ["Bash"],
      }),
    );

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.success).toBe(true);
    expect(withoutMs(result.content)).toBe(
      [
        '<repl-output ms="0">',
        "<tools>Read, Grep</tools>",
        "<refused>Bash</refused>",
        "<log>step one</log>",
        "<log>[stderr] warning: deprecated</log>",
        "<result>42</result>",
        "</repl-output>",
      ].join("\n"),
    );
  });

  it("adds the eval attribute when the context reports a script number", async () => {
    // The published result type carries the id only on the dispatch path; when a
    // finished run reports one too, it belongs in the opening tag.
    runReplScript.mockResolvedValue(
      Object.assign(runResult({ value: "1", toolsUsed: ["Read"] }), {
        evalId: 7,
      }),
    );

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.content.startsWith('<repl-output eval="7" ms="')).toBe(true);
  });

  it("leaves out a section the script never produced", async () => {
    // A self-closed `<tools/>` / `<refused/>` on every answer is not "nothing
    // here", it is a claim the model has to explain away: a real run had it
    // guess `<refused/>` meant "the host refused a decorative step".
    runReplScript.mockResolvedValue(runResult({ logs: ["hello"] }));

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(withoutMs(result.content)).toBe(
      [
        '<repl-output ms="0">',
        "<log>hello</log>",
        `<result>${NO_OUTPUT_TEXT}</result>`,
        "</repl-output>",
      ].join("\n"),
    );
  });

  it("writes an empty child element as a self-closing tag", async () => {
    runReplScript.mockResolvedValue(runResult({ logs: [""] }));

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(withoutMs(result.content)).toBe(
      [
        '<repl-output ms="0">',
        "<log/>",
        `<result>${NO_OUTPUT_TEXT}</result>`,
        "</repl-output>",
      ].join("\n"),
    );
  });

  it("escapes &, < and > in every part", async () => {
    runReplScript.mockResolvedValue(
      runResult({
        toolsUsed: ["Read"],
        logs: ["if (a < b && c > d)"],
        value: '{"k":"<v>"}',
      }),
    );

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.content).toContain(
      "<log>if (a &lt; b &amp;&amp; c &gt; d)</log>",
    );
    expect(result.content).toContain('<result>{"k":"&lt;v&gt;"}</result>');
  });

  it("falls back to the text form when there is nothing structured", async () => {
    runReplScript.mockResolvedValue(runResult({ value: "hello" }));
    const result = await execTool.execute({ code: "return 1;" }, contextWith());
    expect(result.content).toBe("result:\nhello");
  });

  it("falls back to the text form for a bare failure", async () => {
    runReplScript.mockResolvedValue(runResult({ ok: false, error: "boom" }));
    const result = await execTool.execute({ code: "return 1;" }, contextWith());
    expect(result.success).toBe(false);
    expect(result.content).toBe("error:\nboom");
    expect(result.error).toBe("boom");
  });

  it("says so when a script neither returns nor logs", async () => {
    const result = await execTool.execute({ code: "return 1;" }, contextWith());
    expect(result.content).toBe(`result:\n${NO_OUTPUT_TEXT}`);
  });

  it("caps the result at the per-part limit, keeping head and tail", async () => {
    const head = "A".repeat(18_000);
    const middle = "M".repeat(22_000);
    const tail = "Z".repeat(12_000);
    runReplScript.mockResolvedValue(runResult({ value: head + middle + tail }));

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.content).toContain(
      `... [${head.length + middle.length + tail.length - EXEC_PART_CHAR_LIMIT} chars elided] ...`,
    );
    // 60% of the cap from the head, the rest from the tail, nothing from between.
    expect(result.content).toContain(head);
    expect(result.content).toContain(tail);
    expect(result.content).not.toContain("M");
    expect(result.content.length).toBeLessThan(EXEC_PART_CHAR_LIMIT + 1_000);
  });

  it("caps each log entry on its own", async () => {
    // A wall of log output must not eat the budget of the value the model asked
    // for: the cap is per part, not per result.
    runReplScript.mockResolvedValue(
      runResult({
        toolsUsed: ["Read"],
        logs: ["A".repeat(40_000), "short"],
        value: "ok",
      }),
    );

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.content).toContain("... [10000 chars elided] ...");
    expect(result.content).toContain("<log>short</log>");
    expect(result.content).toContain("<result>ok</result>");
  });

  it("tells the model the whole value is still in the REPL", async () => {
    runReplScript.mockResolvedValue(
      runResult({ value: "A".repeat(40_000), toolsUsed: ["Read"] }),
    );

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.content).toContain("still under its key in the REPL context");
    expect(result.content).toContain(
      "instead of reading it again or re-running anything",
    );
  });

  it("answers a dispatched script with a receipt instead of a result", async () => {
    runReplScript.mockResolvedValue(runResult({ dispatched: 4 }));

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.success).toBe(true);
    expect(result.content.split("\n")[0]).toBe("(dispatched #4)");
    // The receipt is the one thing that stops a second submission.
    expect(result.content).toContain("would run it twice");
    expect(result.content).toContain("Poll");
    expect(result.content).not.toContain("<repl-output");
  });

  it("keeps the receipt shape for a refused dispatch", async () => {
    runReplScript.mockResolvedValue(
      runResult({
        ok: false,
        dispatched: 9,
        error: "REPL concurrency limit reached (8). Wait with `Poll`.",
      }),
    );

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.success).toBe(false);
    expect(result.content.split("\n")[0]).toBe("(dispatched #9)");
    expect(result.content).toContain("concurrency limit");
    expect(result.error).toContain("concurrency limit");
  });

  it("says the context is new after a reset", async () => {
    runReplScript.mockResolvedValue(
      runResult({ contextReset: true, value: "1" }),
    );

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.content.startsWith("result:\n1")).toBe(true);
    expect(result.content).toContain("This is a new REPL context");
  });

  it("reports 0 tool calls when nothing was reached", async () => {
    const result = await execTool.execute({ code: "return 1;" }, contextWith());
    expect(result.shortResult).toBe("0 tool calls");
    expect(result.nestedToolCalls).toBeUndefined();
  });

  it("lists the count, then the last two calls, marking the cut", async () => {
    runReplScript.mockImplementation(async (options) => {
      const names = ["mcp__srv__a", "mcp__srv__b", "mcp__srv__c"];
      for (const name of names) options.onToolCall?.(name, {});
      return runResult({ toolsUsed: names });
    });

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.shortResult).toBe(
      "... 3 tool calls\nmcp__srv__b\nmcp__srv__c",
    );
  });

  it("puts each call's compact parameter next to its name", async () => {
    // The row has to say what the script is doing, not only which tools it
    // touched: same rule as the Agent tool's short result (`Read src/app.ts`).
    runReplScript.mockImplementation(async (options) => {
      options.onToolCall?.("Read", { file_path: "src/app.ts" });
      options.onToolCall?.("Bash", { command: "wc -l README.md" });
      return runResult({ toolsUsed: ["Read", "Bash"] });
    });

    const result = await execTool.execute(
      { code: "return 1;" },
      contextWith({
        tools: [
          { name: "Read", formatCompactParams: () => "src/app.ts" },
          { name: "Bash", formatCompactParams: () => "wc -l README.md" },
        ],
      }),
    );

    expect(result.shortResult).toBe(
      "2 tool calls\nRead src/app.ts\nBash wc -l README.md",
    );
  });

  it("falls back to the argument tail when a tool has no compact summary", async () => {
    // MCP tools have no `formatCompactParams` of their own; a bare name would
    // leave the user unable to tell two calls to the same server apart.
    const query = "a".repeat(40);
    runReplScript.mockImplementation(async (options) => {
      options.onToolCall?.("mcp__srv__search", { query });
      return runResult({ toolsUsed: ["mcp__srv__search"] });
    });

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.shortResult).toBe(
      `1 tool call\nmcp__srv__search …${`{"query":"${query}"}`.slice(-30)}`,
    );
  });

  it("keeps the call a bare name when its arguments say nothing", async () => {
    // `{}` is not something to show: the same call with no arguments would have
    // read `mcp__srv__ping {}` on every row.
    runReplScript.mockImplementation(async (options) => {
      options.onToolCall?.("mcp__srv__ping", {});
      return runResult({ toolsUsed: ["mcp__srv__ping"] });
    });

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.shortResult).toBe("1 tool call\nmcp__srv__ping");
  });

  it("keeps every call, repeats included, in the structured record", async () => {
    // A deferred tool leaves no block of its own, so this record is the only
    // trace a host-side judgment can read.
    runReplScript.mockImplementation(async (options) => {
      const names = ["mcp__srv__a", "mcp__srv__b", "mcp__srv__a"];
      for (const name of names) options.onToolCall?.(name, {});
      return runResult({ toolsUsed: ["mcp__srv__a", "mcp__srv__b"] });
    });

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.nestedToolCalls).toEqual([
      "mcp__srv__a",
      "mcp__srv__b",
      "mcp__srv__a",
    ]);
  });

  it("updates the summary while the script is still running", async () => {
    // Hold the second call open so the summary can be observed mid-run: the live
    // update is the whole point (the row is all the user sees while it runs).
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const updates: string[] = [];
    runReplScript.mockImplementation(async (options) => {
      options.onToolCall?.("mcp__srv__a", {});
      await pending;
      options.onToolCall?.("mcp__srv__b", {});
      return runResult({ toolsUsed: ["mcp__srv__a", "mcp__srv__b"] });
    });

    const running = execTool.execute(
      { code: "return 1;" },
      contextWith({ onShortResultUpdate: (summary) => updates.push(summary) }),
    );

    await vi.waitFor(() => expect(updates).toHaveLength(1));
    expect(updates[0]).toBe("1 tool call\nmcp__srv__a");

    release();
    const result = await running;

    expect(updates[updates.length - 1]).toBe(
      "2 tool calls\nmcp__srv__a\nmcp__srv__b",
    );
    expect(result.shortResult).toBe(updates[updates.length - 1]);
  });

  it("keeps what the script produced before it failed", async () => {
    runReplScript.mockResolvedValue(
      runResult({
        ok: false,
        error: "bad script",
        logs: ["before"],
        toolsUsed: ["Read"],
      }),
    );

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.success).toBe(false);
    expect(result.content).toContain("<log>before</log>");
    expect(result.content).toContain("<error>bad script</error>");
    expect(result.shortResult).toBe("failed");
    expect(result.nestedToolCalls).toEqual(["Read"]);
  });

  it("passes images from nested calls through to the tool result", async () => {
    runReplScript.mockResolvedValue(
      runResult({
        value: "screenshot",
        images: [{ data: "AAAA", mediaType: "image/png" }],
      }),
    );

    const result = await execTool.execute({ code: "return 1;" }, contextWith());

    expect(result.success).toBe(true);
    expect(result.images).toEqual([{ data: "AAAA", mediaType: "image/png" }]);
  });
});
