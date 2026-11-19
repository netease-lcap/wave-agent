/**
 * Types for the PowerShell command parser (`powershellStructure`).
 *
 * Two layers live here:
 *
 * 1. **The wire format** (`Raw*`) — the JSON the PowerShell parse script
 *    emits. It is .NET AST vocabulary (`CommandAst`, `FileRedirectionAst`, …),
 *    kept as close to the parser's own node names as possible so the script
 *    stays a thin reader and the mapping to our vocabulary happens once, in
 *    `transform.ts`.
 *
 * 2. **The parsed shape** (`Parsed*`) — what the permission layer reasons
 *    about. It deliberately mirrors the bash side's `BashStructure` vocabulary
 *    (flat statements → commands, explicit redirections, security flags)
 *    instead of exposing .NET AST nodes, so a reader who knows one shell can
 *    read the other.
 *
 * A shell command is *not* a security boundary by itself: `valid: false` means
 * "the command could not be understood", and every caller must treat that as
 * "ask", never as "nothing dangerous here".
 */

/** Pipeline element kinds (mirrors `CommandBaseAst` derivatives). */
export type PowerShellPipelineElementType =
  | "CommandAst"
  | "CommandExpressionAst"
  | "ParenExpressionAst";

/**
 * The kind of a single command element (an argument, an expression, …).
 *
 * `SubExpression` covers `$( )`, `@( )` and `( )`: all three evaluate an inner
 * pipeline, which is why they share one label — a caller that treats "there is
 * a subexpression" as "do not auto-allow" does not have to know which spelling
 * was used.
 */
export type PowerShellCommandElementType =
  | "ScriptBlock"
  | "SubExpression"
  | "ExpandableString"
  | "MemberInvocation"
  | "Variable"
  | "StringConstant"
  | "Parameter"
  | "Other";

/** Statement kinds. `ParamBlock` is synthetic — see `ParsedStatement`. */
export type PowerShellStatementType =
  | "PipelineAst"
  | "PipelineChainAst"
  | "AssignmentStatementAst"
  | "IfStatementAst"
  | "ForStatementAst"
  | "ForEachStatementAst"
  | "WhileStatementAst"
  | "DoWhileStatementAst"
  | "DoUntilStatementAst"
  | "SwitchStatementAst"
  | "TryStatementAst"
  | "TrapStatementAst"
  | "FunctionDefinitionAst"
  | "DataStatementAst"
  | "ParamBlockAst"
  | "UnknownStatementAst";

/** A redirection attached to a command or a statement. */
export interface ParsedPowerShellRedirection {
  /** `>` / `>>` / `2>` / `2>>` / `*>` / `*>>` / `2>&1` */
  operator: ">" | ">>" | "2>" | "2>>" | "*>" | "*>>" | "2>&1";
  /** Target file path (empty for the stream-merging operator). */
  target: string;
  /** true for `2>&1`-style merges, which have no target of their own. */
  isMerging: boolean;
}

/** One command invocation inside a pipeline element. */
export interface ParsedCommandElement {
  /** Command name as PowerShell will resolve it, module prefix stripped. */
  name: string;
  /**
   * How the name resolves: a cmdlet (`Verb-Noun`), an application (anything
   * with a path separator), or unknown (aliases, bare names, non-ASCII).
   */
  nameType: "cmdlet" | "application" | "unknown";
  elementType: PowerShellPipelineElementType;
  /** Argument words, including flags (`-Recurse`); the name is not repeated. */
  args: string[];
  /** Full text of this element, as written. */
  text: string;
  /**
   * Element kinds, aligned with `[name, ...args]`.
   *
   * The bound value of a colon parameter (`-Path:$env:TEMP`) is not broken out
   * separately: element `text` already contains it verbatim, and the variable
   * shows up in `ParsedPowerShellCommand.variables`.
   */
  elementTypes?: PowerShellCommandElementType[];
  redirections?: ParsedPowerShellRedirection[];
}

/** A top-level statement. */
export interface ParsedStatement {
  statementType: PowerShellStatementType;
  /**
   * Pipeline elements, present only for `PipelineAst` (a real pipeline is a
   * statement whose elements *are* the commands). Every other statement type
   * starts with an empty list even when it clearly contains commands — read
   * `nestedCommands` for those. An empty `commands` is therefore never
   * evidence that a statement is harmless.
   */
  commands: ParsedCommandElement[];
  redirections: ParsedPowerShellRedirection[];
  text: string;
  /**
   * Every command found anywhere inside this statement (control-flow bodies,
   * function bodies, `param()` defaults, …), in source order.
   *
   * This is the list `if (Test-Path x) { Remove-Item x }` cannot be judged
   * without: neither command is a pipeline element of the `IfStatementAst`.
   * `ParamBlockAst` is the same mechanism applied to the script-level param
   * block, which is a sibling of the named blocks rather than part of them.
   */
  nestedCommands?: ParsedCommandElement[];
  /** Security-relevant constructs found anywhere inside this statement. */
  securityPatterns?: PowerShellSecurityPatterns;
}

/**
 * Flags for constructs whose *presence* makes a statement impossible to judge
 * from its command names alone. Every one of them is a reason not to
 * auto-allow; none of them is a verdict by itself.
 */
export interface PowerShellSecurityPatterns {
  hasMemberInvocations?: boolean;
  hasSubExpressions?: boolean;
  hasExpandableStrings?: boolean;
  hasScriptBlocks?: boolean;
}

/** A variable reference. */
export interface ParsedVariable {
  /** e.g. `HOME`, `env:PATH`, `global:x`, `_` */
  path: string;
  /** true for splatting (`@args`), which expands to an unknown argument list. */
  isSplatted: boolean;
}

/** A syntax error reported by PowerShell's own parser. */
export interface PowerShellParseError {
  message: string;
  errorId: string;
}

/**
 * Why a parse did not produce a usable result.
 *
 * `NoInput` / `NoPowerShell` / `CommandTooLong` are decided before spawning;
 * the rest are process-level failures. All of them mean "ask".
 */
export type PowerShellParseErrorId =
  | "NoInput"
  | "NoPowerShell"
  | "CommandTooLong"
  | "PwshSpawnError"
  | "PwshTimeout"
  | "PwshError"
  | "EmptyOutput"
  | "InvalidJson";

/** The result of parsing one command. Never throws. */
export interface ParsedPowerShellCommand {
  /** true only when the script ran and PowerShell reported no syntax error. */
  valid: boolean;
  errors: PowerShellParseError[];
  /** Top-level statements. Empty is meaningful: see `valid`. */
  statements: ParsedStatement[];
  variables: ParsedVariable[];
  /** true when the command contains the stop-parsing token `--%`. */
  hasStopParsing: boolean;
  originalCommand: string;
}

// ---------------------------------------------------------------------------
// Wire format: what the parse script writes to stdout.
//
// Every field is optional-friendly because PowerShell 5.1's ConvertTo-Json
// unwraps single-element arrays (a one-element `statements` arrives as an
// object, not a list) — `transform.ts` normalises with `ensureArray`, so these
// types describe the *possible* shapes rather than the guaranteed one.
// ---------------------------------------------------------------------------

export interface RawCommandElement {
  /** .NET node name, e.g. `StringConstantExpressionAst`. */
  type: string;
  text: string;
  /** Resolved value for string literals (quotes removed, escapes applied). */
  value?: string;
  /** Inner expression node name for `CommandExpressionAst` elements. */
  expressionType?: string;
}

export interface RawRedirection {
  /** `FileRedirectionAst` or `MergingRedirectionAst`. */
  type: string;
  append?: boolean;
  /** `Output` / `Error` / `All` — the `FromStream` enum name. */
  fromStream?: string;
  locationText?: string;
}

export interface RawPipelineElement {
  type: string;
  text: string;
  commandElements?: RawCommandElement[];
  redirections?: RawRedirection[];
  expressionType?: string;
}

export interface RawStatement {
  type: string;
  text: string;
  /** Pipeline elements, present for `PipelineAst` only. */
  elements?: RawPipelineElement[];
  nestedCommands?: RawPipelineElement[];
  redirections?: RawRedirection[];
  securityPatterns?: PowerShellSecurityPatterns;
}

export interface RawParsedOutput {
  valid: boolean;
  errors: { message: string; errorId: string }[];
  statements: RawStatement[];
  variables: { path: string; isSplatted: boolean }[];
  hasStopParsing: boolean;
  originalCommand: string;
}
