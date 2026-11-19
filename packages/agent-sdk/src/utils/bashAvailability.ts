/**
 * Whether this session can run bash at all.
 *
 * One question, several consumers: the Bash tool's `grep` / `find` shadows only
 * exist inside a bash, so anything that stands in for them has to know whether
 * that bash is there. Kept separate from `shellResolver.ts` so a caller can mock
 * the *answer* without mocking shell resolution itself.
 */

import { accessSync, constants } from "fs";
import { resolveShellPath } from "./shellResolver.js";

/**
 * true when a bash binary this session could actually spawn was found.
 *
 * A resolved path is not a usable one: the `WAVE_GIT_BASH_PATH` override is
 * returned verbatim, so a stale value answers "resolved" for a binary that is
 * not on disk. Everything downstream spawns that path, so existence is the
 * honest test.
 */
export function isBashAvailable(): boolean {
  const shellPath = resolveShellPath();
  if (!shellPath) return false;
  try {
    accessSync(shellPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}
