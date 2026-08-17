/**
 * DaemonServer — JSON-RPC server over a unix socket for remote background
 * sessions (spec: docs/specs/ui/desktop-app.md 「SSH 远程后台会话」).
 *
 * The desktop app launches `wave --daemon <socket>` on the remote host via
 * nohup/setsid, then tunnels the socket back with `ssh -L`. All connections
 * share one AgentBridge, so sessions and pending tool permissions survive
 * client detach/attach — the daemon keeps running (and generating) while no
 * desktop is connected. The daemon never exits on a client disconnect; it
 * only exits when killed (app quit / 删除会话 / remote reboot).
 *
 * Idle auto-exit (spec: 「远程 daemon 空闲自动退出」): once every session has
 * settled and no client is connected, the daemon mirrors `wave -p`'s exit
 * semantics — after a grace period it destroys the sessions (saving their
 * transcripts), closes the socket, and exits, so the remote process doesn't
 * linger forever after background work completes.
 */

import net from "net";
import * as fs from "fs";
import { AgentBridge, type AgentBridgeOptions } from "./agentBridge.js";
import { JsonRpcConnection } from "./jsonRpcConnection.js";

export interface DaemonServerOptions {
  socketPath: string;
  bridgeOptions?: AgentBridgeOptions;
  /** Idle grace period before the daemon auto-exits (default 60s). */
  graceMs?: number;
}

export class DaemonServer {
  static readonly DEFAULT_IDLE_GRACE_MS = 60_000;

  private socketPath: string;
  private server: net.Server | undefined;
  private bridge: AgentBridge;
  private connections = new Set<JsonRpcConnection>();
  private sockets = new Set<net.Socket>();
  private graceMs: number;
  private idleTimer: NodeJS.Timeout | undefined;
  private shuttingDown = false;
  private stopped = false;

  constructor(options: DaemonServerOptions) {
    this.socketPath = options.socketPath;
    this.graceMs = options.graceMs ?? DaemonServer.DEFAULT_IDLE_GRACE_MS;
    this.bridge = new AgentBridge({
      ...options.bridgeOptions,
      // Notifications go to every attached client; a fully detached daemon
      // has none, and the write is dropped silently (the attach snapshot
      // re-syncs state on reconnect).
      emit: (method, params, sessionId) => {
        for (const conn of this.connections) {
          conn.sendNotification(method, params, sessionId);
        }
        // Any session activity can change the idle state — re-evaluate.
        this.evaluateIdle();
      },
    });
    this.server = net.createServer((socket) => {
      if (this.shuttingDown) {
        socket.destroy();
        return;
      }
      const conn = new JsonRpcConnection(socket, socket, this.bridge);
      this.connections.add(conn);
      this.sockets.add(socket);
      // A (re)attached client cancels a pending idle exit.
      this.evaluateIdle();
      socket.on("error", () => {
        // The client (ssh tunnel) can reset the socket mid-detach; the daemon
        // must keep running — 'close' below cleans up the connection.
      });
      socket.on("close", () => {
        this.connections.delete(conn);
        this.sockets.delete(socket);
        // A client detach may leave the daemon idle — re-evaluate.
        this.evaluateIdle();
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
      // A freshly started daemon may already be idle (no sessions) — start the
      // idle watch so a zero-session daemon also auto-exits.
      this.evaluateIdle();
    });
  }

  stop(): Promise<void> {
    this.stopped = true;
    this.clearIdleTimer();
    return new Promise((resolve) => {
      const server = this.server;
      if (!server) return resolve();
      this.server = undefined;
      server.close(() => resolve());
    });
  }

  // ── Idle auto-exit ────────────────────────────────────────────

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }

  /**
   * Re-evaluate the idle condition after any state transition: sessions busy
   * (loading / pending messages / background work) or any client attached →
   * cancel the timer. Fully idle + detached → arm the grace timer once; when
   * it fires, shut the daemon down. Evaluation is event-driven (every
   * busy→idle transition emits a notification, every attach/detach fires a
   * connection event), so nothing is polled. The failure mode is
   * conservative: a missed transition just leaves the daemon running.
   */
  private evaluateIdle(): void {
    // A stopped/shutting-down daemon never (re)arms the idle timer — late
    // socket 'close' events (which fire after server.close resolves) must not
    // resurrect a timer after stop().
    if (this.shuttingDown || this.stopped) return;
    if (this.connections.size > 0 || !this.bridge.isIdle()) {
      this.clearIdleTimer();
      return;
    }
    if (this.idleTimer) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      void this.shutdown();
    }, this.graceMs);
  }

  /**
   * Destroy the sessions (each agent saves its transcript and drains
   * auto-memory), close the listener, unlink the socket file, then exit.
   * `shuttingDown` guards against re-entry: new connections are refused and
   * further idle evaluations become no-ops.
   */
  private async shutdown(): Promise<void> {
    if (this.shuttingDown) return;
    this.shuttingDown = true;
    this.clearIdleTimer();
    // Destroy client sockets first so server.close() can complete (an open
    // socket keeps the close callback pending).
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await this.bridge.destroyAll();
    await this.stop();
    try {
      fs.unlinkSync(this.socketPath);
    } catch {
      // Already gone — a stale file would be probed/unlinked on next start.
    }
    process.exit(0);
  }
}
