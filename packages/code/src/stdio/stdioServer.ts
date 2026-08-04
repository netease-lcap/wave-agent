/**
 * StdioServer — reads JSON-RPC messages from stdin, dispatches to AgentBridge,
 * and writes responses / notifications to stdout.
 *
 * One JSON object per line. stderr is reserved for logger output.
 * Line handling lives in JsonRpcConnection (shared with DaemonServer).
 */

import type { Readable, Writable } from "stream";
import { AgentBridge, type AgentBridgeOptions } from "./agentBridge.js";
import { JsonRpcConnection } from "./jsonRpcConnection.js";

export interface StdioServerOptions {
  input?: Readable;
  output?: Writable;
  bridgeOptions?: AgentBridgeOptions;
}

export class StdioServer {
  private bridge: AgentBridge;
  private conn: JsonRpcConnection;

  constructor(options: StdioServerOptions = {}) {
    this.bridge = new AgentBridge({
      ...options.bridgeOptions,
      emit: (method, params, sessionId) =>
        this.sendNotification(method, params, sessionId),
    });
    this.conn = new JsonRpcConnection(
      options.input ?? process.stdin,
      options.output ?? process.stdout,
      this.bridge,
    );
  }

  get agentBridge(): AgentBridge {
    return this.bridge;
  }

  start(): void {
    this.conn.start();
  }

  stop(): void {
    this.conn.stop();
  }

  handleLine(line: string): Promise<void> {
    return this.conn.handleLine(line);
  }

  sendResponse(
    id: number | string | null,
    result?: unknown,
    error?: { code: number; message: string },
  ): void {
    this.conn.sendResponse(id, result, error);
  }

  sendNotification(method: string, params?: unknown, sessionId?: string): void {
    this.conn.sendNotification(method, params, sessionId);
  }
}
