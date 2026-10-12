import vm from "node:vm";
import { parse } from "acorn";
import type {
  AnyNode,
  ExportNamedDeclaration,
  Identifier,
  Program,
} from "acorn";
import { ancestor } from "acorn-walk";
import type { BudgetInfo, WorkflowMeta, WorkflowMetaPhase } from "./types.js";
import type { WorkflowApiStats } from "./workflowApis.js";
import { describeFailure, evaluateMetaLiteral } from "./metaLiteral.js";
import { logger } from "../utils/globalLogger.js";

/**
 * Workflow script runtime: validation, meta extraction and sandboxed execution.
 *
 * Validation runs on an acorn AST, so only real code participates in the
 * decision — `fs.readFileSync` appearing inside a prompt string handed to
 * `agent()`, or inside a comment, is never mistaken for an escape attempt.
 */

/** Host globals that workflow scripts must never reach. */
const BANNED_GLOBALS = new Set([
  "process",
  "globalThis",
  "global",
  "require",
  "module",
  "__dirname",
  "__filename",
  "Bun",
  "Deno",
  "child_process",
  "fetch",
  "XMLHttpRequest",
  "WebSocket",
  "Worker",
  "window",
  "self",
  "document",
  "navigator",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "crypto",
  "Buffer",
  "performance",
  "WebAssembly",
  "importScripts",
  "eval",
  "Function",
  "setInterval",
  "setImmediate",
  "queueMicrotask",
]);

/** Determinism rejections are raised at runtime, by shims installed in the sandbox. */
const DETERMINISM_ERRORS = {
  dateNow: "Date.now() would break resume determinism",
  newDate: "new Date() would break resume determinism",
  mathRandom: "Math.random() would break resume determinism",
};

const META_REQUIRED_MESSAGE =
  "Script must start with 'export const meta = {...}'";
const META_SNIPPET = "export const meta = { name, description, phases }";

/** Name of the script inside stack traces. */
const SCRIPT_FILENAME = "workflow-script.js";

/**
 * Sandbox bootstrap: replaces the non-deterministic intrinsics with throwing
 * stand-ins. It runs inside the VM realm (host-compiled `vm.Script`), so the
 * replacements are realm-local and inherit everything else from the real
 * `Date`/`Math`.
 */
const DETERMINISM_SHIM_SOURCE = `(() => {
  const RealDate = Date;
  class WorkflowDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        throw new Error(${JSON.stringify(DETERMINISM_ERRORS.newDate)});
      }
      super(...args);
    }
    static now() {
      throw new Error(${JSON.stringify(DETERMINISM_ERRORS.dateNow)});
    }
  }
  Date = WorkflowDate;
  Math.random = () => {
    throw new Error(${JSON.stringify(DETERMINISM_ERRORS.mathRandom)});
  };
})()`;

/**
 * VM-realm boundary helpers — the analogue of Claude Code's `vmBoundary`.
 *
 * They are compiled and evaluated *inside* the sandbox realm, so everything the
 * script can reach is realm-local: the API functions, the console, the budget
 * view, every value returned by a host call, and `args`.
 *
 * Why it is needed: `codeGeneration: {strings: false}` only restricts the
 * sandbox's own `Function`/`eval`. A function or object created in the host realm
 * carries the host realm's `Function` as its `.constructor`, and a borrowed
 * constructor compiles in the realm that owns it — so with raw host closures
 * injected, `agent.constructor("return process")()` handed the script the real
 * process object. Wrapping each callable in a realm-local arrow and copying each
 * incoming value into the realm closes that path, and `Object.freeze` keeps the
 * helpers themselves out of the script's way. Intrinsics are captured up front so
 * a later script cannot widen the boundary by reassigning `JSON` or `Object`.
 */
const VM_BOUNDARY_SOURCE = `(() => {
  const jsonParse = JSON.parse;
  const jsonStringify = JSON.stringify;
  const objectCreate = Object.create;
  const objectFreeze = Object.freeze;
  const ErrorCtor = Error;

  // Deep-copy a host value into this realm. Functions, symbols and BigInts have
  // no realm-local representation here, so they are dropped rather than leaked.
  const clone = (value) => {
    const type = typeof value;
    if (
      value === null ||
      type === "undefined" ||
      type === "string" ||
      type === "number" ||
      type === "boolean"
    ) {
      return value;
    }
    try {
      const json = jsonStringify(value);
      return json === undefined ? undefined : jsonParse(json);
    } catch {
      return undefined;
    }
  };

  // Host errors are re-created here for the same reason: a caught host Error
  // would hand the script the host realm through its own prototype chain.
  const toRealmError = (error) => {
    const name = error && typeof error.name === "string" ? error.name : "Error";
    const message =
      error && typeof error.message === "string" ? error.message : String(error);
    const stack =
      error && typeof error.stack === "string" ? error.stack : undefined;
    const out = new ErrorCtor(message);
    out.name = name;
    if (stack !== undefined) out.stack = stack;
    return out;
  };

  return objectFreeze({
    clone,
    call: (fn) => (...args) => {
      try {
        return clone(fn(...args));
      } catch (error) {
        throw toRealmError(error);
      }
    },
    callAsync: (fn) => async (...args) => {
      try {
        return clone(await fn(...args));
      } catch (error) {
        throw toRealmError(error);
      }
    },
    record: (entries) => {
      const target = objectCreate(null);
      for (const [key, value] of entries) target[key] = value;
      return objectFreeze(target);
    },
  });
})()`;

/** The boundary factory, as seen from the host. */
interface VmBoundary {
  clone: (value: unknown) => unknown;
  call: <A extends unknown[], R>(
    fn: (...args: A) => R,
  ) => (...args: A) => unknown;
  callAsync: <A extends unknown[], R>(
    fn: (...args: A) => R,
  ) => (...args: A) => Promise<unknown>;
  record: (entries: Array<[string, unknown]>) => Record<string, unknown>;
}

export interface ParsedScript {
  meta: WorkflowMeta;
  body: string;
}

export interface ScriptValidationResult {
  valid: boolean;
  errors: string[];
}

export interface WorkflowScriptApis {
  agent: (prompt: string, opts?: Record<string, unknown>) => Promise<unknown>;
  parallel: (thunks: Array<() => Promise<unknown>>) => Promise<unknown[]>;
  pipeline: (
    items: unknown[],
    ...stages: Array<
      (prev: unknown, item: unknown, index: number) => Promise<unknown>
    >
  ) => Promise<unknown[]>;
  phase: (title: string) => void;
  log: (message: string) => void;
  args: unknown;
  budget: BudgetInfo;
  getFailures: () => string[];
  recordFailure: (message: string) => void;
  /**
   * agent() calls started so far (entries replayed from a resumed journal
   * included) and the per-outcome tallies. Same counters the completion
   * notification's `<usage>` block reports, exposed so a script can ration its
   * own fan-out — or state how much it dropped — without guessing
   * (spec「预算与规模硬上限」场景 6).
   */
  getAgentCount: () => number;
  getStats: () => WorkflowApiStats;
}

/**
 * Validate a workflow script: syntax, the `meta` declaration, the literal
 * whitelist for `meta`, and the set of constructs the sandbox refuses to run.
 */
export function validateScript(script: string): ScriptValidationResult {
  const errors: string[] = [];

  const outcome = parseProgram(script);
  if ("syntaxError" in outcome) {
    return { valid: false, errors: [outcome.syntaxError] };
  }
  const program = outcome.program;
  const metaDeclaration = findMetaDeclaration(program);

  if (!metaDeclaration) {
    errors.push(META_REQUIRED_MESSAGE);
  } else {
    if (program.body[0] !== metaDeclaration.node) {
      errors.push(
        `\`${META_SNIPPET}\` must be the first statement ${at(metaDeclaration.node)}`,
      );
    }
    const evaluated = evaluateMetaLiteral(metaDeclaration.metaObject);
    if (!evaluated.ok) {
      errors.push(
        `meta must be a plain literal: ${describeFailure(evaluated)}`,
      );
    } else {
      errors.push(...readMeta(evaluated.value).errors);
    }
  }

  collectBannedConstructs(program, metaDeclaration?.node ?? null, errors);

  return { valid: errors.length === 0, errors };
}

/**
 * Parse a workflow script into meta and body.
 * Extracts the `export const meta = {...}` declaration and the rest of the script.
 */
export function parseScript(script: string): ParsedScript {
  const analyzed = analyzeScript(script);
  const body = (
    script.slice(0, analyzed.metaStart) + script.slice(analyzed.metaEnd)
  ).replace(/^\s*;?\s*/, "");
  return { meta: analyzed.meta, body };
}

/**
 * Execute a workflow script with the given API closures.
 *
 * The script body runs in a `node:vm` context whose globals are a whitelist
 * (orchestration APIs, a console bridged to the workflow log, timers and the
 * determinism shims) with `codeGeneration` disabled, so `eval`/`Function`
 * cannot escape it. Every word is installed as a realm-local wrapper and every
 * value crossing the boundary is copied into the realm — see
 * `VM_BOUNDARY_SOURCE` for why the raw host closures are not enough.
 */
export async function executeScript(
  script: string,
  apis: WorkflowScriptApis,
  abortSignal?: AbortSignal,
): Promise<{ meta: WorkflowMeta; result: unknown }> {
  // Validate first
  const validation = validateScript(script);
  if (!validation.valid) {
    throw new Error(
      `Script validation failed:\n${validation.errors.join("\n")}`,
    );
  }

  // Parse script
  const analyzed = analyzeScript(script);
  const { meta } = analyzed;

  logger.info(
    `[Workflow] Executing script "${meta.name}": ${meta.description}`,
  );

  const context = createSandboxContext(apis);
  const compiled = new vm.Script(wrapBody(script, analyzed), {
    filename: SCRIPT_FILENAME,
  });

  try {
    const scriptPromise: Promise<unknown> = compiled.runInContext(context);
    const settled = abortSignal
      ? await Promise.race([scriptPromise, abortSignalPromise(abortSignal)])
      : await scriptPromise;
    return { meta, result: sanitizeResult(settled) };
  } catch (error) {
    throw toHostError(error);
  }
}

interface AnalyzedScript {
  meta: WorkflowMeta;
  /** Character offset where the `export const meta = ...` declaration starts. */
  metaStart: number;
  /** Character offset just past the declaration (including its semicolon). */
  metaEnd: number;
  /** 1-based line of `metaEnd`, used to keep wrapped line numbers aligned. */
  metaEndLine: number;
}

interface MetaDeclaration {
  node: ExportNamedDeclaration;
  /** The `meta` initializer expression. */
  metaObject: AnyNode;
}

type ParseOutcome = { program: Program } | { syntaxError: string };

function parseProgram(script: string): ParseOutcome {
  try {
    return {
      program: parse(script, {
        ecmaVersion: "latest",
        sourceType: "module",
        locations: true,
        // The body is wrapped in an async IIFE before it runs, so a top-level
        // `return` is legal for scripts even though they parse as modules.
        allowReturnOutsideFunction: true,
      }),
    };
  } catch (error) {
    return { syntaxError: formatSyntaxError(error) };
  }
}

function formatSyntaxError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const loc = (error as { loc?: { line: number; column: number } | null }).loc;
  const cleaned = message.replace(/\s*\(\d+:\d+\)$/, "");
  if (!loc) {
    return `Script syntax error: ${cleaned}`;
  }
  return `Script syntax error: ${cleaned} at line ${loc.line}, column ${loc.column + 1}`;
}

function findMetaDeclaration(program: Program): MetaDeclaration | null {
  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration") continue;
    const declaration = statement.declaration;
    if (!declaration || declaration.type !== "VariableDeclaration") continue;
    for (const declarator of declaration.declarations) {
      if (
        declarator.id.type !== "Identifier" ||
        declarator.id.name !== "meta" ||
        !declarator.init
      )
        continue;
      return { node: statement, metaObject: declarator.init };
    }
  }
  return null;
}

/** Throwing variant of the analysis shared by `parseScript` and `executeScript`. */
function analyzeScript(script: string): AnalyzedScript {
  const outcome = parseProgram(script);
  if ("syntaxError" in outcome) {
    throw new Error(outcome.syntaxError);
  }

  const metaDeclaration = findMetaDeclaration(outcome.program);
  if (!metaDeclaration) {
    throw new Error("Script must contain 'export const meta = {...}'");
  }

  const evaluated = evaluateMetaLiteral(metaDeclaration.metaObject);
  if (!evaluated.ok) {
    throw new Error(`Invalid meta: ${describeFailure(evaluated)}`);
  }

  const { meta, errors } = readMeta(evaluated.value);
  if (!meta) {
    throw new Error(errors.join("\n"));
  }

  return {
    meta,
    metaStart: metaDeclaration.node.start,
    metaEnd: metaDeclaration.node.end,
    metaEndLine: metaDeclaration.node.loc?.end.line ?? 1,
  };
}

function readMeta(value: unknown): {
  meta: WorkflowMeta | null;
  errors: string[];
} {
  const errors: string[] = [];
  const source = asRecord(value) ?? {};
  const name = requireNonEmptyString(
    source.name,
    "meta.name is required and must be a string",
    errors,
  );
  const description = requireNonEmptyString(
    source.description,
    "meta.description is required and must be a string",
    errors,
  );
  if (name === null || description === null) {
    return { meta: null, errors };
  }

  const meta: WorkflowMeta = { name, description };
  if (typeof source.whenToUse === "string") {
    meta.whenToUse = source.whenToUse;
  }
  const phases = normalizePhases(source.phases);
  if (phases) {
    meta.phases = phases;
  }
  return { meta, errors };
}

function requireNonEmptyString(
  value: unknown,
  message: string,
  errors: string[],
): string | null {
  if (typeof value === "string" && value.length > 0) return value;
  errors.push(message);
  return null;
}

/**
 * Keep only phases shaped like `{title, detail?, model?}`. Invalid entries are
 * dropped; when nothing survives, `phases` is treated as absent (not empty).
 */
function normalizePhases(value: unknown): WorkflowMetaPhase[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const phases: WorkflowMetaPhase[] = [];
  for (const element of value) {
    const source = asRecord(element);
    if (!source || typeof source.title !== "string") continue;
    const phase: WorkflowMetaPhase = { title: source.title };
    if (typeof source.detail === "string") {
      phase.detail = source.detail;
    }
    if (typeof source.model === "string") {
      phase.model = source.model;
    }
    phases.push(phase);
  }
  return phases.length > 0 ? phases : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return null;
  return value as Record<string, unknown>;
}

interface BannedScanState {
  errors: string[];
  metaDeclaration: ExportNamedDeclaration | null;
}

function collectBannedConstructs(
  program: Program,
  metaDeclaration: ExportNamedDeclaration | null,
  errors: string[],
): void {
  try {
    ancestor<BannedScanState>(
      program,
      {
        Identifier(node, scan, ancestors) {
          if (!BANNED_GLOBALS.has(node.name)) return;
          const parent =
            ancestors.length > 1 ? ancestors[ancestors.length - 2] : null;
          if (!isValueReference(node, parent)) return;
          scan.errors.push(`"${node.name}" is not available ${at(node)}`);
        },
        ImportDeclaration(node, scan) {
          scan.errors.push(`import statements are not available ${at(node)}`);
        },
        ImportExpression(node, scan) {
          scan.errors.push(`dynamic import() is not available ${at(node)}`);
        },
        ExportAllDeclaration(node, scan) {
          scan.errors.push(`export * is not available ${at(node)}`);
        },
        ExportDefaultDeclaration(node, scan) {
          scan.errors.push(`export default is not available ${at(node)}`);
        },
        ExportNamedDeclaration(node, scan) {
          if (node === scan.metaDeclaration) return;
          if (node.source) {
            scan.errors.push(`re-exports are not available ${at(node)}`);
            return;
          }
          scan.errors.push(
            `only \`export const meta\` may be exported ${at(node)}`,
          );
        },
        MetaProperty(node, scan) {
          scan.errors.push(`import.meta is not available ${at(node)}`);
        },
      },
      undefined,
      { errors, metaDeclaration },
    );
  } catch (error) {
    // Fail closed: a script the analyzer cannot walk is not allowed to run.
    errors.push(
      `Script could not be analyzed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Whether an identifier is a value reference (rather than a binding, an object
 * key or a property name), which decides if a banned global is really used.
 */
function isValueReference(node: Identifier, parent: AnyNode | null): boolean {
  if (!parent) return true;
  switch (parent.type) {
    case "MemberExpression":
      return parent.computed || parent.property !== node;
    case "Property":
      // `{process}` reads the global; `{process: 1}` merely names a key.
      return parent.value === node;
    case "MethodDefinition":
    case "PropertyDefinition":
      return parent.computed || parent.key !== node;
    case "VariableDeclarator":
      return parent.id !== node;
    case "AssignmentPattern":
      return parent.left !== node;
    case "RestElement":
      return parent.argument !== node;
    case "ArrayPattern":
    case "ObjectPattern":
    case "CatchClause":
    case "ImportSpecifier":
    case "ImportDefaultSpecifier":
    case "ImportNamespaceSpecifier":
    case "ExportSpecifier":
      return false;
    case "FunctionDeclaration":
    case "FunctionExpression":
    case "ArrowFunctionExpression":
      return parent.id !== node && !parent.params.includes(node);
    case "ClassDeclaration":
    case "ClassExpression":
      return parent.id !== node;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      return parent.label !== node;
    default:
      return true;
  }
}

function at(node: AnyNode): string {
  const start = node.loc?.start;
  return start ? `at line ${start.line}, column ${start.column + 1}` : "";
}

/** Wrap the body in an async IIFE, keeping the script's own line numbers. */
function wrapBody(script: string, analyzed: AnalyzedScript): string {
  const prefix = `(async () => {"use strict";`;
  const rawBody =
    script.slice(0, analyzed.metaStart) + script.slice(analyzed.metaEnd);
  // The declaration starts on line 1 (`validateScript` requires it), so the
  // body already carries the right offsets: the directive shares the first
  // line and the body follows verbatim. Any preamble that moved the meta down
  // is compensated with blank lines, keeping stack traces honest.
  const padding = "\n".repeat(Math.max(0, analyzed.metaEndLine - 1));
  return `${prefix}${padding}${rawBody}\n})()`;
}

/**
 * Timer shim. The script sees an opaque numeric handle, so no host object ever
 * crosses back into the sandbox, and `clearTimeout` keeps working — a handle
 * copied through the boundary the way other values are would arrive as `{}`.
 */
function createTimerShims(): {
  setTimeout: (callback: unknown, ms?: number) => number;
  clearTimeout: (handle: unknown) => void;
} {
  const handles = new Map<number, NodeJS.Timeout>();
  let nextHandle = 1;
  return {
    setTimeout: (callback: unknown, ms?: number) => {
      const handle = setTimeout(
        typeof callback === "function" ? (callback as () => void) : () => {},
        typeof ms === "number" ? ms : 0,
      );
      const id = nextHandle++;
      handles.set(id, handle);
      return id;
    },
    clearTimeout: (handle: unknown) => {
      if (typeof handle !== "number") return;
      const timeout = handles.get(handle);
      if (!timeout) return;
      clearTimeout(timeout);
      handles.delete(handle);
    },
  };
}

function createSandboxContext(apis: WorkflowScriptApis): vm.Context {
  // The context starts empty so its global object is the only thing the script
  // ever sees; the words are defined below, through the VM realm, once the
  // boundary helpers exist.
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
  });

  const boundary = vm.runInContext(VM_BOUNDARY_SOURCE, context) as VmBoundary;
  const timers = createTimerShims();
  const consoleLog = (...args: unknown[]) => apis.log(formatConsoleArgs(args));

  const words: Record<string, unknown> = {
    agent: boundary.callAsync(apis.agent),
    parallel: boundary.callAsync(apis.parallel),
    pipeline: boundary.callAsync(apis.pipeline),
    phase: boundary.call(apis.phase),
    log: boundary.call(apis.log),
    args: boundary.clone(apis.args),
    budget: boundary.record([
      ["total", apis.budget.total ?? null],
      ["spent", boundary.call(apis.budget.spent)],
      ["remaining", boundary.call(apis.budget.remaining)],
    ]),
    console: boundary.record([
      ["log", boundary.call(consoleLog)],
      ["warn", boundary.call(consoleLog)],
      ["error", boundary.call(consoleLog)],
    ]),
    // The run's failure list, readable and appendable from the script (Claude
    // Code exposes `getFailures`/`recordFailure` to scripts, evidence §3). Both
    // cross the boundary through `call`, so the returned array is a realm-local
    // copy — the script cannot reach the host array by keeping a reference.
    getFailures: boundary.call(apis.getFailures),
    recordFailure: boundary.call(apis.recordFailure),
    // Read-only run tallies (场景 6). They cross the boundary through `call`
    // too, so `getStats()` hands the script a realm-local copy of the counters
    // rather than the host object itself.
    getAgentCount: boundary.call(apis.getAgentCount),
    getStats: boundary.call(apis.getStats),
    setTimeout: boundary.call(timers.setTimeout),
    clearTimeout: boundary.call(timers.clearTimeout),
  };

  // Writing to the context's own global object (rather than to the host sandbox
  // object it was created from) is what keeps the words realm-local.
  const globalObject = vm.runInContext("globalThis", context) as Record<
    string,
    unknown
  >;
  for (const [key, value] of Object.entries(words)) {
    Object.defineProperty(globalObject, key, {
      value,
      writable: true,
      enumerable: true,
      configurable: true,
    });
  }

  new vm.Script(DETERMINISM_SHIM_SOURCE, {
    filename: SCRIPT_FILENAME,
  }).runInContext(context);
  return context;
}

function formatConsoleArgs(args: unknown[]): string {
  return args
    .map((arg) => {
      if (typeof arg === "string") return arg;
      try {
        const serialized = JSON.stringify(arg);
        return serialized === undefined ? String(arg) : serialized;
      } catch {
        return String(arg);
      }
    })
    .join(" ");
}

/** Copy the script result out of the VM realm so no foreign prototypes leak. */
function sanitizeResult(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? undefined : JSON.parse(serialized);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Workflow script returned a value that cannot be serialized: ${message}`,
    );
  }
}

/** Errors thrown inside the VM are not host `Error` instances; normalize them. */
function toHostError(error: unknown): Error {
  if (error instanceof Error) return error;
  const message = (error as { message?: unknown } | null)?.message;
  const hostError = new Error(
    typeof message === "string" ? message : String(error),
  );
  const stack = (error as { stack?: unknown } | null)?.stack;
  if (typeof stack === "string") {
    hostError.stack = stack;
  }
  return hostError;
}

/** Settles (by rejecting) as soon as the run is aborted; never settles otherwise. */
async function abortSignalPromise(abortSignal: AbortSignal): Promise<never> {
  if (abortSignal.aborted) {
    throw new Error("Workflow aborted");
  }
  await new Promise<void>((resolve) => {
    abortSignal.addEventListener("abort", () => resolve(), { once: true });
  });
  throw new Error("Workflow aborted");
}
