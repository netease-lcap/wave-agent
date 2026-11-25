/**
 * Whether `Grep` and `Glob` are the session's *dedicated* search tools — declared
 * flat with their full schema — or folded into the Bash tool's `grep` / `find`
 * shadows (core/fs-tools.md).
 *
 * The registry holds both either way; what this decides is which entrance they
 * take. Folded, they are reachable only from a REPL script (core/repl-tool.md
 * 「搜索折叠态下的 Grep / Glob 只在脚本里可达」), which is where Claude Code 2.1.331
 * draws the line too: its fold refuses the flat call, never the pool.
 *
 * Two things unfold them:
 *
 * - the caller names one in `--tools` — an explicit request for the structured
 *   form (`Grep`'s match counts, `Glob`'s `**` patterns);
 * - the session has no bash. The shadows live inside a bash, so without one
 *   there is nothing to substitute: a fold would leave the model with no way to
 *   search a file tree at all.
 *
 * The criterion is the same on every platform — "is there a usable bash" — not
 * a per-platform branch: Windows answers it with Git Bash discovery, macOS and
 * Linux almost always answer yes.
 */

import { GLOB_TOOL_NAME, GREP_TOOL_NAME } from "../constants/tools.js";
import { isBashAvailable } from "./bashAvailability.js";

/** The two tools the fold is about. */
export const SEARCH_TOOL_NAMES: readonly string[] = [
  GLOB_TOOL_NAME,
  GREP_TOOL_NAME,
];

/** Whether the list names `Grep` or `Glob`, case-insensitively. */
function namesSearchTool(toolNames: readonly string[] | undefined): boolean {
  const wanted = SEARCH_TOOL_NAMES.map((name) => name.toLowerCase());
  return (toolNames ?? []).some((name) => wanted.includes(name.toLowerCase()));
}

export function hasDedicatedSearchTools(
  toolNames: readonly string[] | undefined,
): boolean {
  if (namesSearchTool(toolNames)) return true;
  return !isBashAvailable();
}
