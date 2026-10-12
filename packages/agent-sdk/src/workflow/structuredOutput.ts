/**
 * Structured output for the workflow `agent({ schema })` path
 * (docs/specs/multi-agent/workflow.md 「来自 agent 的结构化输出」).
 *
 * The constraint is enforced the way Claude Code 2.1.293 enforces it — by
 * registering a `StructuredOutput` tool whose input schema is the caller's
 * schema, by a prompt convention, and by an in-conversation nudge — and NOT by
 * forcing `tool_choice` (a forced tool choice breaks thinking models; see
 * `aiService`'s request-layer demotion). Everything in this module that has a
 * Claude Code counterpart cites the verbatim constant/function it came from.
 */
import type { ErrorObject } from "ajv";
import type { Message, ToolBlock } from "../types/messaging.js";
import type { ToolPlugin } from "../tools/types.js";

const STRUCTURED_OUTPUT_TOOL_NAME = "StructuredOutput";

/**
 * How many times a subagent may be nudged for a schema-valid answer before
 * `agent()` gives up and throws. Claude Code caps the same way
 * (`MAX_STRUCTURED_OUTPUT_RETRIES`, default `Wdn = 5`), but its counter counts
 * *failed StructuredOutput calls* while wave counts nudge-retries, so the
 * number matches and the boundary can differ by one round.
 */
export const MAX_STRUCTURED_OUTPUT_RETRIES = 5;

/** Claude Code's nudge marker (`MRt`), kept verbatim. */
const NUDGE_MARKER = "[structured-output-enforce]";

/**
 * Creates a system prompt addition that instructs the agent to use structured output
 */
export function createStructuredOutputPrompt(schema: object): string {
  return `\n\nIMPORTANT: You MUST call the ${STRUCTURED_OUTPUT_TOOL_NAME} tool with your final answer. Do not just write the answer as text — call the tool with a JSON object matching this schema:\n${JSON.stringify(schema, null, 2)}\n\nCall this tool exactly once with your complete answer.`;
}

/**
 * The in-conversation nudge, injected as a meta user message into the
 * subagent's own conversation when a round ended without a schema-valid
 * StructuredOutput call. Verbatim Claude Code 2.1.293 text
 * (`` `${MRt} You MUST call the ${ia} tool to complete this request. Call this tool now.` ``).
 */
export function createStructuredOutputNudge(): string {
  return `${NUDGE_MARKER} You MUST call the ${STRUCTURED_OUTPUT_TOOL_NAME} tool to complete this request. Call this tool now.`;
}

/**
 * Creates a StructuredOutput ToolPlugin that enforces the given schema.
 *
 * The tool validates its own arguments (Claude Code does the same inside the
 * tool's `call`, which is what lets a model read the error and retry within the
 * same turn): a mismatch comes back as a failed tool result carrying the
 * validation message instead of being silently accepted.
 */
export function createStructuredOutputTool(schema: object): ToolPlugin {
  return {
    name: STRUCTURED_OUTPUT_TOOL_NAME,
    config: {
      type: "function" as const,
      function: {
        name: STRUCTURED_OUTPUT_TOOL_NAME,
        // Claude Code's `description()` / `prompt()` for this tool, verbatim.
        description: "Return structured output in the requested format",
        parameters: schema as Record<string, unknown>,
      },
    },
    prompt: () =>
      "Use this tool to return your final response in the requested structured format. " +
      `You MUST call this tool exactly once at the end of your response to provide the structured output.`,
    execute: async (args: Record<string, unknown>) => {
      const prepared = await prepareStructuredOutputSchema(schema);
      if (!prepared.ok) {
        return {
          success: false,
          content: prepared.message,
          error: prepared.message,
        };
      }
      const check = prepared.validate(args);
      if (!check.valid) {
        const message = `Output does not match required schema: ${check.error}`;
        return { success: false, content: message, error: message };
      }
      return { success: true, content: JSON.stringify(args) };
    },
  };
}

/** Outcome of scanning a subagent's conversation for its structured answer. */
export interface StructuredOutputScan {
  /** Set when a StructuredOutput call matched the schema. */
  value?: unknown;
  /**
   * Summary of the most recent validation failure — surfaced in the error
   * thrown once the retry budget is spent (scenario 3). Absent when the
   * subagent never called the tool at all.
   */
  error?: string;
}

/**
 * Scan a completed round's messages for the subagent's StructuredOutput call
 * and validate it against the schema.
 *
 * Searches backwards so the LAST valid call wins (an earlier good answer is not
 * discarded by a later bad one), and reports the most recent failure otherwise.
 * Deliberately has NO text fallback: a JSON blob inside the final text is not a
 * structured result (scenario 3), so a run that never calls the tool can only
 * end in the nudge loop's error.
 */
export async function extractStructuredResult(
  messages: Message[],
  schema: object,
): Promise<StructuredOutputScan> {
  const calls = messages
    .filter((message) => message.role === "assistant")
    .flatMap((message) => message.blocks)
    .filter(
      (block): block is ToolBlock =>
        block.type === "tool" &&
        block.name === STRUCTURED_OUTPUT_TOOL_NAME &&
        block.stage === "end",
    );

  if (calls.length === 0) {
    return {};
  }

  const prepared = await prepareStructuredOutputSchema(schema);
  if (!prepared.ok) {
    return { error: prepared.message };
  }

  let lastError: string | undefined;
  for (let i = calls.length - 1; i >= 0; i--) {
    const call = calls[i];

    // A call the harness rejected can never be the answer, even if its
    // arguments happen to match the schema.
    if (call.success === false) {
      lastError ??= describeCallError(call);
      continue;
    }

    const parsed = parseParameters(call.parameters);
    if (!parsed.ok) {
      lastError ??= `the ${STRUCTURED_OUTPUT_TOOL_NAME} arguments were not valid JSON`;
      continue;
    }

    const check = prepared.validate(parsed.value);
    if (check.valid) {
      return { value: parsed.value };
    }
    lastError ??= `Output does not match required schema: ${check.error}`;
  }

  return { error: lastError };
}

function describeCallError(call: ToolBlock): string {
  if (typeof call.error === "string" && call.error.length > 0) {
    return call.error;
  }
  if (call.error instanceof Error && call.error.message.length > 0) {
    return call.error.message;
  }
  if (typeof call.result === "string" && call.result.length > 0) {
    return call.result;
  }
  return `${STRUCTURED_OUTPUT_TOOL_NAME} was rejected`;
}

function parseParameters(
  parameters: string | undefined,
): { ok: true; value: unknown } | { ok: false } {
  if (parameters === undefined) {
    return { ok: false };
  }
  try {
    return { ok: true, value: JSON.parse(parameters) };
  } catch {
    return { ok: false };
  }
}

/** A schema-checked validator for one schema: `value` in, verdict out. */
export type StructuredOutputValidator = (
  value: unknown,
) => { valid: true } | { valid: false; error: string };

/**
 * Result of the pre-flight schema check. `agent()` runs this BEFORE spawning
 * the subagent (scenario 4), so an unusable schema costs no tokens.
 */
export type StructuredOutputSchemaPreparation =
  | { ok: true; validate: StructuredOutputValidator }
  | { ok: false; message: string };

/**
 * Compiled validators, keyed by the schema object the caller passed. Workflows
 * call `agent()` in loops with the same literal schema object, and compiling a
 * validator with ajv is not free, so memoize it (Claude Code memoizes the same
 * way, via a WeakMap in `Ttt`).
 */
const preparations = new WeakMap<
  object,
  Promise<StructuredOutputSchemaPreparation>
>();

/**
 * Validate a schema and return the validator that decides the result.
 * Two layers, both mirrored from Claude Code:
 *  1. ajv — `{ allErrors: true, validateFormats: false, multipleOfPrecision: 6 }`,
 *     meta-schema validated first, `$async` schemas and oversized schemas
 *     rejected;
 *  2. an "unsatisfiable" lint — a root that is not an object, a `required` entry
 *     that `additionalProperties: false` forbids, `enum`/`const` that contradict
 *     `type`, crossed numeric/length bounds.
 */
export function prepareStructuredOutputSchema(
  schema: object,
): Promise<StructuredOutputSchemaPreparation> {
  const cached = preparations.get(schema);
  if (cached) {
    return cached;
  }
  const pending = prepareSchema(schema);
  preparations.set(schema, pending);
  return pending;
}

async function prepareSchema(
  schema: object,
): Promise<StructuredOutputSchemaPreparation> {
  if (isTooLargeToInspect(schema)) {
    return { ok: false, message: invalidSchemaMessage("schema too large") };
  }
  // Claude Code rejects `$async` schemas outright: async validation would move
  // the verdict off the tool-call path the retry loop reads.
  const asyncSchema: unknown = (schema as { $async?: unknown }).$async;
  if (asyncSchema !== undefined && asyncSchema !== false) {
    return {
      ok: false,
      message: invalidSchemaMessage("$async schemas are not supported"),
    };
  }

  let validate: StructuredOutputValidator;
  try {
    const AjvClass = await loadAjv();
    const ajv = new AjvClass({
      allErrors: true,
      validateFormats: false,
      multipleOfPrecision: 6,
    });
    if (!ajv.validateSchema(schema)) {
      return {
        ok: false,
        message: invalidSchemaMessage(ajv.errorsText(ajv.errors)),
      };
    }
    const compiled = ajv.compile(schema);
    validate = (value: unknown) => {
      if (compiled(value)) {
        return { valid: true };
      }
      const errors: ErrorObject[] = compiled.errors ?? [];
      return {
        valid: false,
        error: errors.map((error) => formatAjvError(error, value)).join(", "),
      };
    };
  } catch (error) {
    return {
      ok: false,
      message: invalidSchemaMessage(
        error instanceof Error ? error.message : String(error),
      ),
    };
  }

  const unsatisfiable = findUnsatisfiableFinding(schema);
  if (unsatisfiable) {
    return {
      ok: false,
      message:
        `agent({schema}) received an unusable JSON Schema — ` +
        `${describeFinding(unsatisfiable)}: ${unsatisfiable.message}. ` +
        `The subagent was not started — fix the schema and call agent() again.`,
    };
  }

  return { ok: true, validate };
}

/** Claude Code: `` `agent({schema}) received an invalid JSON Schema: ${error}` ``. */
function invalidSchemaMessage(error: string): string {
  return `agent({schema}) received an invalid JSON Schema: ${error}`;
}

/**
 * Lazily loaded so the SDK's module graph never pulls ajv into a host bundle:
 * structured output only exists while a workflow with `opts.schema` runs.
 */
type AjvClass = typeof import("ajv").default;

let ajvClass: Promise<AjvClass> | undefined;

function loadAjv(): Promise<AjvClass> {
  if (!ajvClass) {
    // ajv is CJS: the dynamic-import interop namespace types `default` as
    // `typeof namespace | typeof Ajv`, so pin it back to the constructor.
    ajvClass = import("ajv").then(
      (module) => module.default as unknown as AjvClass,
    );
  }
  return ajvClass;
}

/**
 * Claude Code renders one ajv error as `<instancePath || "root">: <message>`
 * plus a keyword-specific tail (the offending value for length/count checks,
 * the allowed values for `enum`/`const`).
 */
function formatAjvError(error: ErrorObject, data: unknown): string {
  const base = `${error.instancePath || "root"}: ${error.message}`;
  const params = error.params as unknown as Record<string, unknown>;
  switch (error.keyword) {
    case "additionalProperties": {
      const extra = params.additionalProperty;
      if (typeof extra !== "string") return base;
      return `${base} ('${truncate(extra, NAME_LIMIT)}' is not allowed)`;
    }
    case "minLength":
    case "maxLength": {
      const value = valueAtPath(data, error.instancePath);
      return typeof value === "string" ? `${base} (got ${value.length})` : base;
    }
    case "minItems":
    case "maxItems": {
      const value = valueAtPath(data, error.instancePath);
      return Array.isArray(value) ? `${base} (got ${value.length})` : base;
    }
    case "minProperties":
    case "maxProperties": {
      const value = valueAtPath(data, error.instancePath);
      return isPlainObject(value)
        ? `${base} (got ${Object.keys(value).length})`
        : base;
    }
    case "enum": {
      const allowed = params.allowedValues;
      if (!Array.isArray(allowed)) return base;
      const rendered = allowed
        .map((value) => renderScalar(value))
        .find(Boolean);
      return rendered === undefined ? base : `${base}: ${rendered}`;
    }
    case "const": {
      const rendered = renderScalar(params.allowedValue ?? params.constValue);
      return rendered === undefined ? base : `${base}: ${rendered}`;
    }
    default:
      return base;
  }
}

/** Claude Code's `j(e,n)`: resolve a JSON-pointer-ish `instancePath`. */
function valueAtPath(data: unknown, instancePath: string): unknown {
  let current: unknown = data;
  for (const segment of instancePath.split("/").slice(1)) {
    const key = segment.replace(/~1/g, "/").replace(/~0/g, "~");
    if (Array.isArray(current)) {
      current = current[Number(key)];
    } else if (
      isPlainObject(current) &&
      Object.prototype.hasOwnProperty.call(current, key)
    ) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

function renderScalar(value: unknown): string | undefined {
  if (value === null) return "null";
  if (typeof value === "string") return truncate(value, ENUM_VALUE_LIMIT);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

/**
 * Claude Code's `_e(e, {n: 1e5}, 0)`: reject absurdly large schemas before any
 * walk touches them.
 */
function isTooLargeToInspect(schema: unknown): boolean {
  let remaining = MAX_SCHEMA_NODES;
  const visit = (node: unknown, depth: number): boolean => {
    if (--remaining < 0 || depth > MAX_SCHEMA_NESTING) return true;
    if (typeof node !== "object" || node === null) return false;
    for (const value of Object.values(node)) {
      if (visit(value, depth + 1)) return true;
    }
    return false;
  };
  return visit(schema, 0);
}

interface UnsatisfiableFinding {
  reason: string;
  scope: "whole" | "subschema";
  message: string;
}

interface SchemaNodeBudget {
  remaining: number;
}

/** Claude Code's `ie` (also the source of `ktt`'s messages). */
function findUnsatisfiableFinding(
  schema: object,
): UnsatisfiableFinding | undefined {
  const root = schema as Record<string, unknown>;
  if (own(root, "type") !== "object") {
    return {
      reason: "root_not_object",
      scope: "whole",
      message:
        "the root schema must declare type: 'object' (the API rejects any other root type for a tool input schema); wrap arrays or primitives in an object property",
    };
  }
  return inspectNode(root, "", true, LINT_MAX_DEPTH, {
    remaining: LINT_MAX_NODES,
  });
}

/** Claude Code's `ktt`. */
function describeFinding(finding: UnsatisfiableFinding): string {
  if (finding.reason === "root_not_object") {
    return "the API only accepts an object-rooted tool input schema, so every request would be rejected";
  }
  return finding.scope === "whole"
    ? "no output can satisfy this schema, so StructuredOutput validation would fail on every attempt"
    : "one property or item sub-schema admits no value, so any output that fills it in fails validation";
}

/** Claude Code's `B`: walk properties/items looking for an unsatisfiable node. */
function inspectNode(
  node: unknown,
  pointer: string,
  wholeDocument: boolean,
  depth: number,
  budget: SchemaNodeBudget,
): UnsatisfiableFinding | undefined {
  if (depth <= 0 || --budget.remaining < 0) return undefined;
  if (
    !isPlainObject(node) ||
    Object.prototype.hasOwnProperty.call(node, "$ref")
  )
    return undefined;

  const types = declaredTypes(node);
  const direct = checkNode(node, pointer, types);
  if (direct) {
    return { ...direct, scope: wholeDocument ? "whole" : "subschema" };
  }

  const properties = own(node, "properties");
  if (allowsType(types, "object") && isPlainObject(properties)) {
    const required = own(node, "required");
    const requiredNames = new Set(
      Array.isArray(required) ? required.filter(isSafeKey) : [],
    );
    const declaresObjectOnly = isExactlyType(types, "object");
    for (const [name, subSchema] of Object.entries(properties)) {
      if (name === "__proto__") continue;
      const finding = inspectNode(
        subSchema,
        `${pointer}/properties/${escapePointer(name)}`,
        wholeDocument && declaresObjectOnly && requiredNames.has(name),
        depth - 1,
        budget,
      );
      if (finding) return finding;
    }
  }

  const items = own(node, "items");
  if (allowsType(types, "array") && isPlainObject(items)) {
    return inspectNode(items, `${pointer}/items`, false, depth - 1, budget);
  }

  return undefined;
}

/** Claude Code's `Ne`: contradictions a single node carries on its own. */
function checkNode(
  node: Record<string, unknown>,
  pointer: string,
  types: string[] | undefined,
): { reason: string; message: string } | undefined {
  const where =
    pointer === ""
      ? "the root object"
      : `the sub-schema at ${truncate(pointer, PATH_LIMIT)}`;

  const required = own(node, "required");
  if (
    isExactlyType(types, "object") &&
    Array.isArray(required) &&
    own(node, "additionalProperties") === false &&
    own(node, "patternProperties") === undefined
  ) {
    const properties = own(node, "properties");
    const declared = isPlainObject(properties) ? properties : {};
    for (const name of required) {
      if (
        isSafeKey(name) &&
        !Object.prototype.hasOwnProperty.call(declared, name)
      ) {
        return {
          reason: "required_property_forbidden",
          message: `${where} lists "${truncate(name, NAME_LIMIT)}" in required but does not declare it in properties, and additionalProperties is false, so no object can satisfy it — declare the property or drop it from required`,
        };
      }
    }
  }

  const enumValues = own(node, "enum");
  if (
    types !== undefined &&
    Array.isArray(enumValues) &&
    enumValues.length > 0
  ) {
    if (!enumValues.some((value) => matchesAnyType(value, types))) {
      return {
        reason: "enum_type_mismatch",
        message: `${where} declares type ${describeTypes(types)} but none of its enum values has that type, so no value can satisfy it — change type to match the enum values or vice versa`,
      };
    }
  }

  const constValue = own(node, "const");
  if (constValue !== undefined) {
    if (types !== undefined && !matchesAnyType(constValue, types)) {
      return {
        reason: "const_mismatch",
        message: `${where} declares type ${describeTypes(types)} but its const value does not have that type, so no value can satisfy it`,
      };
    }
    if (
      Array.isArray(enumValues) &&
      enumValues.length > 0 &&
      isScalar(constValue) &&
      !enumValues.some((value) => value === constValue)
    ) {
      return {
        reason: "const_mismatch",
        message: `${where} has a const value that is not one of its enum values, so no value can satisfy it`,
      };
    }
  }

  const crossed = describeCrossedBounds(node, types);
  if (crossed !== undefined) {
    return {
      reason: "crossed_bounds",
      message: `${where} has ${crossed}, so no value can satisfy it`,
    };
  }

  return undefined;
}

/** Claude Code's `Me`: bounds that leave no value for the declared type. */
function describeCrossedBounds(
  node: Record<string, unknown>,
  types: string[] | undefined,
): string | undefined {
  if (
    isExactlyType(types, "number") ||
    isExactlyType(types, "integer") ||
    isEitherPair(types, "number", "integer")
  ) {
    const minimum = finiteNumber(own(node, "minimum"));
    const exclusiveMinimum = finiteNumber(own(node, "exclusiveMinimum"));
    const maximum = finiteNumber(own(node, "maximum"));
    const exclusiveMaximum = finiteNumber(own(node, "exclusiveMaximum"));
    const lower =
      exclusiveMinimum !== undefined &&
      (minimum === undefined || exclusiveMinimum >= minimum)
        ? {
            value: exclusiveMinimum,
            exclusive: true,
            keyword: "exclusiveMinimum",
          }
        : minimum !== undefined
          ? { value: minimum, exclusive: false, keyword: "minimum" }
          : undefined;
    const upper =
      exclusiveMaximum !== undefined &&
      (maximum === undefined || exclusiveMaximum <= maximum)
        ? {
            value: exclusiveMaximum,
            exclusive: true,
            keyword: "exclusiveMaximum",
          }
        : maximum !== undefined
          ? { value: maximum, exclusive: false, keyword: "maximum" }
          : undefined;
    if (
      lower !== undefined &&
      upper !== undefined &&
      (lower.value > upper.value ||
        (lower.value === upper.value && (lower.exclusive || upper.exclusive)))
    ) {
      return `${lower.keyword} ${lower.value} and ${upper.keyword} ${upper.value}, which admit no number`;
    }
  }

  if (isExactlyType(types, "string")) {
    const range = crossedRange(node, "minLength", "maxLength");
    if (range !== undefined) return range;
  }
  if (isExactlyType(types, "array")) {
    const range = crossedRange(node, "minItems", "maxItems");
    if (range !== undefined) return range;
  }
  if (isExactlyType(types, "object")) {
    const range = crossedRange(node, "minProperties", "maxProperties");
    if (range !== undefined) return range;
    const maxProperties = finiteNumber(own(node, "maxProperties"));
    const required = own(node, "required");
    if (maxProperties !== undefined && Array.isArray(required)) {
      const count = required.filter(isSafeKey).length;
      if (count > maxProperties) {
        return `${count} required properties but maxProperties ${maxProperties}`;
      }
    }
  }

  return undefined;
}

/** Claude Code's `Y`. */
function crossedRange(
  node: Record<string, unknown>,
  minKeyword: string,
  maxKeyword: string,
): string | undefined {
  const min = finiteNumber(own(node, minKeyword));
  const max = finiteNumber(own(node, maxKeyword));
  return min !== undefined && max !== undefined && min > max
    ? `${minKeyword} ${min} greater than ${maxKeyword} ${max}`
    : undefined;
}

/** Claude Code's `Ie`: the normalized `type` list (plus `nullable: true`). */
function declaredTypes(node: Record<string, unknown>): string[] | undefined {
  const declared = own(node, "type");
  let types: string[];
  if (typeof declared === "string" && JSON_SCHEMA_TYPES.has(declared)) {
    types = [declared];
  } else if (
    Array.isArray(declared) &&
    declared.length > 0 &&
    declared.every(
      (entry): entry is string =>
        typeof entry === "string" && JSON_SCHEMA_TYPES.has(entry),
    )
  ) {
    types = declared.slice();
  } else {
    return undefined;
  }
  if (own(node, "nullable") === true && !types.includes("null")) {
    types.push("null");
  }
  return types;
}

/** Claude Code's `oe`: does `value` have one of these JSON types? */
function matchesAnyType(value: unknown, types: string[]): boolean {
  return types.some((type) => {
    switch (type) {
      case "null":
        return value === null;
      case "boolean":
        return typeof value === "boolean";
      case "string":
        return typeof value === "string";
      case "number":
        return typeof value === "number" && Number.isFinite(value);
      case "integer":
        return typeof value === "number" && Number.isInteger(value);
      case "array":
        return Array.isArray(value);
      case "object":
        return isPlainObject(value);
      default:
        return true;
    }
  });
}

/** Claude Code's `re`: `'string'` or `['a', 'b']`. */
function describeTypes(types: string[]): string {
  return types.length === 1
    ? `'${types[0]}'`
    : `[${types.map((type) => `'${type}'`).join(", ")}]`;
}

/** Claude Code's `He`: JSON-pointer escaping for the property path. */
function escapePointer(name: string): string {
  return truncate(name, NAME_LIMIT).replace(/~/g, "~0").replace(/\//g, "~1");
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

/** Claude Code's `Ue`. */
function isScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

/** Claude Code's `T`. */
function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/** Claude Code's `F`: a key that cannot come from `Object.prototype`. */
function isSafeKey(value: unknown): value is string {
  return typeof value === "string" && !(value in Object.prototype);
}

/** Claude Code's `S`. */
function own(node: Record<string, unknown>, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(node, key)
    ? node[key]
    : undefined;
}

/** Claude Code's `L`. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Claude Code's `te`: an undeclared type accepts everything. */
function allowsType(types: string[] | undefined, type: string): boolean {
  return types === undefined || types.includes(type);
}

/** Claude Code's `R`. */
function isExactlyType(types: string[] | undefined, type: string): boolean {
  return types !== undefined && types.length === 1 && types[0] === type;
}

/** Claude Code's `De`. */
function isEitherPair(
  types: string[] | undefined,
  first: string,
  second: string,
): boolean {
  return (
    types !== undefined &&
    types.length === 2 &&
    ((types[0] === first && types[1] === second) ||
      (types[0] === second && types[1] === first))
  );
}

const JSON_SCHEMA_TYPES = new Set([
  "object",
  "array",
  "string",
  "integer",
  "number",
  "boolean",
  "null",
]);

/** Claude Code: `ke = 32` / `Ce = 1e5` for the lint walk. */
const LINT_MAX_DEPTH = 32;
const LINT_MAX_NODES = 100_000;
/** Claude Code: `E7r = 1e5` nodes / `ze = 1e4` nesting for the size guard. */
const MAX_SCHEMA_NODES = 100_000;
const MAX_SCHEMA_NESTING = 10_000;
/** Claude Code: `se = 300` for paths, `Z = 80` for names, `ce = 300` for values. */
const PATH_LIMIT = 300;
const NAME_LIMIT = 80;
const ENUM_VALUE_LIMIT = 300;

export { STRUCTURED_OUTPUT_TOOL_NAME };
