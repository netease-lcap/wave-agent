/**
 * daemon-cli.ts — Entry point for `wave --daemon <socket-path>` mode.
 *
 * Starts a DaemonServer that serves JSON-RPC over a unix socket. The desktop
 * app launches this on a remote host via nohup/setsid and tunnels the socket
 * back with `ssh -L`; multiple attach/detach cycles share one process, so
 * sessions and pending permissions survive client disconnects. The net server
 * keeps the process alive — there is no stdin to wait on.
 */

import { DaemonServer } from "./stdio/daemonServer.js";

export async function startDaemonCli(socketPath: string): Promise<void> {
  const server = new DaemonServer({ socketPath });
  await server.start();
  // Ready — any error that follows goes to the daemon log via stderr.
}
