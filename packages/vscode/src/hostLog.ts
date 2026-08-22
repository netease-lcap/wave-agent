/**
 * Host-side file logger for the VS Code extension (vscode.log).
 *
 * Appends plain-text `[ISO-8601] [LEVEL] message` lines to
 * ~/.wave/logs/vscode.log; the wave --stdio child writes its own cli.log via
 * the CLI logger. No level filtering and no console patching — callers use it
 * explicitly at chokepoints. Files are kept bounded: after each append the
 * file is truncated to the last 1000 lines when it exceeds 1MB, mirroring
 * the CLI logger (which keeps 10MB — it is a high-volume session log).
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const LOG_FILE = path.join(
  process.env.WAVE_LOGS_DIR || path.join(os.homedir(), ".wave", "logs"),
  "vscode.log",
);
const MAX_FILE_SIZE = 1024 * 1024;
const KEEP_LINES = 1000;

const safeJson = (arg: object): string => {
  try {
    return JSON.stringify(arg);
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

function append(level: string, ...args: unknown[]): void {
  // Test environments opt out of real file I/O (same flag as the CLI logger).
  if (process.env.DISABLE_LOGGER_IO === "true") return;
  const line = `[${new Date().toISOString()}] [${level}] ${args.map(formatArg).join(" ")}\n`;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    fs.appendFileSync(LOG_FILE, line);
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

export const hostLog = {
  debug: (...args: unknown[]) => append("DEBUG", ...args),
  info: (...args: unknown[]) => append("INFO", ...args),
  warn: (...args: unknown[]) => append("WARN", ...args),
  error: (...args: unknown[]) => append("ERROR", ...args),
};
