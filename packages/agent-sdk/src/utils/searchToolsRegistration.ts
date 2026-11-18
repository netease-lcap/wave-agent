/**
 * Whether `Grep` and `Glob` belong in this session's tool set.
 *
 * They are not registered by default because search runs through the Bash
 * tool's `grep` / `find` shadows (core/fs-tools.md): the shadows are the
 * substitute, and paying for a separate tool round-trip only makes sense when
 * one is needed.
 *
 * Two things put the tools back:
 *
 * - the caller names one in `--tools` — an explicit request for the structured
 *   form (`Grep`'s match counts, `Glob`'s `**` patterns);
 * - the session has no bash. The shadows live inside a bash, so without one
 *   there is nothing to substitute: withdrawing the tools would leave the model
 *   with no way to search a file tree at all.
 *
 * The criterion is the same on every platform — "is there a usable bash" — not
 * a per-platform branch: Windows answers it with Git Bash discovery, macOS and
 * Linux almost always answer yes.
 */

import { GLOB_TOOL_NAME, GREP_TOOL_NAME } from "../constants/tools.js";
import { isBashAvailable } from "./bashAvailability.js";

/** Whether the list names `Grep` or `Glob`, case-insensitively. */
function namesSearchTool(toolNames: readonly string[] | undefined): boolean {
  const wanted = [GLOB_TOOL_NAME.toLowerCase(), GREP_TOOL_NAME.toLowerCase()];
  return (toolNames ?? []).some((name) => wanted.includes(name.toLowerCase()));
}

export function shouldRegisterSearchTools(
  toolNames: readonly string[] | undefined,
): boolean {
  if (namesSearchTool(toolNames)) return true;
  return !isBashAvailable();
}
