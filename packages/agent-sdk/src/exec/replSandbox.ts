/**
 * The REPL sandbox: one long-resident `node:vm` context per (session, agent).
 *
 * Three properties are load-bearing, and each one decided the shape below.
 *
 * 1. **Same process, no worker.** The sandbox is a `node:vm` context, matching
 *    Claude Code 2.1.326 (its REPL module imports only `vm`; no
 *    `worker_threads`, no `child_process`). Isolation comes from the realm
 *    boundary in `replBoundary.ts`: every callable the script can reach is
 *    created inside the context, and every value crossing is copied or
 *    serialised, so `tool.constructor` is the sandbox's own `Function`.
 * 2. **Termination is woven into the script's source.** `vm`'s `{ timeout }`
 *    bounds one synchronous run only — `(async () => { await 0; while (true) {} })()`
 *    returns in a millisecond and then spins on the host microtask queue, where
 *    that timeout no longer applies. So `__replStep()` is injected at every loop
 *    body and at every call/await, and the counter checks both the step budget
 *    (300,000,000 default) and a sync wall clock that is refreshed each time the
 *    host hands control back. Insertions stay on their own line, so the line
 *    numbers in a stack trace are the ones the model wrote.
 * 3. **Persistence without a parser rewrite.** The body runs inside an async
 *    IIFE (that is what makes top-level `await` and `return` legal, and what lets
 *    the last expression become the value), so its declarations are
 *    function-scoped. They are copied back onto the realm's global object in a
 *    `finally`, which keeps variables and functions across runs while leaving
 *    timers per-run — they are cleared when the run that created them ends.
 */

import vm from "node:vm";
import { parse } from "acorn";
import {
  REPL_BOUNDARY_SOURCE,
  REPL_DEFAULT_STEP_BUDGET,
  REPL_SEALED_MESSAGE,
  type ReplBoundary,
  type ReplBoundaryBridge,
  type ReplBoundaryGlobals,
  type ReplBoundaryTimers,
  type ReplGlobalsConfig,
} from "./replBoundary.js";

export interface ReplSandboxHost {
  /** 调一个池内工具。宿主侧负责权限、hook、调用次数上限、中断；这里只 await。 */
  callTool(name: string, args: unknown): Promise<unknown>;
  /** searchTools(query, max) */
  searchTools(query: unknown, max: unknown): Promise<unknown>;
  /** describeTool(name) */
  describeTool(name: unknown): Promise<unknown>;
  /** 本会话当前可达的工具名（tools.list() 的数据源） */
  listToolNames(): string[];
  /** `$` 模板函数：把命令交给宿主执行，返回 {stdout, stderr, exitCode} 之类的纯数据 */
  runShell(command: string, options: unknown): Promise<unknown>;
  /** self.log(...) —— 进结果 */
  selfLog(values: unknown[]): void;
  /** console.* —— 进 ring */
  consoleWrite(level: string, values: unknown[]): void;
  consoleTail(n: number): string;
  consoleBuffer(): string;
  consoleDropped(): number;
  /** running() —— 后台脚本列表 */
  running(): unknown;
  /** 步数预算耗尽/已中止时抛出的错误文本由宿主决定 */
  stepError(): Error;
}

export interface ReplRunOptions {
  /** 本次调用的可达工具名（池），决定裸全局与 tools 对象的成员 */
  toolNames: readonly string[];
  /** vm 同步段的 wall clock 上限，毫秒 */
  timeoutMs: number;
  abortSignal?: AbortSignal;
}

export interface ReplRunOutcome {
  ok: boolean;
  /** ok 时为「最后一个表达式的值」的序列化文本 */
  value?: string;
  error?: string;
  /** 本次脚本经 self.log 产生的日志行 */
  logs: string[];
  /** 脚本里发生过顶层重名（脚本没运行）时为 true，error 已是专用文案 */
  rejected?: boolean;
}

export interface ReplSandbox {
  run(code: string, options: ReplRunOptions): Promise<ReplRunOutcome>;
  dispose(): void;
}

/** Name the script is compiled under; stack traces point at the user's lines. */
const SCRIPT_FILENAME = "repl-script.js";

/** `timeout` default and ceiling, per spec. */
const REPL_DEFAULT_TIMEOUT_MS = 30_000;
const REPL_MAX_TIMEOUT_MS = 600_000;

const ABORTED_MESSAGE = "REPL script was aborted.";

/** The one and only way a context is ever discarded mid-session. */
const CONTEXT_RESET_MESSAGE =
  "REPL context was reset: the previous script made a managed global non-configurable or broke globalThis, " +
  "so the variables and functions defined by earlier scripts are gone. Re-run the script instead of relying on them.";

/**
 * Globals the sandbox installs itself: the helpers. A top-level declaration of
 * any of these names is rejected before the script runs — the declaration would
 * write the global and so change what every later script sees.
 *
 * The refusal set has exactly three parts: these helpers, this call's tool names,
 * and the realm's JavaScript built-ins (snapshotted once in `replBoundary.ts`).
 * A name an *earlier script* defined is in none of them, so a later script may
 * reuse it and the declaration simply overwrites it. That is Claude Code's
 * `isGlobalName` set, and its refusal message names the same three parts:
 * `a helper, a tool or a JavaScript built-in`.
 */
const MANAGED_GLOBAL_NAMES = [
  "tools",
  "searchTools",
  "describeTool",
  "$",
  "preview",
  "self",
  "log",
  "running",
  "console",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "__replStep",
  "__replSync",
];

/**
 * Intrinsic surface reduction, evaluated in the realm before anything else.
 *
 * Freezing the constructor objects is what stops a script from monkey-patching
 * its way out of the realm (spec「沙箱是密封的」场景 4); the deletions drop
 * globals with no legitimate use in a bounded script — alternate code
 * generation (`WebAssembly`), callbacks scheduled outside the run (`queueMicrotask`)
 * and shared-memory plumbing.
 */
const HARDEN_SOURCE = `(() => {
  "use strict";
  const frozen = ["Object", "Function", "String", "Number", "Boolean", "Array", "RegExp", "Date", "Math", "JSON", "Promise", "Symbol", "Map", "Set", "WeakMap", "WeakSet", "Error", "TypeError", "RangeError", "EvalError", "Reflect", "Proxy"];
  for (let i = 0; i < frozen.length; i++) {
    const value = globalThis[frozen[i]];
    if (value === null || (typeof value !== "object" && typeof value !== "function")) continue;
    try { Object.freeze(value); } catch (ignored) {}
  }
  const removed = ["WebAssembly", "SharedArrayBuffer", "Atomics", "FinalizationRegistry", "WeakRef", "queueMicrotask", "ShadowRealm", "process", "require", "Buffer", "module", "fetch", "XMLHttpRequest"];
  for (let i = 0; i < removed.length; i++) {
    try { delete globalThis[removed[i]]; } catch (ignored) {}
  }
})()`;

/** Step budget for new scripts. Exposed so tests (and later, config) can shrink it. */
let replStepBudget = REPL_DEFAULT_STEP_BUDGET;

/** Override the step budget. Anything non-positive or non-finite restores the default. */
export function setReplStepBudget(budget: number): void {
  replStepBudget =
    typeof budget === "number" && Number.isFinite(budget) && budget > 0
      ? Math.floor(budget)
      : REPL_DEFAULT_STEP_BUDGET;
}

// ---------------------------------------------------------------------------
// AST helpers. Typed loosely on purpose: acorn's discriminated union is not
// worth the ceremony here, and every field is re-checked before use.
// ---------------------------------------------------------------------------

interface AstNode {
  type: string;
  start: number;
  end: number;
  loc?: { start: { line: number; column: number } } | null;
  name?: string;
  body?: AstNode | AstNode[] | null;
  declarations?: AstNode[] | null;
  id?: AstNode | null;
  expression?: AstNode | null;
  callee?: AstNode | null;
  elements?: Array<AstNode | null> | null;
  properties?: AstNode[] | null;
  key?: AstNode | null;
  left?: AstNode | null;
  right?: AstNode | null;
  argument?: AstNode | null;
  value?: AstNode | null;
  computed?: boolean;
  [key: string]: unknown;
}

function asNode(value: unknown): AstNode | null {
  if (value === null || typeof value !== "object") return null;
  const candidate = value as { type?: unknown; start?: unknown; end?: unknown };
  if (typeof candidate.type !== "string") return null;
  if (typeof candidate.start !== "number" || typeof candidate.end !== "number")
    return null;
  return value as AstNode;
}

function walkAst(node: AstNode, visit: (node: AstNode) => void): void {
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc")
      continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        const nested = asNode(item);
        if (nested) walkAst(nested, visit);
      }
      continue;
    }
    const nested = asNode(child);
    if (nested) walkAst(nested, visit);
  }
}

function statementsOf(node: AstNode): AstNode[] {
  const body = node.body;
  return Array.isArray(body) ? body : [];
}

function at(node: AstNode): string {
  const start = node.loc?.start;
  return start ? `at line ${start.line}, column ${start.column + 1}` : "";
}

// ---------------------------------------------------------------------------
// Static analysis: parse, module scan, declaration names, last expression.
// ---------------------------------------------------------------------------

interface ParsedProgram {
  ok: true;
  program: AstNode;
}

interface ParseFailure {
  ok: false;
  error: string;
}

interface ReplAnalysis {
  ok: true;
  program: AstNode;
  declarations: string[];
  /** Same-line rewrites that put a top-level declaration in function scope. */
  rewrites: Rewrite[];
  lastExpression: AstNode | null;
}

type AnalysisResult =
  | ReplAnalysis
  | { ok: false; rejected: boolean; error: string };

function parseProgram(code: string): ParsedProgram | ParseFailure {
  // Script first: it is the mode the code actually runs in (sloppy, top-level
  // `return` allowed). `import` / `export` cannot even be parsed as a script, so
  // a failure is retried as a module — that is what makes the sealed-context
  // message possible instead of acorn's "'import' and 'export' may appear only
  // with 'sourceType: module'".
  try {
    return {
      ok: true,
      program: parse(code, {
        ecmaVersion: "latest",
        sourceType: "script",
        allowReturnOutsideFunction: true,
        allowAwaitOutsideFunction: true,
        locations: true,
      }) as unknown as AstNode,
    };
  } catch (first) {
    const scriptError = first;
    try {
      return {
        ok: true,
        program: parse(code, {
          ecmaVersion: "latest",
          sourceType: "module",
          allowReturnOutsideFunction: true,
          locations: true,
        }) as unknown as AstNode,
      };
    } catch {
      return { ok: false, error: formatSyntaxError(scriptError) };
    }
  }
}

function formatSyntaxError(error: unknown): string {
  const record = error as {
    message?: unknown;
    loc?: { line: number; column: number } | null;
  } | null;
  const raw =
    record && typeof record.message === "string"
      ? record.message
      : String(error);
  const cleaned = raw.replace(/\s*\(\d+:\d+\)$/, "");
  const loc = record?.loc;
  if (!loc) return `Script syntax error: ${cleaned}`;
  return `Script syntax error: ${cleaned} at line ${loc.line}, column ${loc.column + 1}`;
}

/** All three module forms: static import/export, dynamic `import()`, `require(...)`. */
function findSealedConstruct(program: AstNode): string | null {
  let found: string | null = null;
  walkAst(program, (node) => {
    if (found !== null) return;
    if (
      node.type === "ImportDeclaration" ||
      node.type === "ImportExpression" ||
      node.type === "ExportNamedDeclaration" ||
      node.type === "ExportDefaultDeclaration" ||
      node.type === "ExportAllDeclaration"
    ) {
      found = `${REPL_SEALED_MESSAGE} (${at(node)})`;
      return;
    }
    if (node.type !== "CallExpression") return;
    const callee = asNode(node.callee);
    if (callee && callee.type === "Identifier" && callee.name === "require") {
      found = `${REPL_SEALED_MESSAGE} (${at(node)})`;
    }
  });
  return found;
}

function bindingNames(
  pattern: AstNode | null | undefined,
  out: string[],
): void {
  if (!pattern) return;
  switch (pattern.type) {
    case "Identifier":
      if (typeof pattern.name === "string") out.push(pattern.name);
      return;
    case "ObjectPattern":
      for (const property of pattern.properties ?? []) {
        if (property.type === "RestElement")
          bindingNames(asNode(property.argument), out);
        else bindingNames(asNode(property.value), out);
      }
      return;
    case "ArrayPattern":
      for (const element of pattern.elements ?? []) bindingNames(element, out);
      return;
    case "AssignmentPattern":
      bindingNames(asNode(pattern.left), out);
      return;
    case "RestElement":
      bindingNames(asNode(pattern.argument), out);
      return;
    default:
      return;
  }
}

/** Names a top-level declaration would add to (and so could overwrite in) the context. */
interface Rewrite {
  start: number;
  /** Exclusive end of the text this rewrite replaces (`start` for a pure insert). */
  removeTo: number;
  text: string;
}

interface DeclarationScan {
  names: string[];
  rewrites: Rewrite[];
}

/**
 * Collect the names a top-level declaration puts in the context, plus the
 * same-line rewrites that keep them visible to the `finally` that copies them
 * out.
 *
 * A `try {}` block is its own lexical scope, so a `const` / `let` / `class`
 * declared inside it cannot be seen by the sibling `finally` block — the run
 * would "succeed" and persist nothing. `var` and (sloppy-mode) function
 * declarations are function-scoped, so the rewrite is: `const` / `let` become
 * `var`, and `class Foo` becomes `var Foo = class Foo`. Redeclaration is the one
 * property `const` was buying, and it is no longer refused: reusing a name an
 * earlier script defined overwrites it, exactly as in Claude Code. `var` is what
 * makes that legal inside the wrapper.
 */
function scanDeclarations(program: AstNode): DeclarationScan {
  const names: string[] = [];
  const rewrites: Rewrite[] = [];
  for (const statement of statementsOf(program)) {
    if (statement.type === "VariableDeclaration") {
      for (const declarator of statement.declarations ?? []) {
        bindingNames(asNode(declarator.id), names);
      }
      const kind = typeof statement.kind === "string" ? statement.kind : "";
      if (kind === "const" || kind === "let") {
        rewrites.push({
          start: statement.start,
          removeTo: statement.start + kind.length,
          text: "var",
        });
      }
      continue;
    }
    if (statement.type === "FunctionDeclaration") {
      const id = asNode(statement.id);
      if (id && typeof id.name === "string") names.push(id.name);
      continue;
    }
    if (statement.type === "ClassDeclaration") {
      const id = asNode(statement.id);
      if (!id || typeof id.name !== "string") continue;
      names.push(id.name);
      rewrites.push({
        start: statement.start,
        removeTo: statement.start,
        text: `var ${id.name} = `,
      });
    }
  }
  return { names, rewrites };
}

/** The trailing expression statement, which becomes the run's value. */
function lastExpressionOf(program: AstNode): AstNode | null {
  const body = statementsOf(program);
  if (body.length === 0) return null;
  const last = body[body.length - 1];
  if (last.type !== "ExpressionStatement") return null;
  return asNode(last.expression);
}

function analyzeCode(code: string): AnalysisResult {
  const parsed = parseProgram(code);
  if (!parsed.ok) return { ok: false, rejected: false, error: parsed.error };
  const sealed = findSealedConstruct(parsed.program);
  if (sealed !== null) return { ok: false, rejected: false, error: sealed };
  const declarations = scanDeclarations(parsed.program);
  return {
    ok: true,
    program: parsed.program,
    declarations: declarations.names,
    rewrites: declarations.rewrites,
    lastExpression: lastExpressionOf(parsed.program),
  };
}

// ---------------------------------------------------------------------------
// Step injection.
//
// Two shapes, both inserted on a single line so the script's own line numbers
// survive verbatim:
//
// - loops get `__replStep();` at the top of the body (a tight `while (true) {}`
//   has no call expressions at all);
// - calls and awaits get wrapped as `(__replStep(), expr)`, which is valid
//   everywhere an expression is — including inside argument lists, template
//   substitutions and loop headers, where a statement would not parse.
//
// A trailing expression statement is turned into `return (expr)` so the run's
// value is the last expression, as the tool description promises.
// ---------------------------------------------------------------------------

const RANK_EXPRESSION = 0;
const RANK_LOOP_BODY = 1;
const RANK_RETURN = 2;
const RANK_DECLARATION = 3;

interface Insertion {
  pos: number;
  end: number;
  rank: number;
  text: string;
  /** Exclusive end of the text replaced; equal to `pos` for a pure insert. */
  removeTo: number;
}

function insertionsFor(
  program: AstNode,
  lastExpression: AstNode | null,
  rewrites: Rewrite[],
): Insertion[] {
  const insertions: Insertion[] = [];
  const add = (pos: number, end: number, rank: number, text: string): void => {
    insertions.push({ pos, end, rank, text, removeTo: pos });
  };
  for (const rewrite of rewrites) {
    insertions.push({
      pos: rewrite.start,
      end: rewrite.removeTo,
      rank: RANK_DECLARATION,
      text: rewrite.text,
      removeTo: rewrite.removeTo,
    });
  }

  walkAst(program, (node) => {
    switch (node.type) {
      case "CallExpression": {
        const callee = asNode(node.callee);
        // `super()` is a SuperCall, not an ordinary expression: wrapping it in a
        // sequence expression is not portable, and a constructor call is not a
        // place a script can spin.
        if (callee && callee.type === "Super") return;
        add(node.start, node.end, RANK_EXPRESSION, "(__replStep(),");
        add(node.end, node.end, RANK_EXPRESSION, ")");
        return;
      }
      case "AwaitExpression":
        add(node.start, node.end, RANK_EXPRESSION, "(__replStep(),");
        add(node.end, node.end, RANK_EXPRESSION, ")");
        return;
      case "WhileStatement":
      case "DoWhileStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement": {
        const body = asNode(node.body);
        if (!body) return;
        if (body.type === "BlockStatement") {
          add(body.start + 1, body.end, RANK_LOOP_BODY, " __replStep();");
          return;
        }
        add(body.start, body.end, RANK_LOOP_BODY, "{ __replStep();");
        add(body.end, body.end, RANK_LOOP_BODY, "}");
        return;
      }
      default:
        return;
    }
  });

  if (lastExpression) {
    add(lastExpression.start, lastExpression.end, RANK_RETURN, "return (");
    add(lastExpression.end, lastExpression.end, RANK_RETURN, ")");
  }
  return insertions;
}

/**
 * Apply insertions from the end of the source backwards, so earlier offsets stay
 * valid. At one position, lower ranks are inserted first and therefore end up
 * innermost — `while (x) f()` becomes `while (x) { __replStep();(__replStep(),f()) }`
 * rather than an unbalanced nest.
 */
function instrument(code: string, analysis: ReplAnalysis): string {
  const insertions = insertionsFor(
    analysis.program,
    analysis.lastExpression,
    analysis.rewrites,
  );
  insertions.sort((a, b) => b.pos - a.pos || a.rank - b.rank || a.end - b.end);
  let out = code;
  for (const insertion of insertions) {
    out =
      out.slice(0, insertion.pos) +
      insertion.text +
      out.slice(insertion.removeTo);
  }
  return out;
}

/**
 * The runnable source: async IIFE (top-level `await` / `return`), the body on
 * line 1 so line numbers stay honest, and the declared names copied back onto
 * the realm's globals in a `finally` so an early `return` or a throw does not
 * lose them.
 */
function buildSource(code: string, analysis: ReplAnalysis): string {
  const body = instrument(code, analysis);
  const pairs = analysis.declarations
    .map((name) => `["${name}", () => ${name}]`)
    .join(", ");
  const sync =
    analysis.declarations.length > 0 ? ` __replSync([${pairs}]);` : "";
  // The body is the *function* body, not a block: a `try {}` of its own would
  // make `const` / `let` / `class` block-scoped, and the `finally` that copies
  // them onto the globals could not see them. Inside an async function the
  // declarations are function-scoped, so `finally` closes over them while
  // `return` and `throw` still both go through it.
  //
  // A synchronous throw (the sync wall clock, the step counter, anything the
  // script does before its first await) makes `runInContext` throw, so the run
  // promise is left behind with nobody holding it — and its rejection would be
  // reported as an unhandled rejection. One quiet handler inside the realm marks
  // it observed; the outcome the caller sees still comes from `pending`.
  return (
    "(() => { const p = (async function () {" +
    `try {${body}\n} finally {${sync}}})(); p.then(null, function () {}); return p })()`
  );
}

// ---------------------------------------------------------------------------
// Errors and value plumbing.
// ---------------------------------------------------------------------------

function formatError(error: unknown): string {
  if (error === null || typeof error !== "object") return String(error);
  const record = error as {
    name?: unknown;
    message?: unknown;
    stack?: unknown;
  };
  const name =
    typeof record.name === "string" && record.name.length > 0
      ? record.name
      : "Error";
  const message =
    typeof record.message === "string" ? record.message : String(error);
  const head = name === "Error" ? message : `${name}: ${message}`;
  const location = scriptLocation(record.stack);
  return location === null ? head : `${head} (${location})`;
}

/** First frame belonging to the script, so injected offsets never leak as line numbers. */
function scriptLocation(stack: unknown): string | null {
  if (typeof stack !== "string") return null;
  const match = new RegExp(`${SCRIPT_FILENAME}:(\\d+):(\\d+)`).exec(stack);
  if (!match) return null;
  return `${SCRIPT_FILENAME}:${match[1]}:${match[2]}`;
}

function wallClockMessage(timeoutMs: number): string {
  return (
    `REPL script stopped: wall clock ${timeoutMs} ms of synchronous execution. ` +
    "Calls that already completed still apply. The step budget counts loops and calls, " +
    "not the time spent inside a single built-in call (a slow regex can only be stopped by this wall clock)."
  );
}

function describeRunError(error: unknown, timeoutMs: number): string {
  const code = (error as { code?: unknown } | null)?.code;
  if (code === "ERR_SCRIPT_EXECUTION_TIMEOUT")
    return wallClockMessage(timeoutMs);
  return formatError(error);
}

function overwriteMessage(name: string): string {
  return (
    `\`${name}\` is already a global here (ReplGlobalOverwrite): it names a helper, a tool or a ` +
    "JavaScript built-in, and a top-level declaration would overwrite it for every later call. " +
    "Rename it, or declare it inside a function, where it stays local."
  );
}

function normalizeTimeout(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return REPL_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.floor(value), REPL_MAX_TIMEOUT_MS);
}

/** Decode the `{"v": ...}` envelope the boundary produces for outbound values. */
function decodeEnvelope(text: string): unknown {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object") return undefined;
  const record = parsed as { v?: unknown };
  return "v" in record ? record.v : undefined;
}

/** Turn the encoded return value into the text handed to the model. */
function outcomeValue(text: string): string | undefined {
  const parsed: unknown = JSON.parse(text);
  if (parsed === null || typeof parsed !== "object") return undefined;
  const record = parsed as { v?: unknown };
  if (!("v" in record)) return undefined;
  const value = record.v;
  if (value === undefined) return undefined;
  // A string is handed over as-is: quoting it would make `return "done"` read
  // like the JSON literal rather than the sentence the script produced.
  return typeof value === "string" ? value : JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// The sandbox.
// ---------------------------------------------------------------------------

interface ReplRunState {
  logs: string[];
  timers: Map<number, NodeJS.Timeout>;
}

type Settled =
  | { kind: "ok"; value?: string }
  | { kind: "failed"; error: string }
  | { kind: "aborted" };

class ReplSandboxImpl implements ReplSandbox {
  private host: ReplSandboxHost;
  private context: vm.Context | null = null;
  private boundary: ReplBoundary | null = null;
  private managedNames: string[] = [];
  private runs = new Set<ReplRunState>();
  private disposed = false;

  constructor(host: ReplSandboxHost) {
    this.host = host;
  }

  /** Rebind the host (a new call may carry fresh per-call callbacks). */
  setHost(host: ReplSandboxHost): void {
    this.host = host;
  }

  async run(code: string, options: ReplRunOptions): Promise<ReplRunOutcome> {
    const state: ReplRunState = { logs: [], timers: new Map() };
    if (this.disposed) {
      return {
        ok: false,
        error: "REPL sandbox was disposed; this call cannot run.",
        logs: [],
      };
    }
    if (options.abortSignal?.aborted) {
      return { ok: false, error: ABORTED_MESSAGE, logs: [] };
    }

    const analysis = analyzeCode(code);
    if (!analysis.ok) {
      const outcome: ReplRunOutcome = {
        ok: false,
        error: analysis.error,
        logs: [],
      };
      if (analysis.rejected) outcome.rejected = true;
      return outcome;
    }

    let boundary: ReplBoundary;
    try {
      boundary = this.ensureBoundary();
    } catch (error) {
      return { ok: false, error: formatError(error), logs: [] };
    }

    if (this.isPoisoned(boundary)) {
      return this.resetContext();
    }

    // Static refusal, before the script compiles: a top-level declaration of a
    // helper, a tool name or a built-in would write the global every later script
    // reads. A name an earlier script defined is not in this set on purpose —
    // redeclaring it simply overwrites it, which is what Claude Code does
    // (`za`'s `isGlobalName` filter in 2.1.326, before `compile()`).
    const toolNames = options.toolNames ?? [];
    const reservedNames = new Set<string>([
      ...MANAGED_GLOBAL_NAMES,
      ...toolNames,
    ]);
    for (const name of analysis.declarations) {
      if (!reservedNames.has(name) && !boundary.isBuiltinGlobal(name)) continue;
      return {
        ok: false,
        rejected: true,
        error: overwriteMessage(name),
        logs: [],
      };
    }

    const timeoutMs = normalizeTimeout(options.timeoutMs);
    let built: ReplBoundaryGlobals;
    try {
      const config: ReplGlobalsConfig = {
        toolNames,
        stepBudget: replStepBudget,
        timeoutMs,
        timers: this.createTimers(state),
      };
      built = boundary.createGlobals(this.createBridge(state), config);
    } catch (error) {
      return { ok: false, error: formatError(error), logs: [] };
    }

    try {
      this.installGlobals(boundary, built);
    } catch {
      // A managed global that refuses to be redefined is the poison case, even
      // if the pre-flight check missed it.
      return this.resetContext();
    }

    let script: vm.Script;
    try {
      script = new vm.Script(buildSource(code, analysis), {
        filename: SCRIPT_FILENAME,
      });
    } catch (error) {
      return { ok: false, error: formatError(error), logs: [] };
    }

    let pending: unknown;
    try {
      // `timeout` covers this synchronous run — including anything the script
      // does before its first await. Everything after an await is the step
      // counter's job, and only the step counter's.
      pending = script.runInContext(this.context as vm.Context, {
        timeout: timeoutMs,
      });
    } catch (error) {
      this.clearTimers(state);
      return {
        ok: false,
        error: describeRunError(error, timeoutMs),
        logs: state.logs,
      };
    }

    this.runs.add(state);
    const encoded = Promise.resolve(pending).then(
      (value) => {
        this.finishRun(state);
        return this.encodeOutcome(boundary, value);
      },
      (error) => {
        this.finishRun(state);
        return {
          kind: "failed",
          error: describeRunError(error, timeoutMs),
        } as Settled;
      },
    );

    const abortSignal = options.abortSignal;
    const settled: Settled = abortSignal
      ? await Promise.race([encoded, abortPromise(abortSignal)])
      : await encoded;

    if (settled.kind === "aborted") {
      return { ok: false, error: ABORTED_MESSAGE, logs: state.logs };
    }
    if (settled.kind === "failed") {
      return { ok: false, error: settled.error, logs: state.logs };
    }
    return { ok: true, value: settled.value, logs: state.logs };
  }

  dispose(): void {
    this.disposed = true;
    for (const state of this.runs) this.clearTimers(state);
    this.runs.clear();
    this.teardown();
  }

  // --- internals ----------------------------------------------------------

  private encodeOutcome(boundary: ReplBoundary, value: unknown): Settled {
    let text: string;
    try {
      text = boundary.encodeResult(value);
    } catch (error) {
      return { kind: "failed", error: formatError(error) };
    }
    try {
      return { kind: "ok", value: outcomeValue(text) };
    } catch (error) {
      return { kind: "failed", error: formatError(error) };
    }
  }

  private ensureBoundary(): ReplBoundary {
    if (this.boundary && this.context) return this.boundary;
    const context = vm.createContext(Object.create(null), {
      codeGeneration: { strings: false, wasm: false },
      // A script that slips past the static scan still cannot load a module, and
      // the message is ours rather than an engine-internal callback error.
      importModuleDynamically: () => {
        throw new Error(REPL_SEALED_MESSAGE);
      },
    });
    new vm.Script(HARDEN_SOURCE, { filename: "repl-harden.js" }).runInContext(
      context,
    );
    const boundary = new vm.Script(REPL_BOUNDARY_SOURCE, {
      filename: "repl-boundary.js",
    }).runInContext(context) as unknown as ReplBoundary;
    this.context = context;
    this.boundary = boundary;
    return boundary;
  }

  /**
   * The only two ways a context is declared unusable: a managed global was made
   * non-configurable (so it can no longer be restored for the next call), or
   * `globalThis` itself no longer resolves to the realm's global object.
   */
  private isPoisoned(boundary: ReplBoundary): boolean {
    const context = this.context;
    if (!context) return true;
    try {
      const current = vm.runInContext("globalThis", context) as unknown;
      if (current === null || typeof current !== "object") return true;
      if (current !== boundary.globalObject) return true;
      for (const name of this.managedNames) {
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (descriptor && descriptor.configurable === false) return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  private resetContext(): ReplRunOutcome {
    this.teardown();
    try {
      this.ensureBoundary();
    } catch {
      // The next call will try again; the message is the same either way.
    }
    return { ok: false, error: CONTEXT_RESET_MESSAGE, logs: [] };
  }

  private teardown(): void {
    for (const state of this.runs) this.clearTimers(state);
    this.runs.clear();
    this.context = null;
    this.boundary = null;
    this.managedNames = [];
  }

  private installGlobals(
    boundary: ReplBoundary,
    built: ReplBoundaryGlobals,
  ): void {
    const target = boundary.globalObject;
    const next = new Set(built.names);
    for (const name of this.managedNames) {
      if (next.has(name)) continue;
      Reflect.deleteProperty(target, name);
    }
    for (const name of built.names) {
      Object.defineProperty(target, name, {
        value: built.globals[name],
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    this.managedNames = built.names.slice();
  }

  private createBridge(state: ReplRunState): ReplBoundaryBridge {
    return {
      callTool: (name, argsText) =>
        this.host.callTool(name, decodeEnvelope(argsText)),
      searchTools: (queryText, maxText) =>
        this.host.searchTools(
          decodeEnvelope(queryText),
          decodeEnvelope(maxText),
        ),
      describeTool: (nameText) =>
        this.host.describeTool(decodeEnvelope(nameText)),
      listToolNames: () => this.host.listToolNames(),
      runShell: (command, options) => this.host.runShell(command, options),
      selfLog: (values) => {
        state.logs.push(values.join(" "));
        try {
          this.host.selfLog(values);
        } catch {
          // A logging hook that throws must not fail the script that logged.
        }
      },
      consoleWrite: (level, values) => this.host.consoleWrite(level, values),
      consoleTail: (n) => this.host.consoleTail(n),
      consoleBuffer: () => this.host.consoleBuffer(),
      consoleDropped: () => this.host.consoleDropped(),
      running: () => this.host.running(),
      stepError: () => this.host.stepError(),
    };
  }

  /**
   * Timers belong to the run that created them: the spec's "the timer is cleared
   * when that script ends" is why the registry lives in the run state rather
   * than on the sandbox. Handles are numbers inside the sandbox, so no host
   * object ever crosses back.
   */
  private createTimers(state: ReplRunState): ReplBoundaryTimers {
    let next = 1;
    const schedule = (
      callback: () => void,
      ms: number,
      repeat: boolean,
    ): number => {
      const safe = (): void => {
        try {
          callback();
        } catch {
          // A script's timer callback throwing must not take the host down; the
          // script already lost the only place that error could be reported.
        }
      };
      const delay = Number.isFinite(ms) && ms >= 0 ? ms : 0;
      const handle = repeat
        ? setInterval(safe, delay)
        : setTimeout(safe, delay);
      const id = next++;
      state.timers.set(id, handle);
      return id;
    };
    const cancel = (id: number): void => {
      const handle = state.timers.get(id);
      if (!handle) return;
      clearTimeout(handle);
      state.timers.delete(id);
    };
    return {
      setTimeout: (callback, ms) => schedule(callback, ms, false),
      clearTimeout: cancel,
      setInterval: (callback, ms) => schedule(callback, ms, true),
      clearInterval: cancel,
    };
  }

  private clearTimers(state: ReplRunState): void {
    for (const handle of state.timers.values()) clearTimeout(handle);
    state.timers.clear();
  }

  private finishRun(state: ReplRunState): void {
    this.clearTimers(state);
    this.runs.delete(state);
  }
}

/** Resolves (never rejects) once the signal aborts; the run is abandoned, not disposed. */
function abortPromise(abortSignal: AbortSignal): Promise<Settled> {
  return new Promise((resolve) => {
    const finish = (): void => resolve({ kind: "aborted" });
    if (abortSignal.aborted) {
      finish();
      return;
    }
    abortSignal.addEventListener("abort", finish, { once: true });
  });
}

// ---------------------------------------------------------------------------
// Registry. One context per (session, agent); the three release points are
// /clear, switching sessions and a subagent ending.
// ---------------------------------------------------------------------------

const sandboxes = new Map<string, ReplSandboxImpl>();

/** 按 (会话, agent) 取长驻沙箱；不存在则创建。 */
export function acquireReplSandbox(
  key: string,
  host: ReplSandboxHost,
): ReplSandbox {
  const existing = sandboxes.get(key);
  if (existing) {
    existing.setHost(host);
    return existing;
  }
  const created = new ReplSandboxImpl(host);
  sandboxes.set(key, created);
  return created;
}

/** 释放（/clear、切换会话、子代理结束、上下文中毒）。 */
export function releaseReplSandbox(key: string): void {
  const existing = sandboxes.get(key);
  if (!existing) return;
  existing.dispose();
  sandboxes.delete(key);
}

/** Test/diagnostic helper: how many long-resident sandboxes exist right now. */
export function replSandboxCount(): number {
  return sandboxes.size;
}
