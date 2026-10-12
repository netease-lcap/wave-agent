import type {
  AnyNode,
  ArrayExpression,
  Literal,
  ObjectExpression,
  TemplateLiteral,
  UnaryExpression,
} from "acorn";

/**
 * Reason labels for the expressions that are not allowed inside `meta`.
 *
 * Each label names the offending category, so a rejected script can say *why*
 * it was rejected instead of just "invalid meta" — the model reads these
 * diagnostics and has to fix the `meta` from them, so they stay in English like
 * every other model-facing message in the SDK.
 */
const UNSUPPORTED_EXPRESSION_LABELS: Record<string, string> = {
  Identifier: "identifier reference",
  CallExpression: "function call",
  NewExpression: "new expression",
  MemberExpression: "member access",
  BinaryExpression: "binary expression",
  LogicalExpression: "logical expression",
  ConditionalExpression: "conditional expression",
  SequenceExpression: "sequence expression",
  AssignmentExpression: "assignment expression",
  UpdateExpression: "update expression",
  ArrowFunctionExpression: "function expression",
  FunctionExpression: "function expression",
  ClassExpression: "class expression",
  TaggedTemplateExpression: "tagged template",
  AwaitExpression: "await expression",
  YieldExpression: "yield expression",
  ThisExpression: "this reference",
  Super: "super reference",
  SpreadElement: "spread element",
  RestElement: "rest element",
  MetaProperty: "import.meta",
};

export interface MetaLiteralFailure {
  /** The offending category, e.g. `template interpolation`. */
  reason: string;
  /** 1-based line of the offending node. */
  line: number;
  /** 1-based column of the offending node. */
  column: number;
}

export type MetaLiteralResult =
  | { ok: true; value: unknown }
  | ({ ok: false } & MetaLiteralFailure);

/** Human readable rendering of a failure, e.g. `template interpolation at line 3, column 11`. */
export function describeFailure(failure: MetaLiteralFailure): string {
  return `${failure.reason} at line ${failure.line}, column ${failure.column}`;
}

/**
 * Evaluate a `meta` initializer without executing anything: only literals,
 * arrays and nested plain objects are accepted. Every other construct is
 * rejected by category, so the caller can point at the exact violation.
 */
export function evaluateMetaLiteral(node: AnyNode): MetaLiteralResult {
  switch (node.type) {
    case "ObjectExpression":
      return evaluateObjectExpression(node);
    case "ArrayExpression":
      return evaluateArrayExpression(node);
    case "TemplateLiteral":
      return evaluateTemplateLiteral(node);
    case "UnaryExpression":
      return evaluateUnaryExpression(node);
    case "Literal":
      return evaluatePrimitiveLiteral(node);
    default:
      return fail(
        node,
        UNSUPPORTED_EXPRESSION_LABELS[node.type] ?? `unsupported ${node.type}`,
      );
  }
}

function evaluateObjectExpression(node: ObjectExpression): MetaLiteralResult {
  const value: Record<string, unknown> = {};
  for (const property of node.properties) {
    if (property.type === "SpreadElement") {
      return fail(property, "spread element");
    }
    if (property.computed) {
      return fail(property, "computed key");
    }
    if (property.kind !== "init" || property.method) {
      return fail(property, "method definition");
    }
    const key = readStaticKey(property.key);
    if (key === null || key === "__proto__") {
      return fail(property, "unsupported key");
    }
    const evaluated = evaluateMetaLiteral(property.value);
    if (!evaluated.ok) {
      return evaluated;
    }
    value[key] = evaluated.value;
  }
  return { ok: true, value };
}

function evaluateArrayExpression(node: ArrayExpression): MetaLiteralResult {
  const value: unknown[] = [];
  for (const element of node.elements) {
    if (element === null) {
      return fail(node, "sparse array");
    }
    if (element.type === "SpreadElement") {
      return fail(element, "spread element");
    }
    const evaluated = evaluateMetaLiteral(element);
    if (!evaluated.ok) {
      return evaluated;
    }
    value.push(evaluated.value);
  }
  return { ok: true, value };
}

function evaluateTemplateLiteral(node: TemplateLiteral): MetaLiteralResult {
  if (node.expressions.length > 0) {
    return fail(node, "template interpolation");
  }
  let value = "";
  for (const quasi of node.quasis) {
    value += quasi.value.cooked ?? quasi.value.raw;
  }
  return { ok: true, value };
}

function evaluateUnaryExpression(node: UnaryExpression): MetaLiteralResult {
  // `-1` / `+1` are the only way to spell a negative/positive number literal.
  if (
    (node.operator === "-" || node.operator === "+") &&
    node.argument.type === "Literal" &&
    typeof node.argument.value === "number"
  ) {
    return {
      ok: true,
      value: node.operator === "-" ? -node.argument.value : node.argument.value,
    };
  }
  return fail(node, "unary operation");
}

function evaluatePrimitiveLiteral(node: Literal): MetaLiteralResult {
  if (
    node.regex !== undefined ||
    node.bigint !== undefined ||
    node.value instanceof RegExp
  ) {
    return fail(node, "unsupported literal");
  }
  return { ok: true, value: node.value };
}

function readStaticKey(key: AnyNode): string | null {
  if (key.type === "Identifier") {
    return key.name;
  }
  if (key.type === "Literal" && typeof key.value === "string") {
    return key.value;
  }
  return null;
}

function fail(node: AnyNode, reason: string): MetaLiteralResult {
  const start = node.loc?.start;
  return {
    ok: false,
    reason,
    line: start ? start.line : 0,
    column: start ? start.column + 1 : 0,
  };
}
