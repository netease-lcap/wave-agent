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
 */

import net from "net";
import * as fs from "fs";
import { AgentBridge, type AgentBridgeOptions } from "./agentBridge.js";
import { JsonRpcConnection } from "./jsonRpcConnection.js";

export interface DaemonServerOptions {
  socketPath: string;
  bridgeOptions?: AgentBridgeOptions;
}

export class DaemonServer {
  private socketPath: string;
  private server: net.Server | undefined;
  private bridge: AgentBridge;
  private connections = new Set<JsonRpcConnection>();

  constructor(options: DaemonServerOptions) {
    this.socketPath = options.socketPath;
    this.bridge = new AgentBridge({
      ...options.bridgeOptions,
      // Notifications go to every attached client; a fully detached daemon
      // has none, and the write is dropped silently (the attach snapshot
      // re-syncs state on reconnect).
      emit: (method, params, sessionId) => {
        for (const conn of this.connections) {
          conn.sendNotification(method, params, sessionId);
        }
      },
    });
    this.server = net.createServer((socket) => {
      const conn = new JsonRpcConnection(socket, socket, this.bridge);
      this.connections.add(conn);
      socket.on("close", () => {
        this.connections.delete(conn);
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
              new Error(`另一个 wave daemon 已在 ${this.socketPath} 监听`),
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
      const server = this.server;
      if (!server) return resolve();
      this.server = undefined;
      server.close(() => resolve());
    });
  }
}
