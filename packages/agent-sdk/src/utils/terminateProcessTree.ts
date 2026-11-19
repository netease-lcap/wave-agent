/**
 * "Abort this shell and everything it started", in one place.
 *
 * `Bash` and `PowerShell` both spawn a shell that may be the parent of a whole
 * pipeline, so both have to answer the same question when the user aborts or
 * the timeout fires. The escalation is not shell-specific: on Windows the
 * polite and the forced phase are the same `taskkill /T /F`, and the retry
 * then reports "not-found".
 *
 * Kept as its own module rather than inside `killProcessTree.ts` because that
 * module's `killProcessTree` is the thing being mocked in tests: a function
 * living beside it would call the real implementation even when the export is
 * mocked (ESM binds internal calls to the module-local definition).
 */

import type { ChildProcess } from "child_process";
import { killProcessTree } from "./killProcessTree.js";
import { logger } from "./globalLogger.js";

/** How long the polite signal gets before the forced one follows. */
const FORCE_KILL_DELAY_MS = 1000;

/**
 * Take [child] and its descendants down: `SIGTERM`, then `SIGKILL` after a
 * one-second grace period, each phase falling back to killing the direct child
 * when the tree kill could not signal anything at all.
 *
 * Never throws and returns nothing: the caller has already decided the process
 * must die and has no alternative but to try.
 */
export function terminateChildProcessTree(child: ChildProcess): void {
  const pid = child.pid;
  if (!pid) {
    // No pid means the child never started: there is no tree to walk, and
    // `killProcessTree` would ignore the invalid id.
    try {
      child.kill("SIGTERM");
    } catch (directKillError) {
      logger.error("Failed to kill child process:", directKillError);
    }
    return;
  }

  void killProcessTree(pid, "SIGTERM").then((outcome) => {
    if (outcome !== "failed") return;
    // The tree kill could not signal the group at all — fall back to taking the
    // direct child down, as the pre-#2742 code path did.
    try {
      logger.error(
        `Failed to terminate the process tree of pid ${pid}; killing the shell only`,
      );
      child.kill("SIGTERM");
    } catch (directKillError) {
      logger.error("Failed to kill child process:", directKillError);
    }
  });

  setTimeout(() => {
    if (child.killed) return;
    void killProcessTree(pid, "SIGKILL").then((outcome) => {
      if (outcome !== "failed" || child.killed) return;
      try {
        child.kill("SIGKILL");
      } catch (forceKillError) {
        logger.error("Failed to force kill child process:", forceKillError);
      }
    });
  }, FORCE_KILL_DELAY_MS);
}
