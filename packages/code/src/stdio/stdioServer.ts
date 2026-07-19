/**
 * StdioServer — reads JSON-RPC messages from stdin, dispatches to AgentBridge,
 * and writes responses / notifications to stdout.
 *
 * One JSON object per line. stderr is reserved for logger output.
 */

import readline from "readline";
import type { Readable, Writable } from "stream";
import { AgentBridge, type AgentBridgeOptions } from "./agentBridge.js";
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcNotification,
  PARSE_ERROR,
  INVALID_REQUEST,
  INTERNAL_ERROR,
  isRequest,
  isNotification,
} from "./protocol.js";

export interface StdioServerOptions {
  input?: Readable;
  output?: Writable;
  bridgeOptions?: AgentBridgeOptions;
}

export class StdioServer {
  private rl: readline.Interface | undefined;
  private bridge: AgentBridge;
  private input: Readable;
  private output: Writable;
  private started = false;

  constructor(options: StdioServerOptions = {}) {
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.bridge = new AgentBridge({
      ...options.bridgeOptions,
      emit: (method, params, sessionId) =>
        this.sendNotification(method, params, sessionId),
    });
  }

  get agentBridge(): AgentBridge {
    return this.bridge;
  }

  start(): void {
    if (this.started) return;
    this.started = true;

    this.rl = readline.createInterface({
      input: this.input,
      crlfDelay: Infinity,
    });

    this.rl.on("line", (line: string) => {
      this.handleLine(line).catch((err) => {
        // Should never reach here — handleLine catches internally
        this.sendResponse(null, undefined, {
          code: INTERNAL_ERROR,
          message: `Unhandled error: ${(err as Error).message}`,
        });
      });
    });

    this.rl.on("close", () => {
      this.started = false;
    });
  }

  stop(): void {
    this.rl?.close();
    this.rl = undefined;
    this.started = false;
  }

  async handleLine(line: string): Promise<void> {
    const trimmed = line.trim();
    if (!trimmed) return;

    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      this.sendResponse(null, undefined, {
        code: PARSE_ERROR,
        message: "Parse error: invalid JSON",
      });
      return;
    }

    if (isRequest(msg)) {
      await this.handleRequest(msg);
    } else if (isNotification(msg)) {
      this.handleNotification(msg);
    } else {
      // Echo back the id if the message has one, otherwise null
      const id =
        typeof msg === "object" &&
        msg !== null &&
        "id" in msg &&
        (typeof (msg as { id: unknown }).id === "number" ||
          typeof (msg as { id: unknown }).id === "string")
          ? (msg as { id: number | string }).id
          : null;
      this.sendResponse(id, undefined, {
        code: INVALID_REQUEST,
        message: "Invalid request: must have 'method' field",
      });
    }
  }

  private async handleRequest(msg: JsonRpcRequest): Promise<void> {
    try {
      const result = await this.bridge.handleRequest(
        msg.method,
        msg.params,
        msg.sessionId,
      );
      this.sendResponse(msg.id, result);
    } catch (err) {
      const code =
        err && typeof err === "object" && "code" in err
          ? (err as { code: number }).code
          : INTERNAL_ERROR;
      const message = err instanceof Error ? err.message : String(err);
      this.sendResponse(msg.id, undefined, { code, message });
    }
  }

  private handleNotification(msg: JsonRpcNotification): void {
    try {
      this.bridge.handleNotification(msg.method, msg.params);
    } catch (err) {
      // Notifications don't get responses, but we log to stderr
      process.stderr.write(
        `Error handling notification ${msg.method}: ${(err as Error).message}\n`,
      );
    }
  }

  // ── Output helpers ────────────────────────────────────────────

  sendResponse(
    id: number | string | null,
    result?: unknown,
    error?: { code: number; message: string },
  ): void {
    const response: JsonRpcResponse = { id };
    if (error) {
      response.error = error;
    } else {
      response.result = result ?? null;
    }
    this.write(response);
  }

  sendNotification(method: string, params?: unknown, sessionId?: string): void {
    const notification: JsonRpcNotification = { method, params };
    if (sessionId) notification.sessionId = sessionId;
    this.write(notification);
  }

  private write(obj: JsonRpcResponse | JsonRpcNotification): void {
    this.output.write(JSON.stringify(obj) + "\n");
  }
}
