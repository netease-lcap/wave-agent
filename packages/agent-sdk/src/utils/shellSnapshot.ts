import { execFile } from "child_process";
import { logger } from "./globalLogger.js";

const SNAPSHOT_CREATION_TIMEOUT_MS = 10000;

// Marker line written before `echo $PATH` so profile banner output that leaks
// to stdout (motd, fortune, ...) is not mistaken for the PATH value.
const SNAPSHOT_PATH_MARKER = "WAVE_SHELL_SNAPSHOT";

// Cache: shellPath → settled snapshot promise. A snapshot is captured once per
// shell path and reused by every later command, so the user's profile is only
// sourced once per session instead of once per command. A failed capture is
// cached as `undefined` (settled) — callers then fall back to spawning a login
// shell per command (matching Claude Code's behavior).
const snapshotCache = new Map<string, Promise<string | undefined>>();
// Settled values: shellPath → captured PATH (or undefined on failure). Populated
// when the corresponding snapshot promise settles, so callers can check the
// snapshot synchronously without awaiting creation.
const snapshotValues = new Map<string, string | undefined>();

/**
 * Capture the login-shell PATH for `shellPath`: spawn the shell as a login
 * shell (`-l`, which sources the user's profile) once and cache the resulting
 * `echo $PATH` output. Subsequent commands reuse this cached PATH instead of
 * re-loading the profile.
 *
 * @returns the login-shell PATH string, or `undefined` if the snapshot could
 *   not be captured (timeout, missing shell, ...).
 */
export function getShellSnapshotPath(
  shellPath: string,
): Promise<string | undefined> {
  const cached = snapshotCache.get(shellPath);
  if (cached) {
    return cached;
  }

  const snapshotPromise = captureSnapshotPath(shellPath).then((pathValue) => {
    snapshotValues.set(shellPath, pathValue);
    return pathValue;
  });
  snapshotCache.set(shellPath, snapshotPromise);
  return snapshotPromise;
}

/**
 * Synchronously return the cached login-shell PATH for `shellPath`, without
 * triggering or awaiting snapshot creation. Returns `undefined` when the
 * snapshot has not been captured yet (or failed) — callers should then spawn a
 * login shell (`-l`) for this command and let the next command reuse the
 * snapshot once `getShellSnapshotPath` has been called.
 */
export function getCachedShellSnapshotPath(
  shellPath: string,
): string | undefined {
  return snapshotValues.get(shellPath);
}

/** Clear the snapshot cache (used by tests). */
export function resetShellSnapshotCache(): void {
  snapshotCache.clear();
  snapshotValues.clear();
}

/** Wrap a string for single-quoted shell usage (embedded quotes become `'"'"'`). */
export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

/**
 * Build the complete spawn args for running `command` in `shellPath`, using
 * the login-shell + snapshot strategy shared by all shell executors (Bash
 * tool, background tasks, bang commands):
 *   - snapshot captured: `-c` with the cached login-shell PATH re-exported
 *     (`export PATH=...; command`) — the user profile is not re-loaded;
 *   - otherwise: `-c -l` (login shell loads the profile) and the memoized
 *     snapshot capture is kicked off for later commands.
 */
export function buildShellSpawnArgs(
  shellPath: string,
  command: string,
): string[] {
  const snapshotPath = getCachedShellSnapshotPath(shellPath);
  if (snapshotPath !== undefined) {
    return ["-c", `export PATH=${shellSingleQuote(snapshotPath)}; ${command}`];
  }
  void getShellSnapshotPath(shellPath);
  return ["-c", "-l", command];
}

function captureSnapshotPath(shellPath: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    try {
      execFile(
        shellPath,
        ["-c", "-l", `echo ${SNAPSHOT_PATH_MARKER}; echo "$PATH"`],
        {
          timeout: SNAPSHOT_CREATION_TIMEOUT_MS,
          maxBuffer: 1024 * 1024,
          encoding: "utf8",
          env: {
            ...process.env,
            SHELL: shellPath,
          },
        },
        (error, stdout) => {
          if (error) {
            logger.debug(
              `[ShellSnapshot] creation failed for ${shellPath}: ${error.message}`,
            );
            resolve(undefined);
            return;
          }
          // Take everything after the marker line; profile output before it is
          // ignored.
          const markerIndex = stdout.lastIndexOf(SNAPSHOT_PATH_MARKER);
          const pathValue = (
            markerIndex >= 0
              ? stdout.slice(markerIndex + SNAPSHOT_PATH_MARKER.length)
              : stdout
          ).trim();
          if (!pathValue) {
            logger.debug(
              `[ShellSnapshot] empty PATH captured for ${shellPath}`,
            );
            resolve(undefined);
            return;
          }
          logger.debug(`[ShellSnapshot] created for ${shellPath}`);
          resolve(pathValue);
        },
      );
    } catch (error) {
      // execFile throws synchronously on invalid arguments — never reject, so
      // the fire-and-forget call site cannot produce an unhandled rejection.
      logger.debug(
        `[ShellSnapshot] creation failed for ${shellPath}: ${error instanceof Error ? error.message : String(error)}`,
      );
      resolve(undefined);
    }
  });
}
