/**
 * SocketClient — JSON-RPC transport over a unix socket connection to the wave
 * daemon. Mirrors packages/desktop/src/main/stdio/socketClient.ts (packages/code
 * cannot import from packages/desktop).
 */

import type { Socket } from "net";
import { JsonRpcClient } from "./jsonRpcClient.js";

export class SocketClient extends JsonRpcClient {
  private socket: Socket;

  constructor(socket: Socket) {
    super();
    this.socket = socket;
    this.attachReadable(socket);

    socket.on("close", () => {
      this.handleClosed("Remote connection closed.");
    });
    socket.on("error", (err) => {
      console.error("[wave-daemon] Socket error:", err.message);
    });
  }

  protected writeLine(message: string): void {
    this.socket.write(message);
  }

  dispose(): void {
    this.handleClosed("Remote connection closed.");
    this.socket.destroy();
  }
}
