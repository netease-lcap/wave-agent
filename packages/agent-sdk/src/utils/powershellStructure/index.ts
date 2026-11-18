/**
 * Structure-aware PowerShell parsing: ask the real PowerShell parser what a
 * command means, then hand the permission layer a shell-neutral description.
 *
 * Public entry point:
 *   parsePowerShellCommand(command) → ParsedPowerShellCommand
 *
 *   { valid: true, statements }   — the AST, flattened into statements and
 *                                   commands ready for per-command checks
 *   { valid: false, errors }      — could not be parsed; the caller must ask
 *                                   (fail closed), exactly like bash's
 *                                   `status: "unsupported"`
 *
 * Nothing here decides whether a command is safe — see `permissions.ts` (P3c).
 * `valid: true` means "the parser understood the command", not "the command is
 * harmless"; `statements: []` on a valid parse is also not evidence of
 * harmlessness (`using module` and `#Requires` produce no statements).
 */

import { parsePowerShellCommand } from "./psParser.js";

export { parsePowerShellCommand };
export {
  DEFAULT_PARSE_TIMEOUT_MS,
  MAX_PARSE_COMMAND_BYTES,
  PARSE_CACHE_SIZE,
  getPowerShellParserCacheSize,
  resetPowerShellParserCache,
} from "./psParser.js";
export {
  FIXED_ARGV_OVERHEAD,
  PARSE_SCRIPT_BODY,
  WINDOWS_ARGV_CAP,
  buildParseScript,
  encodeCommandForScript,
  toUtf16LeBase64,
} from "./parseScript.js";
export {
  classifyCommandName,
  ensureArray,
  mapElementType,
  mapStatementType,
  stripModulePrefix,
  transformCommandAst,
  transformRawOutput,
  transformRedirection,
  transformRedirections,
  transformStatement,
} from "./transform.js";
export type {
  ParsedCommandElement,
  ParsedPowerShellCommand,
  ParsedPowerShellRedirection,
  ParsedStatement,
  ParsedVariable,
  PowerShellCommandElementType,
  PowerShellParseError,
  PowerShellParseErrorId,
  PowerShellPipelineElementType,
  PowerShellSecurityPatterns,
  PowerShellStatementType,
  RawParsedOutput,
} from "./types.js";
