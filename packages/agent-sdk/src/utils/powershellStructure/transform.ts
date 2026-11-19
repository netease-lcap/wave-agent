/**
 * Wire format → parsed shape.
 *
 * Two things happen here and nothing else:
 *
 * 1. **Normalisation.** PowerShell 5.1's `ConvertTo-Json` unwraps a
 *    single-element array into a bare object (and `$null` disappears entirely),
 *    so nothing may assume the wire shape is a list. `ensureArray` is applied at
 *    every list edge.
 * 2. **Vocabulary mapping.** .NET AST node names (`CommandAst`,
 *    `FileRedirectionAst`, `StringConstantExpressionAst`, …) become the small
 *    vocabulary in `types.ts` that the permission layer reasons about.
 *
 * No judgement is made about danger here — that is P3c's table. This module
 * only refuses to invent information: an unknown node name maps to `"Other"` /
 * `"UnknownStatementAst"`, never to something convenient.
 */

import {
  ParsedCommandElement,
  ParsedPowerShellCommand,
  ParsedPowerShellRedirection,
  ParsedStatement,
  ParsedVariable,
  PowerShellCommandElementType,
  PowerShellPipelineElementType,
  PowerShellSecurityPatterns,
  PowerShellStatementType,
  RawCommandElement,
  RawParsedOutput,
  RawPipelineElement,
  RawRedirection,
  RawStatement,
} from "./types.js";

/** `a` if it is an array, `[]` for nullish, `[a]` otherwise. */
export function ensureArray<T>(value: T | T[] | null | undefined): T[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** Statement node name → our `PowerShellStatementType`, defaulting to unknown. */
const STATEMENT_TYPES: Record<string, PowerShellStatementType> = {
  PipelineAst: "PipelineAst",
  PipelineChainAst: "PipelineChainAst",
  AssignmentStatementAst: "AssignmentStatementAst",
  IfStatementAst: "IfStatementAst",
  ForStatementAst: "ForStatementAst",
  ForEachStatementAst: "ForEachStatementAst",
  WhileStatementAst: "WhileStatementAst",
  DoWhileStatementAst: "DoWhileStatementAst",
  DoUntilStatementAst: "DoUntilStatementAst",
  SwitchStatementAst: "SwitchStatementAst",
  TryStatementAst: "TryStatementAst",
  TrapStatementAst: "TrapStatementAst",
  FunctionDefinitionAst: "FunctionDefinitionAst",
  DataStatementAst: "DataStatementAst",
  ParamBlockAst: "ParamBlockAst",
};

export function mapStatementType(rawType: string): PowerShellStatementType {
  return STATEMENT_TYPES[rawType] ?? "UnknownStatementAst";
}

/** `.NET` pipeline element name → our three kinds; `CommandAst` is the default. */
export function mapElementType(rawType: string): PowerShellPipelineElementType {
  switch (rawType) {
    case "CommandExpressionAst":
      return "CommandExpressionAst";
    case "ParenExpressionAst":
      return "ParenExpressionAst";
    default:
      return "CommandAst";
  }
}

/**
 * Command element (one AST child of a `CommandAst` or `CommandExpressionAst`)
 * → our element vocabulary.
 */
function mapCommandElementType(
  raw: RawCommandElement,
): PowerShellCommandElementType {
  switch (raw.type) {
    case "StringConstantExpressionAst":
      return "StringConstant";
    case "ExpandableStringExpressionAst":
      return "ExpandableString";
    case "VariableExpressionAst":
      return "Variable";
    case "CommandParameterAst":
      return "Parameter";
    case "ScriptBlockExpressionAst":
      return "ScriptBlock";
    case "MemberExpressionAst":
    case "InvokeMemberExpressionAst":
      return "MemberInvocation";
    case "SubExpressionAst":
    case "ArrayExpressionAst":
    case "ParenExpressionAst":
      // `$( )`, `@( )` and `( )` all evaluate an inner pipeline; one label is
      // enough for every caller we have (`hasSubExpressions` says the same).
      return "SubExpression";
    default:
      return "Other";
  }
}

/** Verb-Noun, PowerShell's naming convention for cmdlets. */
const CMDLET_NAME = /^[A-Za-z][A-Za-z0-9]*-[A-Za-z][A-Za-z0-9]*$/;
/** Extensions that make a bare name an executable rather than a cmdlet/alias. */
const APPLICATION_EXTENSION = /\.(exe|com|bat|cmd|ps1|psm1|psd1|vbs|msi)$/i;

/**
 * How the command name will resolve.
 *
 * `unknown` is the honest answer for a bare word (`rm`, `curl`): PowerShell
 * resolves it through alias → function → application, and only the runtime
 * knows which. Callers must treat `unknown` as "ask", not as "harmless".
 */
export function classifyCommandName(
  name: string,
): "cmdlet" | "application" | "unknown" {
  if (/[\\/]/.test(name)) return "application";
  if (APPLICATION_EXTENSION.test(name)) return "application";
  if (CMDLET_NAME.test(name)) return "cmdlet";
  return "unknown";
}

/**
 * Drop a module qualifier: `Microsoft.PowerShell.Management\Get-ChildItem` →
 * `Get-ChildItem`. Only stripped when what follows the separator is a cmdlet
 * name, so `.\build.ps1` and `C:\Windows\System32\cmd.exe` keep their paths.
 */
export function stripModulePrefix(name: string): string {
  const index = name.lastIndexOf("\\");
  if (index < 0) return name;
  const tail = name.slice(index + 1);
  return CMDLET_NAME.test(tail) ? tail : name;
}

/** Redirection target without the quotes that produced it. */
function unquote(text: string): string {
  if (text.length >= 2) {
    const first = text[0];
    const last = text[text.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return text.slice(1, -1);
    }
  }
  return text;
}

/** Map one wire redirection. `FromStream` is the output stream being written. */
export function transformRedirection(
  raw: RawRedirection,
): ParsedPowerShellRedirection | undefined {
  if (raw.type === "MergingRedirectionAst") {
    // `2>&1` (and the rarer `*>&1`): no file is opened, so there is no target
    // to check — the merge itself is what a caller may care about.
    return { operator: "2>&1", target: "", isMerging: true };
  }
  if (raw.type !== "FileRedirectionAst") return undefined;

  const append = raw.append === true;
  let operator: ParsedPowerShellRedirection["operator"];
  switch (raw.fromStream) {
    case "Error":
      operator = append ? "2>>" : "2>";
      break;
    case "All":
      operator = append ? "*>>" : "*>";
      break;
    default:
      operator = append ? ">>" : ">";
      break;
  }
  return {
    operator,
    target: unquote(raw.locationText ?? ""),
    isMerging: false,
  };
}

export function transformRedirections(
  raw: RawRedirection[] | undefined,
): ParsedPowerShellRedirection[] {
  const out: ParsedPowerShellRedirection[] = [];
  for (const item of ensureArray(raw)) {
    const redirection = transformRedirection(item);
    if (redirection) out.push(redirection);
  }
  return out;
}

/**
 * The `.value` of a string literal is its evaluated text (quotes removed,
 * escapes applied), which is what a rule should match on; anything else falls
 * back to its source text.
 */
function elementValue(raw: RawCommandElement): string {
  return raw.value === undefined ? raw.text : raw.value;
}

/**
 * One `CommandAst` → one parsed command. `commandElements[0]` is the name;
 * everything after it is an argument.
 *
 * `elementTypes` keeps the same offsets as `[name, ...args]`.
 */
export function transformCommandAst(
  raw: RawPipelineElement,
  redirections: ParsedPowerShellRedirection[] = transformRedirections(
    raw.redirections,
  ),
): ParsedCommandElement {
  const elements = ensureArray(raw.commandElements);
  const [nameElement, ...argElements] = elements;
  const name = stripModulePrefix(nameElement ? elementValue(nameElement) : "");

  return {
    name,
    nameType: classifyCommandName(name),
    elementType: "CommandAst",
    args: argElements.map(elementValue),
    text: raw.text,
    elementTypes: elements.map(mapCommandElementType),
    redirections,
  };
}

/**
 * A pipeline element that is not a `CommandAst` — a bare expression such as
 * `$x`, `(Get-Foo)` or `1 + 1`. It has no command name, and its inner command
 * (if any) is reached through the statement's `nestedCommands`.
 */
export function transformExpressionElement(
  raw: RawPipelineElement,
): ParsedCommandElement {
  const expressionType = raw.expressionType ?? raw.type;
  return {
    name: "",
    nameType: "unknown",
    elementType: mapElementType(raw.type),
    args: [],
    text: raw.text,
    elementTypes: [
      mapCommandElementType({ type: expressionType, text: raw.text }),
    ],
    redirections: transformRedirections(raw.redirections),
  };
}

function transformPipelineElement(
  raw: RawPipelineElement,
): ParsedCommandElement {
  return raw.type === "CommandAst"
    ? transformCommandAst(raw)
    : transformExpressionElement(raw);
}

/**
 * A redirection shows up twice for the same file: once on the command element
 * that carries it and once in the statement-wide search the script performs.
 * Keep one.
 */
function dedupeRedirections(
  list: ParsedPowerShellRedirection[],
): ParsedPowerShellRedirection[] {
  const seen = new Set<string>();
  const out: ParsedPowerShellRedirection[] = [];
  for (const redirection of list) {
    const key = `${redirection.operator}\u0000${redirection.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(redirection);
  }
  return out;
}

function transformSecurityPatterns(
  raw: PowerShellSecurityPatterns | undefined,
): PowerShellSecurityPatterns | undefined {
  if (!raw) return undefined;
  const patterns: PowerShellSecurityPatterns = {};
  if (raw.hasMemberInvocations) patterns.hasMemberInvocations = true;
  if (raw.hasSubExpressions) patterns.hasSubExpressions = true;
  if (raw.hasExpandableStrings) patterns.hasExpandableStrings = true;
  if (raw.hasScriptBlocks) patterns.hasScriptBlocks = true;
  return Object.keys(patterns).length > 0 ? patterns : undefined;
}

/**
 * One top-level statement.
 *
 * `commands` is filled for `PipelineAst` only. Everything else (`if`, `for`,
 * `try`, a function body, a `param()` default) contributes `nestedCommands`
 * instead, plus its own `securityPatterns`, so a caller can see *both* "which
 * commands are in here" and "was there a construct that hides what they do".
 */
export function transformStatement(raw: RawStatement): ParsedStatement {
  const elements = ensureArray(raw.elements);
  const commands =
    raw.type === "PipelineAst" ? elements.map(transformPipelineElement) : [];

  const nestedCommands = ensureArray(raw.nestedCommands).map((nested) =>
    transformCommandAst(nested),
  );

  const redirections = dedupeRedirections([
    ...transformRedirections(raw.redirections),
    ...commands.flatMap((command) => command.redirections ?? []),
    ...nestedCommands.flatMap((command) => command.redirections ?? []),
  ]);

  const statement: ParsedStatement = {
    statementType: mapStatementType(raw.type),
    commands,
    redirections,
    text: raw.text,
  };
  if (nestedCommands.length > 0) statement.nestedCommands = nestedCommands;
  const patterns = transformSecurityPatterns(raw.securityPatterns);
  if (patterns) statement.securityPatterns = patterns;
  return statement;
}

/**
 * Full wire output → `ParsedPowerShellCommand`.
 *
 * `originalCommand` comes from our own input rather than from the echoed copy,
 * so the two can never disagree.
 */
export function transformRawOutput(
  raw: RawParsedOutput,
  command: string,
): ParsedPowerShellCommand {
  const variables: ParsedVariable[] = ensureArray(raw.variables).map(
    (variable) => ({
      path: variable.path,
      isSplatted: variable.isSplatted === true,
    }),
  );

  return {
    valid: raw.valid === true,
    errors: ensureArray(raw.errors).map((error) => ({
      message: error.message,
      errorId: error.errorId,
    })),
    statements: ensureArray(raw.statements).map(transformStatement),
    variables,
    hasStopParsing: raw.hasStopParsing === true,
    originalCommand: command,
  };
}
