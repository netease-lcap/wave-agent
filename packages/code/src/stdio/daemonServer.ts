/**
 * DaemonServer — JSON-RPC server over a unix socket for remote background
 * sessions (spec: docs/specs/desktop/desktop-remote.md 「SSH 远程后台会话」).
 *
 * The desktop app launches `wave --daemon <socket>` on the remote host via
 * nohup/setsid, then tunnels the socket back with `ssh -L`. All connections
 * share one AgentBridge, so sessions and pending tool permissions survive
 * client detach/attach. A launched daemon is resident: it keeps running (and
 * generating) while no desktop is connected and never auto-exits once the
 * work settles. It goes away when told to shut down gracefully (`wave daemon
 * stop` / `restart`, destroying sessions so transcripts flush), when killed
 * externally (desktop CLI 升级重启 pkill, remote reboot / machine reboot), and
 * the next client that finds the socket absent starts a fresh daemon on
 * demand.
 */

import net from "net";
import * as fs from "fs";
import { AgentBridge, type AgentBridgeOptions } from "./agentBridge.js";
import { JsonRpcConnection } from "./jsonRpcConnection.js";
import type { RemoteControlSink } from "../remote/remoteControlSink.js";

export interface DaemonServerOptions {
  socketPath: string;
  bridgeOptions?: AgentBridgeOptions;
  /**
   * Built with the bridge (which the daemon owns privately) so the sink can
   * route inbound phone requests back through it. Its notifications are wired
   * up here; connecting is the user's call, not ours. Unset means remote
   * control is off for this daemon — the `remoteControl*` RPCs then report
   * exactly that through the bridge's own error.
   */
  createRemoteSink?: (bridge: AgentBridge) => RemoteControlSink;
}

export class DaemonServer {
  private socketPath: string;
  private server: net.Server | undefined;
  private bridge: AgentBridge;
  private connections = new Set<JsonRpcConnection>();
  private sockets = new Set<net.Socket>();
  private remoteSink: RemoteControlSink | undefined;

  constructor(options: DaemonServerOptions) {
    this.socketPath = options.socketPath;
    let remoteSink: RemoteControlSink | undefined;
    this.bridge = new AgentBridge({
      ...options.bridgeOptions,
      // The sink is handed the bridge it must route phone requests back
      // through, so it can only be built after it; reading it lazily keeps the
      // two from having to be constructed in a circle.
      remoteControl: () => remoteSink,
      // Notifications go to every attached client; a fully detached daemon
      // has none, and the write is dropped silently (the attach snapshot
      // re-syncs state on reconnect).
      emit: (method, params, sessionId) => {
        for (const conn of this.connections) {
          conn.sendNotification(method, params, sessionId);
        }
        // The phone must never be able to take the local clients down with
        // it, so a remote-path failure is contained here rather than thrown.
        try {
          this.remoteSink?.sendNotification(method, params, sessionId);
        } catch {
          // Dropped frame; the phone re-syncs on reconnect.
        }
      },
      // The `shutdown` RPC (wave daemon stop/restart) destroys every session in
      // the bridge, then hands off here to tear the process down.
      onShutdownRequest: () => this.shutdown(),
    });
    remoteSink = options.createRemoteSink?.(this.bridge);
    this.remoteSink = remoteSink;
    this.server = net.createServer((socket) => {
      const conn = new JsonRpcConnection(socket, socket, this.bridge);
      this.connections.add(conn);
      this.sockets.add(socket);
      socket.on("error", () => {
        // The client (ssh tunnel) can reset the socket mid-detach; the daemon
        // must keep running — 'close' below cleans up the connection.
      });
      socket.on("close", () => {
        this.connections.delete(conn);
        this.sockets.delete(socket);
      });
      conn.start();
    });
  }

  get agentBridge(): AgentBridge {
    return this.bridge;
  }

  /**
   * Listen on the socket path. Rejects when a live daemon already holds it. A
   * stale socket file left by a crashed daemon would otherwise block the
   * restart with EADDRINUSE, so it is cleaned up first: non-socket files are
   * unlinked outright; socket files are probe-connected — ECONNREFUSED means
   * no listener (stale → unlink and listen), anything else means a live
   * daemon owns the path (reject).
   */
  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      const server = this.server;
      if (!server) return resolve();
      try {
        const st = fs.statSync(this.socketPath);
        if (st.isSocket()) {
          const probe = net.connect(this.socketPath);
          probe.once("connect", () => {
            probe.destroy();
            reject(
              new Error(
                `Another wave daemon is already listening on ${this.socketPath}`,
              ),
            );
          });
          probe.once("error", (err: NodeJS.ErrnoException) => {
            probe.destroy();
            if (err.code === "ECONNREFUSED") {
              fs.unlinkSync(this.socketPath);
              this.listen(server, resolve, reject);
            } else {
              reject(err);
            }
          });
          return;
        }
        fs.unlinkSync(this.socketPath);
      } catch {
        // ENOENT — no stale socket, listen directly.
      }
      this.listen(server, resolve, reject);
    });
  }

  private listen(
    server: net.Server,
    resolve: () => void,
    reject: (err: Error) => void,
  ): void {
    server.once("error", reject);
    server.listen(this.socketPath, () => {
      server.removeListener("error", reject);
      resolve();
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.remoteSink?.stop();
      this.remoteSink = undefined;
      const server = this.server;
      if (!server) return resolve();
      this.server = undefined;
      server.close(() => resolve());
    });
  }

  /**
   * Graceful process exit for the `shutdown` RPC (`wave daemon stop`/restart).
   * The bridge has already destroyed every session (each agent saved its
   * transcript and drained auto-memory); here we drop all client sockets, close
   * the listener, remove the socket file, then exit. The exit is guarded so a
   * test process that mocks process.exit (throwing or no-op) still observes the
   * teardown.
   */
  private shutdown(): void {
    // Drop the relay link explicitly: the process is about to exit, and leaving
    // the socket to the OS would have the relay hold a dead subscription.
    this.remoteSink?.stop();
    this.remoteSink = undefined;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    this.server?.close();
    this.server = undefined;
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // Already gone — a stale file is probed/unlinked on next start.
    }
    try {
      process.exit(0);
    } catch {
      // process.exit is mocked in tests — the teardown above is the effect.
    }
  }
}
