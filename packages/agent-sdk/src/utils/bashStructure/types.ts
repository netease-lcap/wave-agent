/**
 * Shared types for the structure-aware bash parser (bashStructure).
 *
 * The parser expands compound commands (for/while/until/if/case/select/
 * function) and command substitutions ($( ) / backticks) into a flat list of
 * "leaf" simple commands. Each leaf is a single executable command that the
 * permission layer can classify with the same rules used for a plain command.
 *
 * Any construct that cannot be statically reconstructed (heredoc bodies,
 * arithmetic expansion, brace expansion, process substitution, eval/trap,
 * unterminated quotes, parser limits) fails closed: the whole parse returns
 * `unsupported` and the permission layer must ask instead of auto-allowing.
 *
 * Mirrors Claude Code's ParseForSecurityResult shape:
 *   simple → leaves[], unsupported → ask (fail-closed).
 */
import { READ_ONLY_COMMANDS } from "../bashParser.js";

/** A structural reason why an individual leaf may not be auto-allowed. */
export type BashLeafReason =
  /** An unquoted variable (loop var, read capture, substitution capture,
   *  positional param, or any var without a literal value) appears in a bare
   *  argument position. Its value is unknown: word-splitting / globbing may
   *  inject extra arguments. Quoted occurrences ("$f") are fine. */
  | "bare-variable"
  /** The leaf's raw text still contains a $( ) / backtick command
   *  substitution (used when the substitution is itself one of the leaf's
   *  arguments, so the leaf text cannot be validated as a plain command). */
  | "command-substitution";

/** Why a whole command cannot be statically expanded (must ask). */
export type BashUnsupportedReason =
  | "process-substitution" // <(...) / >(...) — semantics not statically reducible
  | "arithmetic-expansion" // $((...)) — dynamic
  | "brace-expansion" // {a,b} — dynamic
  | "heredoc" // << / <<- / <<< — body unmodelled (fail-closed)
  | "eval" // eval/trap/shopt etc — dynamic execution
  | "syntax" // unterminated quote/substitution, unbalanced ( ) etc
  | "too-complex" // parser limits (depth / length) exceeded
  | "unknown-command"; // reserved-word position we do not model (function/select/brace-group/until details not implemented)

/** A single expanded executable command. */
export interface BashLeaf {
  /** Expanded command words. Quotes are preserved as written so the raw text
   *  can still be run through the legacy text-based checkers. Variables are
   *  kept literally ($f), not resolved. */
  argv: string[];
  /** The command name as written (argv[0] after any leading assignments are
   *  stripped), or "" if the leaf is an assignment-only statement. */
  command: string;
  /** Reconstructed command text (words joined by single spaces). */
  text: string;
  /** Id of the subshell this leaf runs in; absent for the top-level shell.
   *  Two commands with different ids are never in the same execution.
   *  See {@link BashAssignment.subshell}. */
  subshell?: number;
  /** true when this leaf must never be auto-allowed for structural reasons
   *  (bare unknown variables, …); the permission layer must ask. */
  unsafe: boolean;
  /** Structural reasons (empty when unsafe is false). */
  reasons: BashLeafReason[];
}

/** Successful parse: a flat list of leaves to classify. */
export interface BashStructureOk {
  status: "ok";
  leaves: BashLeaf[];
}

/** Failed parse: the command cannot be statically expanded, ask. */
export interface BashStructureUnsupported {
  status: "unsupported";
  reason: BashUnsupportedReason;
  /** Optional human-readable detail (e.g. which construct was hit). */
  message?: string;
}

export type BashStructureResult = BashStructureOk | BashStructureUnsupported;

/**
 * Longest command this parser reads (Claude Code's own limit, `parser.ts`).
 * Past it the parse is *aborted* rather than failed: the length of a real
 * command comes from its data (a long commit message), so treating it as
 * unreadable would stop ordinary commands for no gain. See
 * {@link BashStructureDetail.aborted}.
 */
export const MAX_COMMAND_LENGTH = 10_000;

/**
 * The same parse as {@link BashStructureResult}, keeping what the fail-closed
 * projection throws away: which parts of the line were *data* (a heredoc body,
 * a here-string, a comment) and which parts could not be read at all.
 *
 * `parseBashStructure` answers one question — "may this be auto-allowed?" — and
 * has to ask about anything it cannot reduce. A caller asking a different
 * question ("does this delete something it must not") needs the split: a
 * heredoc body full of prose is data and must not make the command unreadable,
 * while an unterminated quote must.
 */
export interface BashStructureDetail {
  /** The command line with its data regions removed (see {@link dataRegions}). */
  commandText: string;
  /** Expanded executable commands, as in {@link BashStructureOk}. */
  leaves: BashLeaf[];
  /** Regions recognised as data and removed from the command stream. */
  dataRegions: number;
  /** How many of those were heredoc bodies or here-string words. */
  heredocRegions: number;
  /** Constructs the parse could not read as commands: syntax errors and
   *  dynamic expansions (`eval`, `$((…))`, `{a,b}`, process substitution).
   *  Empty when the whole command was reduced. */
  errors: BashUnsupportedReason[];
  /** A scale budget stopped the parse (length, nesting depth, depth budget). */
  aborted: boolean;
  /** Deepest command substitution nesting the parse descended into. */
  maxNesting: number;
  /** Every write to a shell variable the line performs, in program order. */
  assignments: BashAssignment[];
  /** Leaf ranges that run in a subshell (an opening paren to its closing one):
   *  a 'cd' or an assignment inside one of them is gone once the subshell ends.
   *  Sorted by 'start'; nested ranges appear nested in the list too. */
  subshells: BashSubshellRange[];
  /** Bodies of the heredocs established as data, in source order, delimiter
   *  lines excluded. A body handed to a shell ('bash <<EOF') is that shell's
   *  script; one handed to 'git commit -F -' is a commit message. */
  heredocBodies: string[];
}

/** A leaf range running in a subshell. */
export interface BashSubshellRange {
  /** Index of the first leaf inside the subshell. */
  start: number;
  /** One past the last leaf inside it. */
  end: number;
}

/**
 * One write to a shell variable, as the walk met it.
 *
 * Exposed because "may this be auto-allowed?" never needs it, while "does this
 * delete something it must not?" does: the target of `rm -rf "$D"` cannot be
 * placed without knowing what this same line did to `D`. The parser answers
 * only what it can answer exactly — the value is filled in solely when the
 * right-hand side is spelled out literally and the write has already happened
 * by the time the leaf runs.
 */
export interface BashAssignment {
  /** Leaf index this write is visible at: a leaf at `i` sees writes whose
   *  `visibleFrom` is `<= i`. Writes are visited in program order, and a write
   *  that has not been reached yet cannot have affected an earlier command. */
  visibleFrom: number;
  /** The variable name as written (`D` in `D=..`). */
  name: string;
  /** The literal value, or `null` when the right-hand side is anything but
   *  literal text (`$(…)`, backticks, `$OTHER`). */
  value: string | null;
  /** The right-hand side as written, for the confirmation card. */
  rhs: string;
  /** Set when the value does not come from an assignment on this line at all. */
  source?: "read" | "for";
  /** Id of the subshell the write happens in; absent for the top-level shell.
   *  A subshell's writes are gone when it ends, so only commands in that same
   *  subshell may read them: `(V=x); (rm -rf /$V)` has no `V` in its second
   *  half, and reading the first one there would place a path the shell never
   *  forms. */
  subshell?: number;
}

/** Bookkeeping the parser and the semantic layer fill in while they walk. */
export interface BashParseStats {
  /** Deepest `$( )` / backtick expansion the walk descended into. */
  maxNesting: number;
  /** A scale budget stopped the walk. */
  aborted: boolean;
  /** Next id to hand a subshell; shared with the nested walks so ids stay
   *  unique across the whole line. */
  nextSubshellId?: number;
}

/** A simple command's words, already split out from the token stream. */
export interface SimpleWord {
  /** The word as written in the source (quotes kept). */
  raw: string;
}

/**
 * Variables we consider safe to reference unquoted: their values are either
 * fixed or read-only environment information that cannot turn into attacker
 * controlled word-splitting in the contexts we auto-allow (mirrors CC's
 * safe-env-vars handling). Reading `$PATH` unquoted in `echo $PATH` is fine.
 */
export const SAFE_ENV_VARS: ReadonlySet<string> = new Set([
  "HOME",
  "PATH",
  "PWD",
  "USER",
  "LOGNAME",
  "SHELL",
  "TERM",
  "LANG",
  "LC_ALL",
]);

/**
 * Shell builtins that only read stdin into shell variables / print, and do not
 * touch the filesystem. Auto-allowed like READ_ONLY_COMMANDS when they carry no
 * write redirections (spec: `while read -r line; do …` must auto-allow).
 */
export const SAFE_SHELL_BUILTINS: ReadonlySet<string> = new Set([
  "read",
  "echo", // echo already in READ_ONLY_COMMANDS; kept here for completeness
]);

export const ALL_SAFE_COMMANDS: ReadonlySet<string> = new Set([
  ...READ_ONLY_COMMANDS,
  ...SAFE_SHELL_BUILTINS,
]);
