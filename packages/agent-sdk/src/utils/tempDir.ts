/**
 * Shared temp-directory resolution, writability probing and disk-pressure
 * diagnostics for everything the SDK drops on disk and expects to delete later:
 * the bash tool's CWD marker, background-task logs, subagent logs, persisted
 * tool results and MCP images.
 *
 * Why a dedicated variable instead of plain `TMPDIR`: redirecting `TMPDIR`
 * also redirects every child process, which is not what someone means when
 * they only want the agent's own scratch files to live on another volume
 * (Claude Code solves it the same way with `CLAUDE_CODE_TMPDIR`). Falling back
 * to `os.tmpdir()` keeps `TMPDIR` working for anyone who already relies on it.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/** Override for {@link resolveTempDir}; exported so hosts/tests can name it. */
export const TEMP_DIR_ENV = "WAVE_TMPDIR";

export function resolveTempDir(): string {
  const override = process.env[TEMP_DIR_ENV]?.trim();
  return override || os.tmpdir();
}

export interface TempDirProbeResult {
  writable: boolean;
  /** errno code when the write was refused (EDQUOT / ENOSPC / EACCES / EROFS…). */
  code?: string;
}

// A successful probe is remembered for the process lifetime (the directory does
// not become unwritable by itself); failures are never cached so that freeing
// space recovers without a restart.
const writableDirs = new Set<string>();

function errnoCode(error: unknown): string | undefined {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as NodeJS.ErrnoException).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

/**
 * Check that `dir` can actually be written to right now.
 *
 * `mkdir` success alone is not enough on this class of failure: a directory can
 * exist while the volume holding it refuses new blocks (quota used up, disk
 * full), which is exactly why the probe writes a real byte and deletes it.
 */
export function probeTempDir(
  dir: string = resolveTempDir(),
): TempDirProbeResult {
  if (writableDirs.has(dir)) return { writable: true };

  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    return { writable: false, code: errnoCode(error) };
  }

  const probePath = path.join(
    dir,
    `wave-tmp-probe_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.tmp`,
  );
  try {
    const fd = fs.openSync(probePath, "wx");
    try {
      fs.writeSync(fd, "x");
    } finally {
      fs.closeSync(fd);
    }
  } catch (error) {
    try {
      fs.unlinkSync(probePath);
    } catch {
      // best effort — the file may not exist
    }
    return { writable: false, code: errnoCode(error) };
  }

  try {
    fs.unlinkSync(probePath);
  } catch {
    // best effort
  }
  writableDirs.add(dir);
  return { writable: true };
}

/** Test seam: forget every cached "this directory is writable" answer. */
export function resetTempDirProbeCache(): void {
  writableDirs.clear();
}

export interface DiskPressure {
  freeBytes?: number;
  freeInodes?: number;
}

export function readDiskPressure(dir: string): DiskPressure {
  try {
    const stats = fs.statfsSync(dir);
    return {
      freeBytes: stats.bavail * stats.bsize,
      freeInodes: stats.ffree,
    };
  } catch {
    return {};
  }
}

const LOW_FREE_BYTES = 10 * 1024 * 1024;
const LOW_FREE_INODES = 1000;

/** Human-readable meaning of an errno that blocks temp writes. */
function explainCode(code: string): string {
  switch (code) {
    case "EDQUOT":
      return "the user's disk quota on that volume is used up";
    case "ENOSPC":
      return "the volume is full";
    case "EACCES":
    case "EPERM":
      return "permission denied, most likely because the directory is owned by another user";
    case "EROFS":
      return "the volume is mounted read-only";
    default:
      return "the filesystem refused the write";
  }
}

/**
 * Text for the model when the temp directory is unusable: it says what broke,
 * what is therefore degraded, and the two ways out (free the volume, or point
 * {@link TEMP_DIR_ENV} at another one).
 */
export function describeTempDirFailure(
  dir: string,
  code: string | undefined,
): string {
  const cause = code ? ` (${code}: ${explainCode(code)})` : "";
  return (
    `The temporary directory ${dir} is not writable${cause}, so shell working-directory ` +
    `tracking is disabled and anything the agent would persist there (long tool output, ` +
    `background-task logs) will be lost. Either free space on the volume holding ${dir}, ` +
    `or restart with ${TEMP_DIR_ENV} pointing at a directory on another volume ` +
    `(e.g. ${TEMP_DIR_ENV}=/var/tmp/wave).`
  );
}

/**
 * Text for the model when a command failed while the temp volume looks nearly
 * out of space or inodes — the "why did my command fail" case that otherwise
 * reads like an unrelated shell error.
 */
export function describeDiskPressure(
  dir: string,
  pressure: DiskPressure,
): string | undefined {
  const { freeBytes, freeInodes } = pressure;
  if (freeBytes !== undefined && freeBytes < LOW_FREE_BYTES) {
    return (
      `Disk nearly full: ${dir} (the agent's temporary directory) has ` +
      `${Math.max(0, Math.round(freeBytes / (1024 * 1024)))} MB free, so this command — ` +
      `or another process on the same volume — may have failed for that reason.`
    );
  }
  if (freeInodes !== undefined && freeInodes < LOW_FREE_INODES) {
    return (
      `Nearly out of inodes: ${dir} (the agent's temporary directory) has ` +
      `${freeInodes} free, so creating files there may fail and this command may have ` +
      `failed for that reason.`
    );
  }
  return undefined;
}
