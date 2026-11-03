/**
 * daemon-cli.ts — Entry point for `wave --daemon <socket-path>` mode.
 *
 * Starts a DaemonServer that serves JSON-RPC over a local socket (a unix domain
 * socket on POSIX, a named pipe on Windows). The desktop app launches this on a
 * remote host via nohup/setsid and tunnels the socket back with `ssh -L`;
 * multiple attach/detach cycles share one process, so sessions and pending
 * permissions survive client disconnects. The net server keeps the process
 * alive — there is no stdin to wait on.
 */

import { ensureRuntimeDeps } from "wave-agent-sdk";
import { DaemonServer } from "./stdio/daemonServer.js";
import { createRemoteControlSinkFactory } from "./remote/remoteControlSink.js";
import { resolveDaemonSocket } from "./daemon/socketPath.js";

export async function startDaemonCli(socketPath: string): Promise<void> {
  // Install the on-demand runtime dependencies (image codec + ripgrep) before
  // serving (see cli.tsx). The daemon serves turns on a remote host, so the
  // install belongs here — and it must land before the first client attaches,
  // since the host reports "daemon ready" on this socket.
  await ensureRuntimeDeps();

  // Resolve the address exactly like the client does. The default path is the
  // one name both sides must agree on, and on Windows it is reachable only in
  // its pipe form — a caller that spells it out (`wave --daemon
  // ~/.wave/daemon.sock`) must land on the same pipe the client derives, not on
  // an EACCES. An explicit pipe name, or any other path, is used verbatim so a
  // wrong address still fails loudly instead of being silently renamed.
  const resolvedSocketPath = resolveDaemonSocket(process.platform, socketPath);

  // The resident daemon owns the remote sessions, so it is the process that
  // serves a paired phone. Off (undefined) unless the switch says otherwise.
  const createRemoteSink = createRemoteControlSinkFactory(process.cwd());
  const server = new DaemonServer({
    socketPath: resolvedSocketPath,
    createRemoteSink,
  });
  await server.start();
  // Ready — any error that follows goes to the daemon log via stderr.
}
