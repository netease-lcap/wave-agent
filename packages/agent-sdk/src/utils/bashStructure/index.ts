/**
 * Structure-aware bash parsing: expand compound commands and command
 * substitutions into flat leaf commands for permission classification.
 *
 * Public entry points:
 *   parseBashStructureDetailed(command) → BashStructureDetail
 *
 *   { commandText, leaves, dataRegions, heredocRegions, errors, aborted,
 *     maxNesting }
 *     — the full picture, for callers that judge text themselves: which
 *       regions were data (heredoc bodies, comments) and removed, which input
 *       was unreadable, whether a scale budget stopped the walk.
 *
 *   parseBashStructure(command) → BashStructureResult
 *
 *   { status: "ok", leaves: BashLeaf[] }        — every executable command,
 *                                                 ready for per-leaf checks
 *   { status: "unsupported", reason }           — construct could not be
 *                                                 statically expanded; caller
 *                                                 must ask (fail closed)
 */

import { BashSemantics } from "./bashSemantics.js";
import type { BashStructureDetail, BashStructureResult } from "./types.js";

/**
 * Parse a bash command string, keeping the data/command split.
 *
 * Heredoc bodies, here-strings and comments are data: they are removed before
 * the command stream is parsed and never produce leaves. Whatever cannot be
 * read as a command lands in `errors` instead of silently ending the walk.
 */
export function parseBashStructureDetailed(
  command: string,
): BashStructureDetail {
  return BashSemantics.analyzeDetailed(command);
}

/**
 * Parse a bash command string into a flat list of executable leaf commands,
 * expanding shell control structure and command substitutions.
 *
 * The parser is conservative (fail-closed): any construct that cannot be
 * statically reduced to leaves (heredocs, arithmetic/brace/process
 * substitution, eval/trap, parse failures, parser limits) returns
 * `unsupported` and the permission layer must ask instead of auto-allowing.
 *
 * This is the projection of {@link parseBashStructureDetailed}: as soon as data
 * regions or unreadable input are involved, it defers to the pre-existing
 * whole-string analysis so auto-allow decisions stay exactly as they were.
 */
export function parseBashStructure(command: string): BashStructureResult {
  const detail = parseBashStructureDetailed(command);
  if (detail.heredocRegions > 0 || detail.errors.length > 0 || detail.aborted) {
    return BashSemantics.analyze(command);
  }
  return { status: "ok", leaves: detail.leaves };
}

export type {
  BashStructureResult,
  BashStructureOk,
  BashStructureUnsupported,
  BashStructureDetail,
  BashAssignment,
  BashParseStats,
  BashLeaf,
  BashLeafReason,
  BashUnsupportedReason,
} from "./types.js";
export {
  MAX_COMMAND_LENGTH,
  SAFE_ENV_VARS,
  SAFE_SHELL_BUILTINS,
} from "./types.js";
