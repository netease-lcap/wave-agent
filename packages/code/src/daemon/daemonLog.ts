/**
 * The daemon's stderr log — the only channel back from a process whose stdio the
 * client deliberately does not hold open.
 *
 * `wave daemon <subcommand>` launches the daemon detached and unref'd; the daemon
 * outlives the client by design (it is resident). Keeping a pipe on its stderr
 * would therefore be wrong: once the client exits, the daemon's next write hits
 * EPIPE and can take a long-lived process down. A log file has no such coupling,
 * and it is also what makes an on-demand start failure diagnosable at all — the
 * real cause (`listen EACCES`, a dependency install failure, …) lives in the dead
 * child's stderr, and without the file the client could only report the error
 * code of its own first connect attempt.
 *
 * The tail is read from the offset captured at launch, so the reported line is
 * this launch's stderr rather than whatever a previous launch left behind.
 *
 * `WAVE_LOGS_DIR` redirects the directory (same convention as the desktop and VS
 * Code host logs), which is what tests and isolated-HOME runs use.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { getLastLines, stripAnsiColors } from "wave-agent-sdk";

/** Rotate one generation (to `daemon.log.1`) once the log passes this size. */
export const DAEMON_LOG_MAX_BYTES = 1024 * 1024;

/** How many trailing bytes are read to find the last diagnostic line. */
const TAIL_READ_BYTES = 8 * 1024;

export function daemonLogDir(): string {
  return process.env.WAVE_LOGS_DIR || path.join(os.homedir(), ".wave", "logs");
}

export function daemonLogFile(): string {
  return path.join(daemonLogDir(), "daemon.log");
}

/** The single retained previous generation (`daemon.log.1`). */
function rotatedLogFile(file: string): string {
  return `${file}.1`;
}

/**
 * Best-effort one-generation rotation before appending. Failures are swallowed:
 * the log is a diagnostic aid, never a reason for the daemon not to start.
 */
export function rotateDaemonLog(
  file = daemonLogFile(),
  maxBytes = DAEMON_LOG_MAX_BYTES,
): void {
  try {
    if (fs.statSync(file).size <= maxBytes) return;
    // Windows refuses to rename over an existing file — drop the old generation
    // first (and POSIX does not mind).
    fs.rmSync(rotatedLogFile(file), { force: true });
    fs.renameSync(file, rotatedLogFile(file));
  } catch {
    // Nothing to rotate yet, or the directory is not writable.
  }
}

/**
 * An open append handle for a launched daemon child, plus the offset its output
 * starts at (the file is shared across launches).
 */
export interface DaemonLogHandle {
  fd: number;
  file: string;
  offset: number;
}

/**
 * Open (and if needed rotate) the daemon log, returning the handle to pass as
 * the child's stderr — or `undefined` when it cannot be opened, in which case the
 * caller falls back to `"ignore"` and simply loses the diagnostic.
 */
export function openDaemonLogForChild(
  file = daemonLogFile(),
): DaemonLogHandle | undefined {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    rotateDaemonLog(file);
    const offset = fs.existsSync(file) ? fs.statSync(file).size : 0;
    const fd = fs.openSync(file, "a");
    return { fd, file, offset };
  } catch {
    return undefined;
  }
}

/**
 * The last non-empty line this launch wrote, de-ANSI'd, collapsed to one line and
 * capped — meant to be appended to a client-side error message. Empty when there
 * is no handle or nothing was written.
 */
export function readDaemonLogTail(
  handle: DaemonLogHandle | undefined,
  maxChars = 200,
): string {
  if (!handle) return "";
  let fd: number | undefined;
  try {
    fd = fs.openSync(handle.file, "r");
    const size = fs.fstatSync(fd).size;
    const from = Math.max(handle.offset, size - TAIL_READ_BYTES);
    const bytes = size - from;
    if (bytes <= 0) return "";
    const buf = Buffer.alloc(bytes);
    fs.readSync(fd, buf, 0, bytes, from);
    const lines = getLastLines(buf.toString("utf8"), 20).split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = stripAnsiColors(lines[i] ?? "")
        .replace(/\s+/g, " ")
        .trim();
      if (!line) continue;
      return line.length > maxChars ? `${line.slice(0, maxChars)}…` : line;
    }
    return "";
  } catch {
    return "";
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // Already closed.
      }
    }
  }
}
