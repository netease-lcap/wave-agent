/**
 * stdio-cli.ts — Entry point for `wave --stdio` mode.
 *
 * Starts a StdioServer that reads JSON-RPC messages from stdin and writes
 * responses/notifications to stdout. The server creates an Agent lazily when
 * the client sends an "initialize" request.
 */

import { StdioServer } from "./stdio/stdioServer.js";
import { logger } from "./utils/logger.js";

/**
 * Uncaught exceptions / unhandled rejections only print to stderr by
 * default, which the host truncates to a small tail (and the process exits
 * right after, so queued stderr can be lost entirely) — the real crash
 * reason often never reaches the user. Log the full error to cli.log
 * (synchronous file append, never truncated), best-effort it to stderr,
 * then keep the exit(1) semantics.
 */
function crashHandler(kind: string, error: unknown): void {
  logger.error(`[stdio] ${kind}:`, error);
  try {
    process.stderr.write(
      `[stdio] ${kind}: ${
        error instanceof Error ? error.stack || error.message : String(error)
      }\n`,
    );
  } catch {
    // stderr failure must not mask the log-file entry above.
  }
  process.exit(1);
}

/**
 * stdout carries the JSON-RPC channel in --stdio mode (one JSON object per
 * line); stderr is reserved for logger output (see stdioServer.ts). A single
 * stray `console.log` anywhere in the SDK/host dependency graph therefore
 * corrupts that channel: the host skips the unparseable line, losing whatever
 * JSON-RPC payload shared it (this is how `SessionService`'s
 * `console.log("Restoring session: …")` showed up as
 * `[wave-jsonrpc] Failed to parse: …` on every restore).
 *
 * Fixing individual call sites is a losing race against a graph this big, so
 * stdio mode forces the contract instead: only `console.error`/`console.warn`
 * (already stderr) may print, everything else is redirected to stderr.
 */
export function guardStdoutForJsonRpc(): void {
  for (const level of ["log", "info", "debug"] as const) {
    console[level] = (...args: unknown[]) => {
      console.error(...args);
    };
  }
}

export async function startStdioCli(): Promise<void> {
  guardStdoutForJsonRpc();
  // Registered here (stdio mode only): the interactive CLI keeps Node's
  // default behavior so the terminal shows the crash stack directly.
  process.on("uncaughtException", (error) =>
    crashHandler("uncaughtException", error),
  );
  process.on("unhandledRejection", (reason) =>
    crashHandler("unhandledRejection", reason),
  );

  const server = new StdioServer();
  server.start();

  // Keep the process alive — readline on stdin handles the event loop.
  // When stdin closes (EOF), the readline interface emits 'close' and
  // the process will exit naturally.
}
