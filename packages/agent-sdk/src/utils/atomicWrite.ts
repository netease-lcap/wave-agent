/**
 * Atomic file write utilities.
 *
 * Writes data to a temporary file first, then renames it to the target path.
 * This prevents readers from observing a partially-written (truncated) file,
 * which is critical for config files that may be read concurrently.
 *
 * Temp file naming: `${targetPath}.tmp.${process.pid}.${randomUUID()}`
 * — avoids collisions when multiple processes write the same file.
 */
import { writeFileSync, renameSync, unlinkSync, promises as fsp } from "fs";
import { randomUUID } from "crypto";

function tmpPathFor(targetPath: string): string {
  return `${targetPath}.tmp.${process.pid}.${randomUUID()}`;
}

/**
 * Atomically write `data` to `filePath` (async).
 *
 * Writes to a temp file then renames it into place. On any failure the temp
 * file is removed and the error is re-thrown so callers can handle it.
 */
export async function atomicWriteFile(
  filePath: string,
  data: string,
): Promise<void> {
  const tmpPath = tmpPathFor(filePath);
  try {
    await fsp.writeFile(tmpPath, data, "utf-8");
    await fsp.rename(tmpPath, filePath);
  } catch (error) {
    try {
      await fsp.unlink(tmpPath);
    } catch {
      // Ignore cleanup errors — the original error is more important
    }
    throw error;
  }
}

/**
 * Atomically write `data` to `filePath` (sync).
 *
 * Sync variant for callers that cannot await. Same temp-file-then-rename
 * strategy as {@link atomicWriteFile}.
 */
export function atomicWriteFileSync(filePath: string, data: string): void {
  const tmpPath = tmpPathFor(filePath);
  try {
    writeFileSync(tmpPath, data, "utf-8");
    renameSync(tmpPath, filePath);
  } catch (error) {
    try {
      unlinkSync(tmpPath);
    } catch {
      // Ignore cleanup errors — the original error is more important
    }
    throw error;
  }
}
