import { test, expect, vi, afterEach } from "vitest";
import {
  createServer,
  connect,
  type AddressInfo,
  type Server,
  type Socket,
} from "net";
import { createInterface } from "readline";
import type { RequestMethod } from "wave-agent-sdk/host";
import { SocketClient } from "../src/main/stdio/socketClient";

/**
 * Minimal JSON-RPC server; replies result:params unless `reply` is given.
 *
 * Listens on TCP loopback rather than a unix socket: some Windows sandboxes
 * reject AF_UNIX / named-pipe bind with EACCES, and SocketClient accepts any
 * net.Socket, so loopback exercises the identical transport path everywhere.
 */
function startServer(
  onMessage?: (msg: { id?: number; params?: unknown }) => void,
  reply?: (msg: { id: number; params?: unknown }) => Record<string, unknown>,
) {
  const sockets: Socket[] = [];
  // Client 'connect' can fire before the server's 'connection' callback on
  // loopback under load; queue pushes until the accept registers a socket.
  const pending: unknown[] = [];
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    for (const m of pending) socket.write(JSON.stringify(m) + "\n");
    pending.length = 0;
    socket.on("error", () => {
      // The client RSTs on dispose when a reply is still in flight — expected.
    });
    const rl = createInterface({ input: socket });
    // readline re-emits socket errors on the Interface; the socket-level
    // handler above already covers them, swallow here.
    rl.on("error", () => {});
    rl.on("line", (line: string) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      onMessage?.(msg);
      if (msg.id !== undefined) {
        // reply() returns the full body: {result} or {error}.
        socket.write(
          JSON.stringify({
            id: msg.id,
            ...(reply ? reply(msg) : { result: msg.params }),
          }) + "\n",
        );
      }
    });
  });
  return new Promise<{
    server: Server;
    port: number;
    push(message: unknown): void;
    close(): void;
  }>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        server,
        port: (server.address() as AddressInfo).port,
        push(message: unknown) {
          const line = JSON.stringify(message) + "\n";
          if (sockets.length > 0) for (const s of sockets) s.write(line);
          else pending.push(message);
        },
        close() {
          for (const s of sockets) s.destroy();
          server.close();
        },
      });
    });
  });
}

/**
 * 本文件测的是传输层：方法名只是线上透传的字符串，不参与任何路由，所以这里
 * 允许任意方法名（宽于 `RequestMethod` 联合），仍然按同一个 `request` 走。
 */
const request = (client: SocketClient, method: string, params?: unknown) =>
  client.request(method as RequestMethod, params);

async function connectClient(port: number): Promise<SocketClient> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const sock = connect(port, "127.0.0.1");
    sock.once("connect", () => resolve(sock));
    sock.once("error", reject);
  });
  return new SocketClient(socket);
}

let server: Awaited<ReturnType<typeof startServer>>;

afterEach(() => {
  server?.close();
});

test("request resolves with the server result (round-trip)", async () => {
  server = await startServer();
  const client = await connectClient(server.port);
  const result = await request(client, "echo", { hello: "world" });
  expect(result).toEqual({ hello: "world" });
  client.dispose();
});

test("request rejects when the server responds with an error", async () => {
  server = await startServer(undefined, () => ({
    error: { code: -32601, message: "method not found" },
  }));
  const client = await connectClient(server.port);
  await expect(request(client, "nope")).rejects.toThrow("method not found");
  client.dispose();
});

test("notifications from the server dispatch to registered handlers", async () => {
  server = await startServer();
  const client = await connectClient(server.port);
  const handler = vi.fn();
  client.onNotification("permissionRequest", handler);
  server.push({
    method: "permissionRequest",
    params: { toolName: "Bash" },
    sessionId: "sess-1",
  });
  await vi.waitFor(() => {
    expect(handler).toHaveBeenCalledWith({ toolName: "Bash" }, "sess-1");
  });
  client.dispose();
});

test("notify writes a notification to the server", async () => {
  const seen: unknown[] = [];
  server = await startServer((msg) => seen.push(msg));
  const client = await connectClient(server.port);
  client.notify("permissionResponse", { requestId: "r1" });
  await vi.waitFor(() => {
    expect(seen).toEqual([
      { method: "permissionResponse", params: { requestId: "r1" } },
    ]);
  });
  client.dispose();
});

test("pending request rejects when the server closes the connection", async () => {
  server = await startServer();
  const client = await connectClient(server.port);
  const pending = request(client, "echo", { x: 1 });
  server.close(); // destroys server-side sockets → client 'close' fires
  await expect(pending).rejects.toThrow("远端连接已断开");
  client.dispose();
});

test("dispose rejects pending requests and destroys the socket", async () => {
  server = await startServer();
  const client = await connectClient(server.port);
  const pending = request(client, "echo", { x: 1 });
  client.dispose();
  await expect(pending).rejects.toThrow("远端连接已断开");
  // A second dispose is a no-op (handleClosed idempotent).
  client.dispose();
});
