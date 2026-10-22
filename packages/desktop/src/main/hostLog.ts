/**
 * Host-side file logger for the Electron main process (desktop.log).
 *
 * Appends plain-text `[ISO-8601] [LEVEL] message` lines to
 * ~/.wave/logs/desktop.log; the wave --stdio child writes its own cli.log via
 * the CLI logger. No level filtering and no console patching — callers use it
 * explicitly at chokepoints. Files are kept bounded: after each append the
 * file is truncated to the last 1000 lines when it exceeds 1MB, mirroring
 * the CLI logger (which keeps 10MB — it is a high-volume session log).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { errorReplacer } from "wave-agent-sdk/host";

/**
 * Directory the desktop logs (and therefore the 「导出日志」 archive) live in.
 * WAVE_LOGS_DIR exists so tests/dev instances can redirect it. Exported because
 * the crash-recovery path tells users/ops where to find the files.
 */
export const LOG_DIR =
  process.env.WAVE_LOGS_DIR || path.join(os.homedir(), ".wave", "logs");
export const LOG_FILE = path.join(LOG_DIR, "desktop.log");

export type HostLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

const MAX_FILE_SIZE = 1024 * 1024;
const KEEP_LINES = 1000;

const safeJson = (arg: object): string => {
  try {
    // The replacer keeps Errors nested inside a payload ({ error: e }) from
    // serializing to `{}` — the `instanceof` check below only covers args
    // passed bare.
    return JSON.stringify(arg, errorReplacer);
  } catch {
    return String(arg);
  }
};

const formatArg = (arg: unknown): string => {
  let text: string;
  if (arg instanceof Error) {
    text = arg.stack || arg.message;
  } else if (arg && typeof arg === "object") {
    text = safeJson(arg);
  } else {
    text = String(arg);
  }
  return text.replace(/[\n\r]+/g, " ");
};

const prefix = (level: HostLogLevel): string =>
  `[${new Date().toISOString()}] [${level}] `;

function write(level: HostLogLevel, text: string): void {
  // Test environments opt out of real file I/O (same flag as the CLI logger).
  if (process.env.DISABLE_LOGGER_IO === "true") return;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, text);
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_FILE_SIZE) {
      const kept = fs
        .readFileSync(LOG_FILE, "utf8")
        .split("\n")
        .slice(-KEEP_LINES)
        .join("\n");
      fs.writeFileSync(LOG_FILE, kept);
    }
  } catch (error) {
    process.stderr.write(
      `[${level}] Failed to write ${LOG_FILE}: ${formatArg(error)}\n`,
    );
  }
}

function append(level: HostLogLevel, ...args: unknown[]): void {
  write(level, `${prefix(level)}${args.map(formatArg).join(" ")}\n`);
}

/**
 * Multi-line entry: one timestamped header line, then the remaining lines
 * verbatim. Renderer stack samples and per-process memory readings are blocks —
 * collapsing their newlines into one huge line (what `info`/`warn` do) throws
 * away the very shape (which frame sits on top, how many samples per stack)
 * that makes the evidence readable.
 */
function appendBlock(level: HostLogLevel, lines: string[]): void {
  if (lines.length === 0) return;
  write(level, `${prefix(level)}${lines[0]}\n${lines.slice(1).join("\n")}\n`);
}

export const hostLog = {
  debug: (...args: unknown[]) => append("DEBUG", ...args),
  info: (...args: unknown[]) => append("INFO", ...args),
  warn: (...args: unknown[]) => append("WARN", ...args),
  error: (...args: unknown[]) => append("ERROR", ...args),
  block: (level: HostLogLevel, lines: string[]) => appendBlock(level, lines),
};
