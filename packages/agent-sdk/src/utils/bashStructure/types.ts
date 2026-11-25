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
