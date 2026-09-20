/**
 * daemon-cli.ts — Entry point for `wave --daemon <socket-path>` mode.
 *
 * Starts a DaemonServer that serves JSON-RPC over a unix socket. The desktop
 * app launches this on a remote host via nohup/setsid and tunnels the socket
 * back with `ssh -L`; multiple attach/detach cycles share one process, so
 * sessions and pending permissions survive client disconnects. The net server
 * keeps the process alive — there is no stdin to wait on.
 */

import { ensureRuntimeDeps } from "wave-agent-sdk";
import { DaemonServer } from "./stdio/daemonServer.js";

export async function startDaemonCli(socketPath: string): Promise<void> {
  // Install the on-demand image codec before serving (see cli.tsx). The daemon
  // serves turns on a remote host, so the install belongs here — and it must
  // land before the first client attaches, since the host reports "daemon ready"
  // on this socket.
  await ensureRuntimeDeps();
  const server = new DaemonServer({ socketPath });
  await server.start();
  // Ready — any error that follows goes to the daemon log via stderr.
}
