/**
 * Structure-aware bash parsing: expand compound commands and command
 * substitutions into flat leaf commands for permission classification.
 *
 * Public entry point:
 *   parseBashStructure(command) → BashStructureResult
 *
 *   { status: "ok", leaves: BashLeaf[] }        — every executable command,
 *                                                 ready for per-leaf checks
 *   { status: "unsupported", reason }           — construct could not be
 *                                                 statically expanded; caller
 *                                                 must ask (fail closed)
 */

import { BashSemantics } from "./bashSemantics.js";
import type { BashStructureResult } from "./types.js";

/**
 * Parse a bash command string into a flat list of executable leaf commands,
 * expanding shell control structure and command substitutions.
 *
 * The parser is conservative (fail-closed): any construct that cannot be
 * statically reduced to leaves (heredocs, arithmetic/brace/process
 * substitution, eval/trap, parse failures, parser limits) returns
 * `unsupported` and the permission layer must ask instead of auto-allowing.
 */
export function parseBashStructure(command: string): BashStructureResult {
  return BashSemantics.analyze(command);
}

export type {
  BashStructureResult,
  BashStructureOk,
  BashStructureUnsupported,
  BashLeaf,
  BashLeafReason,
  BashUnsupportedReason,
} from "./types.js";
export { SAFE_ENV_VARS, SAFE_SHELL_BUILTINS } from "./types.js";
