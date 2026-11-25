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
 * A resolved path is not a usable one: Windows resolution only asks
 * `existsSync` (the `WAVE_GIT_BASH_PATH` override is validated, but not for
 * executability). Everything downstream spawns that path, so `accessSync` is
 * the honest test.
 *
 * Memoized for the lifetime of the process
 * ---------------------------------------
 * This answer is an environment fact, not a per-turn one: the inputs are the
 * platform, `WAVE_SHELL` / `WAVE_GIT_BASH_PATH` (OS env, fixed at process
 * start — see `shellToolGate.ts`) and what is installed on disk. Before the
 * memo, each *model request* paid for a fresh probe, because the system prompt
 * names the shell that runs the session (`getShellInfoLine`). On a machine
 * whose Git lives outside `C:\Program Files\Git`, `inferGitBashFromGit()`
 * walks cwd and every `PATH` directory — several `existsSync` per directory,
 * synchronous on the event loop, and a session with 20 tool rounds pays it 20
 * times. Caching the answer turns "one probe per request" into "one probe per
 * process".
 *
 * The cost of being wrong is small and one-directional: installing Git for
 * Windows while a session (or the daemon behind it) is already running is not
 * picked up until the process restarts. Shell discovery is fixed at process
 * start for the same reason `WAVE_GIT_BASH_PATH` is.
 */
let cachedAvailability: boolean | undefined;

export function isBashAvailable(): boolean {
  if (cachedAvailability === undefined) {
    cachedAvailability = probeBashAvailability();
  }
  return cachedAvailability;
}

function probeBashAvailability(): boolean {
  const shellPath = resolveShellPath();
  if (!shellPath) return false;
  try {
    accessSync(shellPath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Drop the memo so a test can exercise the probe itself. */
export function __resetBashAvailabilityCacheForTesting(): void {
  cachedAvailability = undefined;
}
