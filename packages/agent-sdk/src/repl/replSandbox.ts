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
 *    that timeout no longer applies. So `__replStep()` is injected at the top of
 *    every loop body and every function body, and the counter checks both the
 *    step budget (300,000,000 default) and a sync wall clock that is refreshed
 *    each time the host hands control back. No insertion adds a line, so the
 *    line numbers in a stack trace are the ones the model wrote.
 * 3. **Persistence through the script's own top level.** The body runs inside an
 *    async IIFE (that is what makes top-level `await` and `return` legal, and
 *    what lets the last expression become the value), where a declaration would
 *    be function-scoped and vanish with the run. So the script gets a
 *    `var a, b;` prelude at its own top level — a top-level `var` in a
 *    `vm.Script` lands on the realm's global object — and every declaration
 *    statement is rewritten in place into an assignment. Names therefore appear
 *    as the run reaches them, and nothing copies them out afterwards, so a
 *    `let x;` or a declaration after a throw cannot overwrite a previous run's
 *    value with `undefined`. Timers stay per-run: they are cleared when the run
 *    that created them ends.
 */

import vm from "node:vm";
import { parse } from "acorn";
import {
  describeSyntaxError,
  runtimeErrorHint,
} from "../utils/scriptErrorText.js";
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
  /** Same-line rewrites that turn a top-level declaration into an assignment. */
  rewrites: Rewrite[];
  /** Explicit `let x;` names, which the prelude's `var x;` does not reset. */
  resets: string[];
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
      return { ok: false, error: describeSyntaxError(scriptError, code) };
    }
  }
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
  resets: string[];
}

/** Preserve first-seen order; `var a, a;` must not produce `var a, a;`. */
function uniqueNames(values: string[]): string[] {
  const out: string[] = [];
  for (const value of values) {
    if (!out.includes(value)) out.push(value);
  }
  return out;
}

/**
 * Collect the names a top-level declaration puts in the context, plus the
 * same-line rewrites that turn each declaration statement into an assignment to
 * the `var` the prelude declared.
 *
 * Nothing is scoped by the wrapper: the prelude's `var` is the only declaration,
 * and it sits at the script's own top level, so a name exists the moment the run
 * assigns it — and only then. That is what makes a `let x;`, a declaration
 * after a throw or one inside a branch leave the context's previous value alone
 * instead of replacing it with `undefined`. `var` also keeps redeclaration
 * legal: reusing a name an earlier script defined overwrites it, as in Claude
 * Code.
 *
 * Rewrites stay inside the statement they came from, which is what keeps the
 * script's line numbers honest.
 */
function scanDeclarations(program: AstNode): DeclarationScan {
  const names: string[] = [];
  const rewrites: Rewrite[] = [];
  const resets: string[] = [];
  for (const statement of statementsOf(program)) {
    if (statement.type === "VariableDeclaration") {
      const kind = typeof statement.kind === "string" ? statement.kind : "";
      let destructuring = false;
      let lastEnd = statement.start;
      for (const declarator of statement.declarations ?? []) {
        const id = asNode(declarator.id);
        bindingNames(id, names);
        if (!id || id.type !== "Identifier") destructuring = true;
        // `var x;` does not reset an existing global; `let x;` promises this name
        // is undefined again, so that one gets its own statement (see `insertionsFor`).
        if (kind === "let" && !asNode(declarator.init))
          bindingNames(id, resets);
        lastEnd = declarator.end;
      }
      if (destructuring) {
        // `({ a } = o)`: a leading `{` in statement position would be a block.
        rewrites.push({
          start: statement.start,
          removeTo: statement.start + kind.length,
          text: "(",
        });
        // The declaration's own end includes a trailing `;`, so the closing paren
        // goes after the last declarator to stay inside the expression.
        rewrites.push({ start: lastEnd, removeTo: lastEnd, text: ")" });
      } else {
        rewrites.push({
          start: statement.start,
          removeTo: statement.start + kind.length,
          text: "",
        });
      }
      continue;
    }
    if (statement.type === "FunctionDeclaration") {
      const id = asNode(statement.id);
      if (!id || typeof id.name !== "string") continue;
      names.push(id.name);
      // A named function expression, so the body can still call itself. The
      // trailing `;` is load-bearing: a declaration needs no semicolon, but this
      // is now an expression statement, and `function f() {} return f()` on one
      // line is otherwise a syntax error.
      rewrites.push({
        start: statement.start,
        removeTo: statement.start,
        text: `${id.name} = `,
      });
      rewrites.push({
        start: statement.end,
        removeTo: statement.end,
        text: ";",
      });
      continue;
    }
    if (statement.type === "ClassDeclaration") {
      const id = asNode(statement.id);
      if (!id || typeof id.name !== "string") continue;
      names.push(id.name);
      rewrites.push({
        start: statement.start,
        removeTo: statement.start,
        text: `${id.name} = `,
      });
      rewrites.push({
        start: statement.end,
        removeTo: statement.end,
        text: ";",
      });
    }
  }
  return { names: uniqueNames(names), rewrites, resets: uniqueNames(resets) };
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
    resets: declarations.resets,
    lastExpression: lastExpressionOf(parsed.program),
  };
}

// ---------------------------------------------------------------------------
// Step injection.
//
// Every insertion edits the interior of a single line, so the script's own line
// numbers survive verbatim. The shapes are Claude Code 2.1.331's:
//
// - a loop body or a function body gets `__replStep();` as its first statement
//   (a tight `while (true) {}` contains no call expression at all);
// - if that body starts with a directive prologue, the check goes after the last
//   directive and carries a leading `;`, so it cannot fuse with a directive
//   line that has no semicolon of its own;
// - a loop body that is not a block is wrapped as `{__replStep(); … }`;
// - an arrow's shorthand body becomes `(__replStep(), expr)`.
//
// Nothing is inserted in front of a call or an `await`: that put a `(` at the
// start of a statement, and a previous line without a semicolon then made the
// parser read both lines as one call — the variable stayed `undefined` and the
// next line failed with "(intermediate value) is not a function".
//
// A trailing expression statement is turned into `return (expr)` so the run's
// value is the last expression, as the tool description promises.
// ---------------------------------------------------------------------------

const RANK_EXPRESSION = 0;
const RANK_LOOP_BODY = 1;
const RANK_RETURN = 2;
const RANK_DECLARATION = 3;
/** Applied last, so a reset stays outside a rewritten declaration at offset 0. */
const RANK_RESET = 4;

interface Insertion {
  pos: number;
  end: number;
  rank: number;
  text: string;
  /** Exclusive end of the text replaced; equal to `pos` for a pure insert. */
  removeTo: number;
}

/** End offset of a statement list's last directive prologue statement, or -1. */
function directiveEndOf(statements: AstNode[]): number {
  for (let i = statements.length - 1; i >= 0; i -= 1) {
    const directive = statements[i].directive;
    if (typeof directive === "string" && directive.length > 0) {
      return statements[i].end;
    }
  }
  return -1;
}

function insertionsFor(
  program: AstNode,
  lastExpression: AstNode | null,
  rewrites: Rewrite[],
  resets: string[],
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

  if (resets.length > 0) {
    // The prelude's `var x;` cannot unset a global an earlier run assigned, so an
    // explicit `let x;` gets its own `void(x = void 0);`. It has to be the body's
    // first statement, which means after the directive prologue when there is
    // one: a `"use strict"` that stops being first stops being a directive.
    const text = resets.map((name) => `void(${name} = void 0);`).join("");
    const afterDirectives = directiveEndOf(statementsOf(program));
    if (afterDirectives < 0) add(0, 0, RANK_RESET, text);
    else add(afterDirectives, afterDirectives, RANK_RESET, `;${text}`);
  }

  // A loop or function body is entered once per iteration or call, which is the
  // one place a step check belongs.
  const stepIntoBlock = (block: AstNode): void => {
    const stop = directiveEndOf(statementsOf(block));
    if (stop < 0) {
      add(block.start + 1, block.start + 1, RANK_LOOP_BODY, "__replStep();");
      return;
    }
    add(stop, stop, RANK_LOOP_BODY, ";__replStep();");
  };

  walkAst(program, (node) => {
    switch (node.type) {
      case "WhileStatement":
      case "DoWhileStatement":
      case "ForStatement":
      case "ForInStatement":
      case "ForOfStatement":
      case "FunctionDeclaration":
      case "FunctionExpression":
      case "ArrowFunctionExpression": {
        const body = asNode(node.body);
        if (!body) return;
        if (body.type === "BlockStatement") {
          stepIntoBlock(body);
          return;
        }
        // Only a loop body (a statement, so it needs braces) or an arrow's
        // shorthand (an expression, so it needs a sequence) can land here.
        if (node.type === "ArrowFunctionExpression") {
          add(body.start, body.end, RANK_EXPRESSION, "(__replStep(),");
          add(body.end, body.end, RANK_EXPRESSION, ")");
          return;
        }
        add(body.start, body.end, RANK_LOOP_BODY, "{__replStep();");
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
 * innermost — `while (x) f()` becomes `while (x) {__replStep();f()}` rather than
 * an unbalanced nest.
 */
function instrument(code: string, analysis: ReplAnalysis): string {
  const insertions = insertionsFor(
    analysis.program,
    analysis.lastExpression,
    analysis.rewrites,
    analysis.resets,
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
 * The runnable source: a `var` prelude and the async IIFE, both on line 1 so
 * line numbers stay honest.
 *
 * The prelude is what makes this run's top-level names outlive it. The body is
 * an async function (top-level `await` / `return`, and the last expression as
 * the value), so a declaration inside it would be function-scoped; a `var` at
 * the script's own top level lands on the realm's global object, and
 * `scanDeclarations` has already turned every declaration statement into an
 * assignment to it. Nothing is copied out afterwards, so a name this run never
 * reached keeps whatever an earlier run left there.
 *
 * A synchronous throw (the sync wall clock, the step counter, anything the
 * script does before its first await) makes `runInContext` throw, so the run
 * promise is left behind with nobody holding it — and its rejection would be
 * reported as an unhandled rejection. One quiet handler inside the realm marks
 * it observed; the outcome the caller sees still comes from `pending`.
 */
function buildSource(code: string, analysis: ReplAnalysis): string {
  const body = instrument(code, analysis);
  const prelude =
    analysis.declarations.length > 0
      ? `var ${analysis.declarations.join(", ")};`
      : "";
  return `${prelude}(() => { const p = (async function () {${body}\n})(); p.then(null, function () {}); return p })()`;
}

// ---------------------------------------------------------------------------
// Errors and value plumbing.
// ---------------------------------------------------------------------------

function formatError(error: unknown): string {
  if (error === null || typeof error !== "object") return String(error);
  const record = error as { name?: unknown; message?: unknown };
  const name =
    typeof record.name === "string" && record.name.length > 0
      ? record.name
      : "Error";
  const message =
    typeof record.message === "string" ? record.message : String(error);
  return name === "Error" ? message : `${name}: ${message}`;
}

const MAX_QUOTED_FRAMES = 4;
const MAX_QUOTED_LINE_CHARS = 200;
/** One V8 frame, `at (async )?(fn )?(file:line:column)`; the column is matched only to be dropped. */
const STACK_FRAME =
  /^\s*at (?:async )?(?:(\S[^()]*?) \()?([^\s():]+):(\d+):\d+\)?$/;

/**
 * The script's own frames, each quoting the line the model wrote. No column:
 * `__replStep()` is spliced onto the same line as the code it counts, so line
 * numbers come through instrumentation verbatim and columns do not. Frames past
 * the script's last line belong to the wrapper (`finally`, the IIFEs) and are
 * left out. Same shape as Claude Code's `xYr`.
 */
function scriptWhere(stack: unknown, script: string): string {
  if (typeof stack !== "string") return "";
  const lines = script.split("\n");
  const frames: string[] = [];
  for (const line of stack.split("\n")) {
    if (frames.length >= MAX_QUOTED_FRAMES) break;
    const match = STACK_FRAME.exec(line);
    if (!match || match[2] !== SCRIPT_FILENAME) continue;
    const index = Number(match[3]) - 1;
    if (!(index >= 0 && index < lines.length)) continue;
    const text = lines[index].trim().slice(0, MAX_QUOTED_LINE_CHARS);
    if (text === "") continue;
    const fn = (match[1] ?? "<anonymous>").slice(0, 80);
    const frame = `  in ${fn} (line ${index + 1}): ${text}`;
    if (frame !== frames[frames.length - 1]) frames.push(frame);
  }
  if (frames.length === 0) return "";
  return ["Thrown at (statements quoted from the script):", ...frames].join(
    "\n",
  );
}

function wallClockMessage(timeoutMs: number): string {
  return (
    `REPL script stopped: wall clock ${timeoutMs} ms of synchronous execution. ` +
    "Calls that already completed still apply. The step budget counts loops and calls, " +
    "not the time spent inside a single built-in call (a slow regex can only be stopped by this wall clock)."
  );
}

function describeRunError(
  error: unknown,
  timeoutMs: number,
  script: string,
): string {
  const errno = (error as { code?: unknown } | null)?.code;
  if (errno === "ERR_SCRIPT_EXECUTION_TIMEOUT")
    return wallClockMessage(timeoutMs);
  const head = formatError(error);
  const where = scriptWhere(
    (error as { stack?: unknown } | null)?.stack,
    script,
  );
  return (
    head + (where === "" ? "" : `\n${where}`) + runtimeErrorHint(head, script)
  );
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
        error: describeRunError(error, timeoutMs, code),
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
          error: describeRunError(error, timeoutMs, code),
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
