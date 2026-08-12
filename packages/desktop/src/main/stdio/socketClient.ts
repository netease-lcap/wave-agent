/**
 * SocketClient — JSON-RPC transport over an existing unix socket.
 *
 * Used for the remote host tunnel: desktop connects a local unix socket that
 * ssh forwards to the remote wave daemon's socket, so this client behaves like
 * the StdioClient the desktop already knows — one JSON object per line, same
 * request/notification semantics, same "closed" rejection behavior.
 */

import type { Socket } from "net";
import { JsonRpcClient } from "./jsonRpcClient";

export class SocketClient extends JsonRpcClient {
  private socket: Socket;

  constructor(socket: Socket) {
    super();
    this.socket = socket;
    this.attachReadable(socket);

    socket.on("close", () => {
      this.handleClosed("远端连接已断开。");
    });
    socket.on("error", (err) => {
      console.error("[wave-remote] Socket error:", err.message);
    });
  }

  protected writeLine(message: string): void {
    this.socket.write(message);
  }

  dispose(): void {
    this.handleClosed("远端连接已断开。");
    this.socket.destroy();
  }
}
