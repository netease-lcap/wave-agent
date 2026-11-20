import { EXEC_TOOL_NAME, REPL_TOOL_ALIASES } from "../constants/tools.js";
import {
  EXEC_SEARCH_EXPRESSION,
  renderSearchCallForm,
  renderSearchSignature,
} from "../exec/catalog.js";
import {
  EXEC_ASK_MODE_TOTAL_MS,
  EXEC_BACKGROUND_MAX_MS,
  EXEC_DEFAULT_TIMEOUT_MS,
  EXEC_MAX_TIMEOUT_MS,
  EXEC_PART_CHAR_LIMIT,
  EXEC_SHELL_DEFAULT_WAIT_MS,
} from "../exec/constants.js";
import { runReplScript, type ReplRunResult } from "../exec/execRuntime.js";
import type { ToolContext, ToolPlugin, ToolResult } from "./types.js";

/**
 * Other names this tool answers to besides the one it declares.
 *
 * Re-exported from `constants/tools.ts` so a host registering the tool under the
 * older spelling (`Eval`, which Claude Code accepted before `REPL`) has the same
 * source of truth as the deferral judgment, which already treats those names as
 * carriers of this tool (`exec/deferral.ts`).
 */
export const execToolAliases: readonly string[] = REPL_TOOL_ALIASES;

/**
 * `preview()`'s default cut, in characters.
 *
 * Spelled here because the description teaches the model what it gets: the
 * sandbox owns the behaviour, but a description that stayed silent about the
 * default would leave the model guessing how much of a long value it may look at.
 */
const PREVIEW_DEFAULT_CHARS = 200;

/** `$` command wait before the command moves to the background, in minutes. */
const SHELL_WAIT_MINUTES = EXEC_SHELL_DEFAULT_WAIT_MS / 60_000;

/** Wall-clock ceiling of one background script, in hours. */
const BACKGROUND_MAX_HOURS = EXEC_BACKGROUND_MAX_MS / 3_600_000;

/**
 * The `search` bullet of the sandbox API blurb. It names the entry point and its
 * purpose; the call form follows it, in one of the two shapes below.
 *
 * The path is the very expression the signature renderer uses, and both come from
 * the constant the sandbox assigns the entry under, so the two cannot drift.
 *
 * The entry is a bare global now, so `tools.<name>` is mentioned as the compat
 * spelling rather than as the canonical one: a script writes
 * `searchTools("...")`, exactly as the reference implementation teaches.
 */
const SEARCH_ENTRY =
  `- \`${EXEC_SEARCH_EXPRESSION}(query, max?)\` — ` +
  "find a tool's parameters when the pool only announced its name, so this is how a call is built. " +
  `The same function is reachable as \`tools.${EXEC_SEARCH_EXPRESSION}(query, max?)\`.`;

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
 * messages teach or from what the host accepts. Search results carry no return
 * type (`searchTools` answers `name`/`about`/`input` only); the return type of a
 * tool comes from `describeTool`.
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
 * `exec/catalogAnnouncement.ts`.
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
const EXEC_DESCRIPTION = `Run JavaScript in a long-lived REPL where this session's on-demand tools are globals, so a whole sequence of calls is composed in a single turn instead of one model round-trip per call.

Guidelines:
- Put every operation in ONE call. Each call to this tool is a full model round-trip, while round-trips between statements inside the script are essentially free — so reading five files, grepping two patterns and making one edit belongs in a single script rather than in five calls.
- Output is the value of the last expression plus every line written with \`self.log(...)\`. A Promise inside the returned value is awaited for you; a Promise you use inline (\`const p = f(); use(p)\`) must be awaited yourself.
- \`console.log(...)\` (any \`console.*\`) writes to an in-memory ring and does NOT reach the output — read it back with \`console.tail(n)\`, \`console.buffer()\` or \`console.dropped()\`. Only \`self.log(...)\` is returned. \`preview(value, n?)\` stringifies a value and keeps the first ${PREVIEW_DEFAULT_CHARS} characters by default, which is how to look at a long value without paying for all of it.
- Every output part (each log entry, the result value) is capped at about ${EXEC_PART_CHAR_LIMIT} characters: the head and the tail are kept and the middle becomes \`... [N chars elided] ...\`. \`&\`, \`<\` and \`>\` in output are escaped as \`&amp;\`, \`&lt;\` and \`&gt;\` — that is display only, nothing in a file or in a value changes.
- Async: a script that finishes inside the wait window returns its result here. Past the window the call answers with a \`(dispatched #N)\` receipt instead, and the script keeps running in the background. A receipt means the script is already running (or queued), so submitting the same script again runs it twice — wait for it with \`Poll\` instead. A shell command still running after ${SHELL_WAIT_MINUTES} minutes moves to the background too, and a background script is stopped after ${BACKGROUND_MAX_HOURS} hours.
- Variables and functions declared at the top level persist across calls in this session, but not across a restart, a resume, a fork or a wake; the first result after one of those says the context is new.
- Shells: there is no \`child_process\` and no \`import\` here; run commands with the \`$\` command template or with \`Bash\`. \`$\` throws on a non-zero exit — use \`.nothrow()\` and read \`exitCode\` — single-quotes each \`\${...}\` value as one argument (\`\${{ raw: value }}\` splices it raw), and takes \`.timeout(ms)\`; past that wait the command moves to the background instead of failing, and the await resolves with \`exitCode: null\` and \`running: { taskId, outputPath }\`, so check \`running\` before using the output and read that file rather than running the command again. Feed stdin with a heredoc. In PowerShell, write every single quote twice inside a single-quoted string, and use a here-string (\`@'...'@\`) for multi-line literals.
- In ask permission mode the call waits for the script, and its ${EXEC_ASK_MODE_TOTAL_MS} ms ceiling counts from the start — including the time a person spends on an approval prompt.
- Subagents: \`tools[]\` may list tools this agent was not granted. Check \`tools.list()\` before relying on one.

Sandbox API:
- \`await tools.<name>(args)\` — call a tool with its own arguments object, e.g. \`await tools.Read({ file_path: "x" })\`. The bare global \`await Read({ file_path: "x" })\` is the same call, and a name that is not an identifier takes the bracket form \`await tools["<name>"](args)\`. Arguments are passed through field by field, and the value is the tool's own output. A built-in that fails resolves to \`{ error }\`; an MCP tool that fails throws.
${SEARCH_ENTRY_WITH_SIGNATURE}
- \`describeTool(name)\` — one tool's description and argument schema; this is also the only place a tool's return type comes from.
- \`tools.list()\` — the tool names actually reachable in this call.
- \`self.log(...)\` — the lines that end up in the result (\`log(...)\` is the same function).
- \`running()\` — the background scripts of this context: \`id\`, \`snippet\`, \`ageMs\`, \`state\`, \`settled\`, \`self\`, \`abort()\`.
- \`setTimeout\` / \`clearTimeout\` / \`setInterval\` / \`clearInterval\` — the standard timers; they are cleared when the script ends, so they never fire in a later one.
- \`return <value>\` — the value is serialized and handed back to you.

It is very helpful if you write a clear, concise description of what this script does in 5-10 words.

Which tools are reachable is announced in the conversation as it changes. Every nested call goes through the same permission check and the same hooks as a flat call, so it can still be denied — the denial comes back to the script as an error it can catch.`;

/** The element a finished script renders into. */
const OUTPUT_TAG = "repl-output";

/**
 * How many of the most recent nested calls the result summary lists, mirroring
 * how the `Agent` tool lists the subagent tools it just ran.
 */
const RECENT_CALLS_SHOWN = 2;

/**
 * Share of a truncated part kept from the head. The remainder is kept from the
 * tail: the beginning of a value says what it is, the end says where it stops
 * being one, and the middle is what a summary can afford to drop.
 */
const HEAD_SHARE = 0.6;

/** Says where the rest of a cut value can be read without redoing the work. */
const FULL_VALUE_NOTE =
  "The part above was cut. The full value is still under its key in the REPL context — slice or search it there instead of reading it again or re-running anything.";

/** Says the session is talking to a context that has no memory of earlier scripts. */
const CONTEXT_RESET_NOTE =
  "This is a new REPL context: the variables, functions and timers of earlier scripts are gone.";

/** What a script that returned nothing and logged nothing gets instead of an empty part. */
const NO_OUTPUT_TEXT =
  "The script finished without a return value and without any self.log() output.";

/** Last-resort failure text when the runtime reports failure without a reason. */
const FAILURE_TEXT = "The REPL script failed.";

/**
 * One nested call as the collapsed row shows it: the tool, and what it is
 * operating on.
 *
 * The pair mirrors the `Agent` tool's short result, where each line is a
 * subagent tool followed by its own compact parameter — the row answers "what is
 * this script doing" only if the path or command is next to the tool name.
 */
interface CallLine {
  name: string;
  /** The compact parameter; empty when the call has nothing worth showing. */
  param: string;
}

/**
 * The collapsed result row: the call count, then the most recent calls with
 * what each of them is operating on.
 *
 * No tool-name prefix on the row itself: the row this text sits in already
 * prints the tool name. Derived from the calls the sandbox actually issued, so
 * it can be rendered mid-run as well as at the end.
 */
function formatSummary(calls: readonly CallLine[]): string {
  const count = calls.length;
  const lines: string[] = [
    `${count > RECENT_CALLS_SHOWN ? "... " : ""}${count} tool call${
      count === 1 ? "" : "s"
    }`,
  ];
  for (const call of calls.slice(-RECENT_CALLS_SHOWN)) {
    lines.push(call.param ? `${call.name} ${call.param}` : call.name);
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
 * The script number a context assigned to this run, when the runtime reports one.
 *
 * The published result carries the number only on the dispatch path
 * (`dispatched`); a finished script's id is read opportunistically so the
 * `eval="N"` attribute is rendered whenever it is available and omitted when it
 * is not (the spec allows the attribute to be absent).
 */
function evalIdOf(result: ReplRunResult): number | undefined {
  const id = (result as ReplRunResult & { evalId?: unknown }).evalId;
  return typeof id === "number" ? id : undefined;
}

/**
 * Escape the three characters that would otherwise be read as markup.
 *
 * Display only: the value the script produced is untouched, and a model that
 * copies the escaped text back into a file gets the entity, not the character —
 * which is why the description says so.
 */
function escapeOutput(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** A part of the output, after the per-part character cap was applied. */
interface CutPart {
  /** The text as it goes into the output: head, marker and tail when it was cut. */
  text: string;
  /** Characters dropped from the middle; 0 when the part fitted. */
  elided: number;
}

/**
 * Apply the per-part cap: head and tail kept, middle replaced by a marker naming
 * how much was dropped.
 *
 * The cap is per part rather than per result because the parts answer different
 * questions — a wall of `self.log` output must not eat the budget of the one
 * value the model actually asked for.
 */
function cutPart(text: string): CutPart {
  if (text.length <= EXEC_PART_CHAR_LIMIT) return { text, elided: 0 };
  const headChars = Math.floor(EXEC_PART_CHAR_LIMIT * HEAD_SHARE);
  const tailChars = EXEC_PART_CHAR_LIMIT - headChars;
  const elided = text.length - EXEC_PART_CHAR_LIMIT;
  return {
    text: `${text.slice(0, headChars)}\n... [${elided} chars elided] ...\n${text.slice(
      text.length - tailChars,
    )}`,
    elided,
  };
}

/** One child element; an empty body is written as `<tag/>`, never as an empty pair. */
function element(tag: string, body: string): string {
  return body.length === 0
    ? `<${tag}/>`
    : `<${tag}>${escapeOutput(body)}</${tag}>`;
}

/** Every tool the script reached, repeats collapsed, in first-call order. */
function toolNames(
  result: ReplRunResult,
  calls: readonly string[],
): readonly string[] {
  return [...new Set(result.toolsUsed ?? calls)];
}

/** Everything the script handed over, one entry per `<log>` element. */
function logParts(result: ReplRunResult): string[] {
  return [
    ...result.logs,
    ...(result.stderr ?? []).map((line) => `[stderr] ${line}`),
  ];
}

/**
 * Whether the answer has any structure to carry.
 *
 * A structured answer gets the markup form; one that is nothing but an outcome —
 * a value or an error, with no calls and no logs — falls back to a plain text
 * form, because wrapping a lone string in elements is noise the model has to
 * read past.
 */
function isStructured(
  result: ReplRunResult,
  calls: readonly string[],
  logs: readonly string[],
): boolean {
  return (
    toolNames(result, calls).length > 0 ||
    (result.refusedCalls?.length ?? 0) > 0 ||
    logs.length > 0
  );
}

/**
 * The outcome section: the script's value on success, the reason on failure.
 *
 * One function for both renderers, so the markup form and the text form cannot
 * disagree about what counts as "no output" or about when the note pointing back
 * at the REPL context is due.
 */
function outcomePart(
  result: ReplRunResult,
  notes: string[],
): { tag: "result" | "error"; body: string } {
  if (!result.ok) {
    return {
      tag: "error",
      body: result.error?.trim() ? result.error : FAILURE_TEXT,
    };
  }
  // `undefined` is what a script without a `return` serializes to, and it must
  // read as "nothing came back" rather than as the string "undefined".
  const value = result.value ?? "";
  if (value.length === 0 || value === "undefined") {
    return { tag: "result", body: NO_OUTPUT_TEXT };
  }
  const part = cutPart(value);
  if (part.elided > 0) notes.push(FULL_VALUE_NOTE);
  return { tag: "result", body: part.text };
}

/** The `<repl-output>` form: fixed child order, every part capped separately. */
function renderMarkup(
  result: ReplRunResult,
  calls: readonly string[],
  logs: readonly string[],
  elapsedMs: number | undefined,
  notes: string[],
): string {
  const evalId = evalIdOf(result);
  const lines: string[] = [
    `<${OUTPUT_TAG}${evalId === undefined ? "" : ` eval="${evalId}"`}${
      elapsedMs === undefined ? "" : ` ms="${elapsedMs}"`
    }>`,
  ];
  // A section the script never produced is left out rather than written empty.
  // A self-closed `<refused/>` on every answer reads as "something was refused"
  // to a model that has no way to tell it apart from a real one.
  const tools = toolNames(result, calls);
  if (tools.length > 0) lines.push(element("tools", tools.join(", ")));
  const refused = result.refusedCalls ?? [];
  if (refused.length > 0) lines.push(element("refused", refused.join(", ")));
  for (const log of logs) {
    lines.push(element("log", cutPart(log).text));
  }
  const outcome = outcomePart(result, notes);
  lines.push(element(outcome.tag, outcome.body));
  lines.push(`</${OUTPUT_TAG}>`);
  return lines.join("\n");
}

/**
 * The text form, for an answer with nothing structured in it: the sections the
 * spec fixes, one after another.
 *
 * Only the outcome section can appear here in practice — a log line or a refused
 * call is itself structure, which is what sends an answer to the markup form —
 * but the two stream labels are rendered from the same data so the two forms
 * cannot disagree about what a stream is called.
 */
function renderText(result: ReplRunResult, notes: string[]): string {
  const sections: string[] = [];
  const stdout = result.logs.join("\n");
  if (stdout.length > 0) sections.push(`stdout:\n${cutPart(stdout).text}`);
  const stderr = (result.stderr ?? []).join("\n");
  if (stderr.length > 0) sections.push(`stderr:\n${cutPart(stderr).text}`);
  const outcome = outcomePart(result, notes);
  sections.push(`${outcome.tag}:\n${outcome.body}`);
  return sections.join("\n\n");
}

/**
 * The receipt a dispatched script answers with, instead of a result.
 *
 * It has to say what it means, not just that something happened: the model that
 * reads `(dispatched #7)` and nothing else submits the same script again, and the
 * host deliberately does not deduplicate — so running it twice is exactly what a
 * silent receipt causes.
 */
function renderDispatched(dispatched: number, result: ReplRunResult): string {
  const lines = [`(dispatched #${dispatched})`];
  if (result.ok) {
    lines.push(
      "The script is already running (or queued), so submitting it again would run it twice — wait for its result with `Poll` instead.",
    );
  } else {
    lines.push(
      result.error?.trim()
        ? result.error
        : `${FAILURE_TEXT} The script was not started.`,
    );
  }
  return lines.join("\n");
}

/**
 * Turn one run into a tool result.
 *
 * `success` follows the runtime's verdict; a dispatch receipt is a successful
 * answer to the call itself even though the script has not finished (the
 * concurrency refusal is the one receipt that is a failure).
 *
 * Exported because a background script's outcome is rendered by the same function
 * whether it arrives in `Poll`'s answer or as a `<event kind="repl-eval">` message:
 * one renderer, so the two can never disagree about what a result looks like.
 * `elapsedMs` is absent for a background outcome — nobody was waiting on the clock.
 */
export function formatReplRun(
  result: ReplRunResult,
  calls: readonly string[],
  elapsedMs?: number,
): ToolResult {
  const called = calls.length > 0 ? [...calls] : [...(result.toolsUsed ?? [])];
  const notes: string[] = [];

  let content: string;
  if (result.dispatched !== undefined) {
    content = renderDispatched(result.dispatched, result);
  } else {
    const logs = logParts(result);
    content = isStructured(result, calls, logs)
      ? renderMarkup(result, calls, logs, elapsedMs, notes)
      : renderText(result, notes);
    if (result.contextReset) notes.push(CONTEXT_RESET_NOTE);
    if (notes.length > 0) content = [content, ...notes].join("\n");
  }

  return {
    success: result.ok,
    content,
    ...(result.ok ? {} : { error: result.error ?? FAILURE_TEXT }),
    // The renderer only knows the names — a polled background script comes back
    // as names — so its line carries no parameters. `execute` writes the richer
    // version while the parameters are still in hand.
    shortResult: result.ok
      ? formatSummary(called.map((name) => ({ name, param: "" })))
      : "failed",
    // The calls themselves, not just their summary: a deferred tool leaves no
    // block of its own, so this is the only trace a host-side judgment (e.g. the
    // task reminder's counter) has of it. Carried on failure too — a call that
    // happened still happened.
    ...(called.length > 0 ? { nestedToolCalls: called } : {}),
    ...(result.images.length > 0 ? { images: result.images } : {}),
  };
}

export const execTool: ToolPlugin = {
  name: EXEC_TOOL_NAME,
  searchHint: "run code in a sandbox to search and call the on-demand tools",
  // Nested calls reach arbitrary MCP tools, which are conservatively non-safe.
  isConcurrencySafe: false,
  config: {
    type: "function",
    function: {
      name: EXEC_TOOL_NAME,
      description: EXEC_DESCRIPTION,
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
              `Default ${EXEC_DEFAULT_TIMEOUT_MS}, capped at ${EXEC_MAX_TIMEOUT_MS}. ` +
              "Time spent waiting on a nested tool call does not count: the script is not running while it waits.",
          },
        },
        required: ["code"],
      },
    },
  },

  leanPrompt: `Run JavaScript in a long-lived REPL where this session's on-demand tools are globals, composing a whole sequence of calls in one turn instead of one model round-trip per call.

- \`await tools.<name>(args)\` — call a tool with its own arguments object; the bare global \`await <name>(args)\` is the same call, and the value is the tool's own output.
${SEARCH_ENTRY_ONELINE}
- \`self.log(...)\` — lines that go into the result; \`console.*\` goes to a ring instead (\`console.tail(n)\`), and \`return <value>\` hands a value back.
- Put every operation in one script, and write a clear, concise description of what it does in 5-10 words.
Long output is cut per part (head and tail kept). A script that outlives the wait window answers \`(dispatched #N)\`: it is already running, so wait with \`Poll\` rather than sending it again. Variables persist across calls, but not across a restart or resume. Every nested call still goes through the permission check, so it can be denied.`,
  prompt: () => EXEC_DESCRIPTION,

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
        error: `${EXEC_TOOL_NAME}: missing required parameter "code"`,
      };
    }

    const toolManager = context.toolManager;
    if (!toolManager) {
      return {
        success: false,
        content: "",
        error: `${EXEC_TOOL_NAME}: tool manager is not available in this session`,
      };
    }

    // Recomputed here rather than reused from the declaration-time pool: a server
    // may have connected or dropped since. Declaring and running call the same
    // `ToolManager.getExecPool`, so the sandbox can never reach a tool the agent
    // could not already call directly.
    const pool = toolManager.getExecPool();
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
      onToolCall: (name, callArgs) => {
        calls.push(name);
        rowCalls.push({ name, param: callParam(name, callArgs, context) });
        context.onShortResultUpdate?.(formatSummary(rowCalls));
      },
    });
    const rendered = formatReplRun(result, calls, Date.now() - startedAt);
    // The row the turn settles on shows what each call touched; the renderer
    // has only the names, so the parameters are put back here while the run is
    // still in hand. A failed script keeps its `failed` line.
    return rendered.success && rowCalls.length > 0
      ? { ...rendered, shortResult: formatSummary(rowCalls) }
      : rendered;
  },
};
