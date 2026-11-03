/**
 * Platform-aware termination of a child process **and everyone it spawned**.
 *
 * Both callers (`bashTool` abort/timeout and `backgroundTaskManager` stop) spawn
 * their shell with `detached: true`, i.e. as the leader of its own process
 * group. On POSIX that makes `process.kill(-pid, signal)` reach the shell and
 * every descendant that stayed in the group, which is why the negative pid was
 * used everywhere.
 *
 * Windows has no process groups: `process.kill(-pid, ...)` fails with ESRCH for
 * every pid (issue #2742), the old `catch` treated that as "already exited" and
 * logged nothing, so `npm → node → vitest worker ×N` kept running as orphans
 * after the shell was gone. `taskkill /PID <pid> /T /F` walks the parent/child
 * relation instead and is the Windows equivalent of "kill the whole tree".
 */

import { spawn } from "child_process";
import { WindowsStreamDecoder } from "./encoding.js";
import { logger } from "./globalLogger.js";

export type KillProcessTreeResult =
  /** The tree (POSIX: the process group) received the termination. */
  | "killed"
  /** The target was already gone — not an error, but worth a debug line. */
  | "not-found"
  /** The kill itself failed (permissions, missing taskkill, timeout...). */
  | "failed";

/** `taskkill` exits with 128 when the pid cannot be found. */
const TASKKILL_PID_NOT_FOUND = 128;

/**
 * Terminate the process tree rooted at `pid`.
 *
 * - POSIX: `process.kill(-pid, signal)` — unchanged behavior.
 * - Windows: `taskkill /PID <pid> /T /F`.
 *
 * Never throws and never rejects: the outcome is reported both as the return
 * value and through the logger, so a failed kill cannot disappear silently the
 * way the old `ESRCH` handling did.
 *
 * @param pid - pid of the process group leader (a child spawned with
 *   `detached: true`)
 * @param signal - POSIX signal. On Windows the two-phase
 *   `SIGTERM` → `SIGKILL` retry collapses into the same force kill, because a
 *   console process has no window message loop: `taskkill` without `/F` only
 *   posts `WM_CLOSE`, which `bash.exe` ignores, so it would just delay the real
 *   kill by the caller's grace window.
 */
export async function killProcessTree(
  pid: number,
  signal: NodeJS.Signals = "SIGTERM",
): Promise<KillProcessTreeResult> {
  // `-0 === 0` signals the *caller's own* process group — never let a missing
  // pid reach either implementation.
  if (!Number.isInteger(pid) || pid <= 0) {
    logger.debug(`[killProcessTree] ignoring invalid pid ${pid}`);
    return "not-found";
  }

  return process.platform === "win32"
    ? killTreeOnWindows(pid, signal)
    : killTreeOnPosix(pid, signal);
}

function killTreeOnPosix(
  pid: number,
  signal: NodeJS.Signals,
): KillProcessTreeResult {
  try {
    process.kill(-pid, signal);
    logger.debug(`[killProcessTree] sent ${signal} to process group ${pid}`);
    return "killed";
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") {
      // The group is gone. Keep it at debug level so a *systematic* ESRCH
      // (e.g. a platform where group kills never work) stays diagnosable.
      logger.debug(
        `[killProcessTree] process group ${pid} was already gone when sending ${signal} (ESRCH)`,
      );
      return "not-found";
    }
    logger.error(
      `[killProcessTree] failed to send ${signal} to process group ${pid}:`,
      error,
    );
    return "failed";
  }
}

function killTreeOnWindows(
  pid: number,
  signal: NodeJS.Signals,
): Promise<KillProcessTreeResult> {
  return new Promise<KillProcessTreeResult>((resolve) => {
    // Spawning a taskkill for a pid we already know is dead is pure overhead
    // (and the caller retries once, so this path is hit on every stop).
    if (!isProcessAlive(pid)) {
      logger.debug(
        `[killProcessTree] pid ${pid} was already gone when sending ${signal} (taskkill skipped)`,
      );
      resolve("not-found");
      return;
    }

    const args = ["/PID", String(pid), "/T", "/F"];
    // taskkill writes the system OEM code page (GBK on zh-CN), see encoding.ts.
    const stdoutDecoder = new WindowsStreamDecoder();
    const stderrDecoder = new WindowsStreamDecoder();
    let output = "";
    let settled = false;
    const finish = (result: KillProcessTreeResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let taskkill;
    try {
      taskkill = spawn("taskkill", args, {
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error: unknown) {
      logger.error(
        `[killProcessTree] failed to spawn taskkill ${args.join(" ")}:`,
        error,
      );
      finish("failed");
      return;
    }

    taskkill.stdout?.on("data", (data: Buffer) => {
      output += stdoutDecoder.push(data);
    });
    taskkill.stderr?.on("data", (data: Buffer) => {
      output += stderrDecoder.push(data);
    });

    taskkill.on("error", (error: Error) => {
      logger.error(
        `[killProcessTree] taskkill ${args.join(" ")} could not run:`,
        error,
      );
      finish("failed");
    });

    taskkill.on("close", (code: number | null) => {
      const detail = output.trim();
      if (code === 0) {
        logger.debug(
          `[killProcessTree] taskkill /T /F terminated the process tree of pid ${pid} (${signal})`,
        );
        finish("killed");
      } else if (code === TASKKILL_PID_NOT_FOUND) {
        // "ERROR: 找不到进程" — the tree died between the probe and the call.
        logger.debug(
          `[killProcessTree] pid ${pid} was already gone when taskkill ran (${signal}): ${detail}`,
        );
        finish("not-found");
      } else {
        logger.error(
          `[killProcessTree] taskkill /T /F failed for pid ${pid} (exit code ${code}, ${signal}): ${detail}`,
        );
        finish("failed");
      }
    });
  });
}

/**
 * Windows-only existence probe (`process.kill(pid, 0)`).
 *
 * ESRCH means gone; EPERM means "exists but not ours" — still worth a taskkill
 * attempt, which will then report the permission problem.
 */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error: unknown) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
