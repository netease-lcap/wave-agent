/**
 * JsonRpcClient — minimal JSON-RPC transport over a line-delimited duplex
 * stream (one JSON object per line).
 *
 * Used by `wave daemon` subcommands to talk to the wave daemon's unix socket.
 * Mirrors packages/desktop/src/main/stdio/jsonRpcClient.ts (packages/code
 * cannot import from packages/desktop). Subclasses own the transport and hook
 * in:
 * - `writeLine(message)` writes one JSON line to the peer.
 * - `attachReadable(readable)` wires the inbound half (socket).
 * - `handleClosed(reason)` marks the transport dead and rejects every pending
 *   request. Idempotent — safe to call from both dispose() and an exit/close
 *   event on the underlying transport.
 */

import { createInterface } from "readline";
import type { Readable } from "stream";

export type NotificationHandler = (params: unknown, sessionId?: string) => void;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

export abstract class JsonRpcClient {
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private handlers = new Map<string, Set<NotificationHandler>>();
  private closedHandlers: Array<() => void> = [];
  private closed = false;

  // ── Transport hooks (subclass) ─────────────────────────────────

  protected abstract writeLine(message: string): void;

  /** Wire an inbound Readable (socket) to the line parser. */
  protected attachReadable(readable: Readable): void {
    const rl = createInterface({ input: readable });
    rl.on("line", (line) => this.handleLine(line));
    // readline re-emits input errors on the Interface; the transport subclass
    // already handles errors on the underlying stream, swallow them here so
    // they never surface as an uncaught 'error' on the Interface.
    rl.on("error", () => {});
  }

  /** Mark the transport closed: reject every pending request. Idempotent. */
  protected handleClosed(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    const error = new Error(reason);
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
    for (const handler of this.closedHandlers) handler();
    this.closedHandlers = [];
  }

  protected get isClosed(): boolean {
    return this.closed;
  }

  // ── Public API ─────────────────────────────────────────────────

  /** Close the transport and reject pending requests (subclass tears down its stream). */
  abstract dispose(): void;

  /** Observe transport teardown (dispose or unexpected close), fired once. */
  onClosed(handler: () => void): void {
    this.closedHandlers.push(handler);
  }

  async request(
    method: string,
    params?: unknown,
    sessionId?: string,
  ): Promise<unknown> {
    if (this.closed) {
      throw new Error(
        "连接已断开。wave 进程已退出，请重启编辑器或检查 CLI 安装。",
      );
    }
    const id = this.nextId++;
    const envelope: Record<string, unknown> = { id, method, params };
    if (sessionId) envelope.sessionId = sessionId;
    const message = JSON.stringify(envelope) + "\n";

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.writeLine(message);
    });
  }

  notify(method: string, params?: unknown, sessionId?: string): void {
    if (this.closed) return;
    const envelope: Record<string, unknown> = { method, params };
    if (sessionId) envelope.sessionId = sessionId;
    this.writeLine(JSON.stringify(envelope) + "\n");
  }

  onNotification(method: string, handler: NotificationHandler): void {
    let set = this.handlers.get(method);
    if (!set) {
      set = new Set();
      this.handlers.set(method, set);
    }
    set.add(handler);
  }

  offNotification(method: string, handler: NotificationHandler): void {
    this.handlers.get(method)?.delete(handler);
  }

  // ── Internal ──────────────────────────────────────────────────

  private handleLine(line: string): void {
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      console.error("[wave-jsonrpc] Failed to parse:", line);
      return;
    }

    if (typeof msg !== "object" || msg === null) return;
    const obj = msg as Record<string, unknown>;

    // Response (has id + result/error)
    if ("id" in obj && ("result" in obj || "error" in obj)) {
      const id = Number(obj.id);
      const pending = this.pending.get(id);
      if (pending) {
        this.pending.delete(id);
        if (obj.error) {
          const err = obj.error as { code: number; message: string };
          pending.reject(new Error(err.message));
        } else {
          pending.resolve(obj.result);
        }
      }
      return;
    }

    // Notification (has method, no id)
    if ("method" in obj && !("id" in obj)) {
      const method = obj.method as string;
      const params = obj.params;
      const sessionId =
        typeof obj.sessionId === "string" ? obj.sessionId : undefined;
      const set = this.handlers.get(method);
      if (set) {
        for (const handler of set) {
          handler(params, sessionId);
        }
      }
      return;
    }
  }
}
