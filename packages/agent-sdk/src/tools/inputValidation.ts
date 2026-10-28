/**
 * Runtime check of a tool call's arguments against the JSON Schema the tool
 * declares for the model (`config.function.parameters`).
 *
 * The declaration was, until this file existed, only ever *sent to the model*:
 * nothing checked a call against it, so a wrong key silently became `undefined`
 * inside the tool. That failure mode is worse than an error — `Write` without
 * `content` writes the string "undefined" into a file, `TaskUpdate` without
 * `taskId` reads `tasks/undefined.json` and answers "Task #undefined not found",
 * which names neither the real cause nor the parameter at fault.
 *
 * The reported wording mirrors Claude Code's schema layer (`gD(toolName, zodError)`
 * in its binary): one line per issue, a fixed shape per issue kind, all issues
 * listed at once. What is deliberately *not* mirrored is CC's `coerceInput` layer
 * — wave first lets the real error surface; a compatibility shim can come later,
 * once there is data about what models actually send.
 *
 * Only a subset of JSON Schema is interpreted: `type`, `required`, `enum`,
 * unknown keys, nested object `properties`, and array `items`. A constraint this
 * file does not understand is a constraint it does not enforce — the alternative
 * (treating an uninterpreted keyword as satisfied) would be a silent lie.
 */

/**
 * Deepest object/array nesting the walker descends into.
 *
 * This is a recursion bound, not a policy: stopping early does not reject the
 * sub-tree, it silently accepts it (`checkValue` / `checkObject` return as soon
 * as `depth > MAX_DEPTH`). The number therefore has to clear the deepest leaf a
 * schema wave actually ships. `AskUserQuestion` sets the bar with
 * `questions: [{ options: [{ label }] }]`, where each `{ }` and every array
 * element costs a step:
 *
 *   depth 0  the argument object
 *   depth 1  `questions` (array)
 *   depth 2  `questions[0]` (value)
 *   depth 3  `questions[0]` (its keys)
 *   depth 4  `questions[0].options` (array)
 *   depth 5  `questions[0].options[0]` (value)
 *   depth 6  `questions[0].options[0]` (its keys — `label` required, seen here)
 *   depth 7  the `label` value (its `type`, seen here)
 *
 * 4 cut that structure in half, so nothing inside `options` was examined — how
 * an option with no `label` reached the confirmation card as a blank row.
 */
const MAX_DEPTH = 7;

/** Paths are joined the way the message reads: `asset_id`, `questions[0].header`. */
function joinPath(path: string, key: string): string {
  return path === "" ? key : `${path}.${key}`;
}

function asSchema(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

type JsonType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "object"
  | "array"
  | "null";

/** The JSON type of a parsed value, with integers told apart from fractions. */
function jsonTypeOf(value: unknown): JsonType {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "string") return "string";
  if (typeof value === "number") {
    return Number.isInteger(value) ? "integer" : "number";
  }
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "object") return "object";
  // Functions and symbols never arrive from JSON; reporting them as null keeps
  // the type check honest instead of letting them slip through.
  return "null";
}

/** A declared type list, or null when the schema constrains no type. */
function declaredTypes(schema: Record<string, unknown>): string[] | null {
  const type = schema.type;
  if (typeof type === "string") return [type];
  if (Array.isArray(type) && type.every((t) => typeof t === "string")) {
    return type as string[];
  }
  return null;
}

function matchesDeclaredType(declared: string, actual: JsonType): boolean {
  // An integer is a number for schema purposes; the reverse is not true.
  if (declared === "number") return actual === "number" || actual === "integer";
  return declared === actual;
}

function hasType(value: unknown, declared: string[]): boolean {
  const actual = jsonTypeOf(value);
  return declared.some((type) => matchesDeclaredType(type, actual));
}

/**
 * Check one value against its property schema.
 *
 * A type mismatch stops the descent into that value: reporting both "expected an
 * object" and "this object's key is missing" for the same argument would read as
 * two separate mistakes.
 */
function checkValue(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  issues: Issues,
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;

  const types = declaredTypes(schema);
  if (types !== null && !hasType(value, types)) {
    issues.type.push(
      `The parameter \`${path}\` type is expected as \`${types.join(" | ")}\` but provided as \`${jsonTypeOf(value)}\``,
    );
    return;
  }

  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && !enumValues.some((v) => v === value)) {
    issues.invalid.push(
      `The parameter \`${path}\` is invalid: expected one of ${enumValues
        .map((v) => JSON.stringify(v))
        .join(", ")}`,
    );
  }

  if (Array.isArray(value)) {
    const items = asSchema(schema.items);
    if (items !== null) {
      value.forEach((element, index) => {
        checkValue(items, element, `${path}[${index}]`, issues, depth + 1);
      });
    }
    return;
  }

  const object = asSchema(value);
  if (object !== null) {
    checkObject(schema, object, path, issues, depth + 1);
  }
}

/**
 * Check an object's keys: required present, declared keys typed, the rest either
 * declared `additionalProperties: true` (free-form), described by an
 * `additionalProperties` schema (typed), or reported as unexpected.
 */
function checkObject(
  schema: Record<string, unknown>,
  value: Record<string, unknown>,
  path: string,
  issues: Issues,
  depth: number,
): void {
  if (depth > MAX_DEPTH) return;

  // A schema that describes no object shape at all (`{}`) constrains nothing:
  // treating "no properties declared" as "every key is unexpected" would reject
  // calls the tool never said were wrong. Strictness starts where the schema
  // starts describing keys.
  const describesKeys =
    "properties" in schema || "additionalProperties" in schema;
  if (!describesKeys) return;

  const properties = asSchema(schema.properties) ?? {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((name): name is string => typeof name === "string")
    : [];
  const declared = new Set([...Object.keys(properties), ...required]);

  for (const name of required) {
    if (value[name] === undefined) {
      issues.required.push(
        `The required parameter \`${joinPath(path, name)}\` is missing`,
      );
    }
  }

  const additional = schema.additionalProperties;
  const additionalSchema = asSchema(additional);

  for (const [name, child] of Object.entries(value)) {
    if (child === undefined) continue;
    const childPath = joinPath(path, name);
    const propertySchema = asSchema(properties[name]);

    if (propertySchema !== null) {
      checkValue(propertySchema, child, childPath, issues, depth + 1);
      continue;
    }
    if (declared.has(name)) continue;
    if (additional === true) continue;
    if (additionalSchema !== null) {
      checkValue(additionalSchema, child, childPath, issues, depth + 1);
      continue;
    }
    issues.unexpected.push(
      `An unexpected parameter \`${childPath}\` was provided`,
    );
  }
}

/** Issues bucketed so the report keeps Claude Code's order. */
interface Issues {
  required: string[];
  unexpected: string[];
  type: string[];
  invalid: string[];
}

/**
 * Validate `args` against a tool's declared `parameters`.
 *
 * Returns the message to hand back to the model, or null when the call is
 * acceptable (or the tool declares no schema — a tool that says nothing is not
 * checked, which keeps `buildTool()` and MCP tools on their previous behavior).
 */
export function validateToolInput(
  toolName: string,
  parameters: unknown,
  args: Record<string, unknown>,
): string | null {
  const schema = asSchema(parameters);
  if (schema === null) return null;

  const issues: Issues = {
    required: [],
    unexpected: [],
    type: [],
    invalid: [],
  };
  checkObject(schema, args, "", issues, 0);

  // Required first, then unexpected keys, then type mismatches, then the rest —
  // the same reading order Claude Code uses: what is missing, what does not
  // belong, what has the wrong shape, and only then everything else.
  const lines = [
    ...issues.required,
    ...issues.unexpected,
    ...issues.type,
    ...issues.invalid,
  ];
  if (lines.length === 0) return null;

  return [
    `${toolName} failed due to the following ${lines.length > 1 ? "issues" : "issue"}:`,
    ...lines,
  ].join("\n");
}
