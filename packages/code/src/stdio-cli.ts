/**
 * stdio-cli.ts — Entry point for `wave --stdio` mode.
 *
 * Starts a StdioServer that reads JSON-RPC messages from stdin and writes
 * responses/notifications to stdout. The server creates an Agent lazily when
 * the client sends an "initialize" request.
 */

import { StdioServer } from "./stdio/stdioServer.js";

export async function startStdioCli(): Promise<void> {
  const server = new StdioServer();
  server.start();

  // Keep the process alive — readline on stdin handles the event loop.
  // When stdin closes (EOF), the readline interface emits 'close' and
  // the process will exit naturally.
}
