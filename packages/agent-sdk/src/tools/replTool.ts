import { REPL_TOOL_NAME } from "../constants/tools.js";
import {
  REPL_SEARCH_EXPRESSION,
  renderSearchCallForm,
  renderSearchSignature,
} from "../repl/catalog.js";
import {
  REPL_ASK_MODE_TOTAL_MS,
  REPL_BACKGROUND_MAX_MS,
  REPL_DEFAULT_MAX_RESULT_CHARS,
  REPL_DEFAULT_TIMEOUT_MS,
  REPL_MAX_TIMEOUT_MS,
  REPL_PART_CHAR_LIMIT,
  REPL_SHELL_DEFAULT_WAIT_MS,
  REPL_SYNC_WAIT_MS,
} from "../repl/constants.js";
import { runReplScript } from "../repl/replRuntime.js";
import {
  renderReplResultData,
  replResultDataOf,
  REPL_FAILURE_TEXT,
} from "./resultData/repl.js";
import type { ToolContext, ToolPlugin, ToolResult } from "./types.js";

/**
 * `preview()`'s default cut, in characters.
 *
 * Spelled here because the description teaches the model what it gets: the
 * sandbox owns the behaviour, but a description that stayed silent about the
 * default would leave the model guessing how much of a long value it may look at.
 */
const PREVIEW_DEFAULT_CHARS = 200;

/** `$` command wait before the command moves to the background, in minutes. */
const SHELL_WAIT_MINUTES = REPL_SHELL_DEFAULT_WAIT_MS / 60_000;

/** Wall-clock ceiling of one background script, in hours. */
const BACKGROUND_MAX_HOURS = REPL_BACKGROUND_MAX_MS / 3_600_000;

/**
 * The `search` bullet of the sandbox API blurb. It names the entry point and its
 * purpose; the call form follows it, in one of the two shapes below.
 *
 * The path is the very expression the signature renderer uses, and both come from
 * the constant the sandbox assigns the entry under, so the two cannot drift.
 *
 * The entry is a bare global only, as the reference implementation declares it
 * (`declare function searchTools`, beside `setTimeout`) — not a member of `tools`,
 * which carries only `list()` and the pool's tool names. Offering `tools.searchTools` here
 * would teach a spelling the sandbox rejects with `is not a function`.
 */
const SEARCH_ENTRY =
  `- \`${REPL_SEARCH_EXPRESSION}(query, max?)\` — ` +
  "find a tool's parameters when the pool only announced its name, so this is how a call is built.";

/**
 * The bullet with the entry point's own signature indented under it.
 *
 * This one signature has to be spelled out, unlike every other tool's. The pool is
 * announced by name only, and turning a name into a signature means calling this
 * entry — but it is not in the pool, so it is the one entry whose own shape has no
 * channel to be looked up on. Omitted, the model can only guess a parameter name
 * and wait for the error to correct it.
 *
 * Rendered, never written out by hand, so it cannot drift from the form the error
 * messages teach or from what the host accepts. A search hit carries both types
 * (`name`/`about`/`input`/`output`), and `describeTool` answers the same pair, so
 * the model can plan the next step from either — the rendered forms come from one
 * source, the tool `outputSchema` the signature uses.
 */
const SEARCH_ENTRY_WITH_SIGNATURE = [
  SEARCH_ENTRY,
  ...renderSearchSignature()
    .split("\n")
    .map((line) => `  ${line}`),
].join("\n");

/**
 * The bullet in its one-line form, for the lean prompt: a block of field docs is the
 * one thing a prompt that exists to be short cannot carry. Same renderer the error
 * messages use, so the two cannot disagree about a parameter.
 */
const SEARCH_ENTRY_ONELINE = `${SEARCH_ENTRY} Call it as \`${renderSearchCallForm()}\`.`;

/**
 * Model-visible API description.
 *
 * Static on purpose, and not merely "no tunable limits in it": it must be identical
 * for any tool pool. `tools[]` sits in the cached prefix, so a description that
 * mentioned the session's servers (or their tools) would rewrite that prefix every
 * time one connected or dropped. The pool is a tail announcement instead — see
 * `repl/catalogAnnouncement.ts`.
 *
 * The numbers it does carry are the contract the model has to reason *with*
 * (`timeout` bounds, per-part output cap, the shell's background window, the ask
 * mode ceiling), and every one of them is rendered from the constant the runtime
 * uses, so prose cannot teach a limit the sandbox does not hold. They describe
 * behaviour, not this session's pool, so the bytes stay identical either way.
 *
 * The guidelines follow the story「描述与提示词讲清这个上下文怎么用」point by
 * point: one call for everything, what counts as output, the two logging channels,
 * truncation and escaping, the async lane, what does not survive a resume, the two
 * shell spellings, the ask-mode ceiling, and the subagent caveat.
 */
const REPL_DESCRIPTION = `Run JavaScript in a long-lived REPL where this session's on-demand tools are globals, so a whole sequence of calls is composed in a single turn instead of one model round-trip per call.

Guidelines:
- Put every operation in ONE call. Each call to this tool is a full model round-trip, while round-trips between statements inside the script are essentially free — so reading five files, grepping two patterns and making one edit belongs in a single script rather than in five calls.
- Output is the value of the last expression plus every line written with \`self.log(...)\`. A Promise inside the returned value is awaited for you; a Promise you use inline (\`const p = f(); use(p)\`) must be awaited yourself.
- \`console.log(...)\` (any \`console.*\`) writes to an in-memory ring and does NOT reach the output — read it back with \`console.tail(n)\`, \`console.buffer()\` or \`console.dropped()\`. Only \`self.log(...)\` is returned. \`preview(value, n?)\` stringifies a value and keeps the first ${PREVIEW_DEFAULT_CHARS} characters by default, which is how to look at a long value without paying for all of it.
- Every output part (each log block, the result value) is capped at about ${REPL_PART_CHAR_LIMIT} characters, and the whole answer at ${REPL_DEFAULT_MAX_RESULT_CHARS} characters: the head and the tail are kept and the middle becomes \`... [N chars elided] ...\`. \`&\`, \`<\` and \`>\` in output are escaped as \`&amp;\`, \`&lt;\` and \`&gt;\` — that is display only, nothing in a file or in a value changes.
- Async: a script that finishes inside the ${REPL_SYNC_WAIT_MS / 1000}-second wait window returns its result here. Past the window the call answers with a \`(dispatched #N)\` receipt instead, and the script keeps running in the background. The window is fixed — a larger \`timeout\` does not extend it, because \`timeout\` bounds only the script's own synchronous running. A receipt means the script is already running (or queued), so submitting the same script again runs it twice — wait for it with \`Poll\` instead. A shell command still running after ${SHELL_WAIT_MINUTES} minutes moves to the background too, and a background script is stopped after ${BACKGROUND_MAX_HOURS} hours.
- Variables and functions declared at the top level persist across calls in this session, but not across a restart, a resume, a fork or a wake; the first result after one of those says the context is new.
- Shells: there is no \`child_process\` and no \`import\` here; run commands with the \`$\` command template or with \`Bash\`. \`$\` throws on a non-zero exit outside the exit-1 family below — use \`.nothrow()\` and read \`exitCode\` — single-quotes each \`\${...}\` value as one argument (\`\${{ raw: value }}\` splices it raw), so write \`\${x}\` bare: quote marks you add around it no longer protect the value, and shell syntax inside it runs. The template text reaches the shell as written, except that a backslash before a backtick, or before an interpolation opener, is dropped — so a literal one can go in as a \`\${...}\` value, and \`$(cmd, ms)\` runs a command given as a plain string with an optional timeout in ms. It takes \`.timeout(ms)\`; past that wait the command moves to the background instead of failing, and the await resolves with \`exitCode: null\` and \`running: { taskId, outputPath, movedByUser? }\` — \`movedByUser\` is true when the user moved it there with Ctrl+B, absent when its own wait ran out — so check \`running\` before using the output and read that file rather than running the command again. Exit 1 from \`grep\` / \`rg\` / \`find\` / \`diff\` / \`test\` / \`[\` / \`git diff\` / \`git grep\` does not throw: \`exitCode\` is 1 and \`note\` says what it means (no match, files differ), so a search with no hits is not a script error. The result is \`{ stdout, stderr, exitCode, output, truncated, file?, note?, cwdNote?, running? }\` with \`.text()\` / \`.lines()\` / \`.json()\`; when the output was too large, \`truncated\` is true, \`stdout\` holds only its start and \`file\` is the path holding all of it — read that instead of running the command again. \`cwdNote\` is the shell's own line when the command moved the working directory; it is never part of \`stdout\`. \`.cwd(dir)\` and \`.env({ NAME: value })\` apply to that one command only. Feed stdin with a heredoc. In PowerShell, write every single quote twice inside a single-quoted string, and use a here-string (\`@'...'@\`) for multi-line literals.
- In ask permission mode the call waits for the script, and its ${REPL_ASK_MODE_TOTAL_MS} ms ceiling counts from the start — including the time a person spends on an approval prompt.
- Subagents: \`tools[]\` may list tools this agent was not granted. Check \`tools.list()\` before relying on one.

Sandbox API:
- \`await tools.<name>(args)\` — call a tool with its own arguments object, e.g. \`await tools.Grep({ pattern: "x" })\`. The bare global \`await Grep({ pattern: "x" })\` is the same call, and a name that is not an identifier takes the bracket form \`await tools["<name>"](args)\`. Arguments are passed through field by field, and the value is the tool's own output — for a built-in its structured \`data\` (the same object its signature declares as the return type), for an MCP tool its \`structuredContent\` or text (parsed when that text is JSON). The prose a built-in shows you is not part of the value: read a field, not a sentence. A built-in that fails resolves to \`{ error }\`; an MCP tool that fails throws.
${SEARCH_ENTRY_WITH_SIGNATURE}
- \`describeTool(name)\` — one tool's description, its argument JSON Schema and its return type as TypeScript text; \`searchTools\` hits carry the same \`input\`/\`output\` pair.
- \`tools.list()\` — the tool names actually reachable in this call.
- \`self.log(...)\` — the lines that end up in the result (\`log(...)\` is the same function).
- \`running()\` — the background scripts of this context: \`id\`, \`snippet\`, \`ageMs\`, \`state\`, \`settled\`, \`self\`, \`abort()\`.
- \`setTimeout\` / \`clearTimeout\` / \`setInterval\` / \`clearInterval\` — the standard timers; they are cleared when the script ends, so they never fire in a later one.
- \`return <value>\` — the value is serialized and handed back to you.

It is very helpful if you write a clear, concise description of what this script does in 5-10 words.

Which tools are reachable is announced in the conversation as it changes. Every nested call goes through the same permission check and the same hooks as a flat call, so it can still be denied — the denial comes back to the script as an error it can catch.`;

/**
 * How many of the most recent nested calls the result summary lists, mirroring
 * how the `Agent` tool lists the subagent tools it just ran.
 */
const RECENT_CALLS_SHOWN = 2;

/**
 * One line of the collapsed row: what it says, and whether it counts.
 *
 * The two are separate fields because they answer different questions. The
 * `searchTools` / `describeTool` helpers are *not* tool calls (spec「在沙箱内搜索
 * 工具形状」场景 13): nothing is dispatched and no budget is spent, so they must
 * not inflate `N tool calls` — but the row is the only place a person learns that
 * the script is looking a tool up, so they must still be printed, failures
 * included. Folding "shown" and "counted" into one list length made the count
 * jump for calls that never happened.
 */
interface CallLine {
  /** The line as the row prints it: `Read src/app.ts`, `searchTools: slack`. */
  text: string;
  /** Counted toward `N tool calls`: every real nested call, never a helper. */
  counted: boolean;
}

/**
 * The collapsed result row: the call count, then the most recent lines.
 *
 * No tool-name prefix on the row itself: the row this text sits in already
 * prints the tool name. Derived from the calls the sandbox actually issued, so
 * it can be rendered mid-run as well as at the end.
 */
function formatSummary(calls: readonly CallLine[]): string {
  const count = calls.reduce(
    (total, call) => total + (call.counted ? 1 : 0),
    0,
  );
  const lines: string[] = [
    `${count > RECENT_CALLS_SHOWN ? "... " : ""}${count} tool call${
      count === 1 ? "" : "s"
    }`,
  ];
  for (const call of calls.slice(-RECENT_CALLS_SHOWN)) {
    lines.push(call.text);
  }
  return lines.join("\n");
}

/** How much of a call's flattened arguments a summary line carries. */
const PARAM_TAIL_CHARS = 30;

/**
 * What one nested call is operating on, as its summary line shows it.
 *
 * Same rule as the `Agent` tool's short result: the tool's own
 * `formatCompactParams` when it has one — that is how `Read` shows a path and
 * `Bash` the command — and otherwise the tail of its arguments flattened onto
 * one line. Empty when there is nothing to say, so a call without arguments
 * stays a bare tool name instead of trailing a `{}`.
 */
function callParam(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): string {
  const plugin = context.toolManager
    ?.list?.()
    .find((candidate) => candidate.name === name);
  if (plugin?.formatCompactParams) {
    try {
      return plugin.formatCompactParams(args, context);
    } catch {
      // A formatter that cannot read its own arguments is a display problem,
      // never a reason to fail the run: fall through to the flattened tail.
    }
  }
  let flat: string;
  try {
    flat = JSON.stringify(args) ?? "";
  } catch {
    return "";
  }
  if (flat === "" || flat === "{}") return "";
  flat = flat.replace(/\n/g, "\\n");
  return flat.length > PARAM_TAIL_CHARS
    ? `…${flat.slice(-PARAM_TAIL_CHARS)}`
    : flat;
}

/**
 * How much of a helper's argument the row carries, in characters.
 *
 * Same cut the reference implementation uses for this line (`li = 200`): a
 * search query is a phrase, and a row is one line whatever the script passed.
 */
const HELPER_PARAM_CHARS = 200;

/** The row line for one nested call: the tool, then what it is operating on. */
function callLine(
  name: string,
  args: Record<string, unknown>,
  context: ToolContext,
): CallLine {
  const param = callParam(name, args, context);
  return { text: param ? `${name} ${param}` : name, counted: true };
}

/**
 * The row line for a catalog helper: `searchTools: slack message`,
 * `describeTool: Read`.
 *
 * A colon rather than the tool-call form, because this line is not a call: the
 * helper reads the pool already in memory, so what follows the name is the
 * question it was asked, not the arguments of something that ran. The same line
 * is written whether the lookup succeeds or fails — a search that throws its
 * usage error and a `describeTool` that answers `{ error }` both happened, and a
 * row that stayed silent for them would be the "script is doing nothing" display
 * this line exists to prevent.
 *
 * Only a string argument is shown: anything else is the misuse the helper is
 * about to answer, and the name on its own already says what was attempted.
 */
function helperLine(name: string, args: Record<string, unknown>): CallLine {
  const raw = name === "searchTools" ? args.query : args.name;
  const asked = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
  if (asked.length === 0) return { text: name, counted: false };
  const shown =
    asked.length > HELPER_PARAM_CHARS
      ? `${asked.slice(0, HELPER_PARAM_CHARS)}…`
      : asked;
  return { text: `${name}: ${shown}`, counted: false };
}

export const replTool: ToolPlugin = {
  name: REPL_TOOL_NAME,
  searchHint: "run code in a sandbox to search and call the on-demand tools",
  // Nested calls reach arbitrary MCP tools, which are conservatively non-safe.
  isConcurrencySafe: false,
  config: {
    type: "function",
    function: {
      name: REPL_TOOL_NAME,
      description: REPL_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          code: {
            type: "string",
            description:
              "JavaScript to run in the REPL. It may `await` tool calls and `return` a value.",
          },
          description: {
            type: "string",
            description:
              "Clear, concise description of what this script does in 5-10 words.",
          },
          timeout: {
            type: "number",
            description:
              `Wall-clock ceiling for the synchronous part of the script, in milliseconds. ` +
              `Default ${REPL_DEFAULT_TIMEOUT_MS}, capped at ${REPL_MAX_TIMEOUT_MS}. ` +
              "Time spent waiting on a nested tool call does not count: the script is not running while it waits. " +
              `It does not set the wait window (a fixed ${REPL_SYNC_WAIT_MS} ms): a script still running then answers with a dispatch receipt.`,
          },
        },
        required: ["code"],
      },
    },
  },

  leanPrompt: `Run JavaScript in a long-lived REPL where this session's on-demand tools are globals, composing a whole sequence of calls in one turn instead of one model round-trip per call.

- \`await tools.<name>(args)\` — call a tool with its own arguments object; the bare global \`await <name>(args)\` is the same call, and the value is the tool's own output (a built-in's \`data\`, an MCP tool's \`structuredContent\` or text, the text parsed when it is JSON).
${SEARCH_ENTRY_ONELINE}
- \`self.log(...)\` — lines that go into the result; \`console.*\` goes to a ring instead (\`console.tail(n)\`), and \`return <value>\` hands a value back.
- Put every operation in one script, and write a clear, concise description of what it does in 5-10 words.
Long output is cut per part (head and tail kept). A script that outlives the wait window answers \`(dispatched #N)\`: it is already running, so wait with \`Poll\` rather than sending it again. Variables persist across calls, but not across a restart or resume. Every nested call still goes through the permission check, so it can be denied.`,
  prompt: () => REPL_DESCRIPTION,

  /**
   * The parameter slot of the collapsed row, shared by the TUI and the desktop
   * UI: the model's own one-line summary of the script, taken verbatim — no
   * prefix (the row already prints the tool name), no rewrite, no truncation.
   *
   * `Bash` can fall back to the command string; a script has no equivalent, and
   * the first line of a multi-line blob usually says nothing, so an absent or
   * empty description leaves the slot blank rather than inventing text. What the
   * script actually did is the result slot's job (`formatSummary`).
   *
   * Deliberately reads nothing but the argument: no code scan, no pool, so the
   * preview cannot claim a call the script never makes.
   */
  formatCompactParams: (params: Record<string, unknown>) => {
    const description = params.description;
    return typeof description === "string" ? description : "";
  },

  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const code = typeof args.code === "string" ? args.code : "";
    // A missing or blank script is a parameter error, not a run: the context is
    // neither started nor reused, so nothing is spent on an empty call.
    if (code.trim().length === 0) {
      return {
        success: false,
        content: "",
        error: `${REPL_TOOL_NAME}: missing required parameter "code"`,
      };
    }

    const toolManager = context.toolManager;
    if (!toolManager) {
      return {
        success: false,
        content: "",
        error: `${REPL_TOOL_NAME}: tool manager is not available in this session`,
      };
    }

    // Recomputed here rather than reused from the declaration-time pool: a server
    // may have connected or dropped since. Declaring and running call the same
    // `ToolManager.getReplPool`, so the sandbox can never reach a tool the agent
    // could not already call directly.
    const pool = toolManager.getReplPool();
    // Names feed the result (markup and `nestedToolCalls`); the row carries the
    // compact parameter too, so it cannot be the same array.
    const calls: string[] = [];
    const rowCalls: CallLine[] = [];
    const startedAt = Date.now();
    const result = await runReplScript({
      code,
      // Passed through as given: the runtime owns the default and the ceiling, so
      // there is one place that decides what a missing or oversized value means.
      timeout: typeof args.timeout === "number" ? args.timeout : undefined,
      pool,
      context,
      permissionMode: context.permissionMode,
      // One context per `(session, agent)`: a subagent's variables are its own, and
      // the key is what `AIManager.releaseReplContext` files the context under when
      // the agent goes away.
      sessionKey: context.replSessionKey,
      // Report each call as it is issued, so the collapsed row shows what the
      // script is doing while it runs — the same live update the Agent tool does.
      // `searchTools` / `describeTool` come through here too, marked as helpers so
      // they show up without counting (see `CallLine`).
      onToolCall: (name, callArgs, kind) => {
        if (kind === "helper") {
          rowCalls.push(helperLine(name, callArgs));
        } else {
          calls.push(name);
          rowCalls.push(callLine(name, callArgs, context));
        }
        context.onShortResultUpdate?.(formatSummary(rowCalls));
      },
    });
    // The whole of the model-facing text comes from `data` (see
    // `resultData/repl.ts`): the tool no longer knows how a result is worded, it
    // only knows what happened. `Date.now()` is the wall clock the caller waited —
    // a background outcome has none.
    const data = replResultDataOf(result, calls, Date.now() - startedAt);
    // The names, taken once more for the two host-side fields below: `shortResult`
    // and `nestedToolCalls` are the row's and the host's record, not the model-facing
    // text, so they read the live list first (a call the tool saw still happened even
    // if the runtime stopped recording it in `toolsUsed`).
    const called =
      calls.length > 0 ? [...calls] : [...(result.toolsUsed ?? [])];
    const rendered: ToolResult = {
      success: result.ok,
      data,
      content: renderReplResultData(data),
      ...(result.ok ? {} : { error: result.error ?? REPL_FAILURE_TEXT }),
      // The renderer only knows the names — a polled background script comes back
      // as names — so its line carries no parameters. `execute` writes the richer
      // version while the parameters are still in hand. Every one of them is a call:
      // a helper never reaches `toolsUsed`.
      shortResult: result.ok
        ? formatSummary(called.map((name) => ({ text: name, counted: true })))
        : "failed",
      // The calls themselves, not just their summary: a deferred tool leaves no
      // block of its own, so this is the only trace a host-side judgment (e.g. the
      // task reminder's counter) has of it. Carried on failure too — a call that
      // happened still happened.
      ...(called.length > 0 ? { nestedToolCalls: called } : {}),
      ...(result.images.length > 0 ? { images: result.images } : {}),
    };
    // The row the turn settles on shows what each call touched; the renderer
    // has only the names, so the parameters are put back here while the run is
    // still in hand. A failed script keeps its `failed` line.
    return rendered.success && rowCalls.length > 0
      ? { ...rendered, shortResult: formatSummary(rowCalls) }
      : rendered;
  },
};
