import { test, expect, vi, afterEach } from 'vitest';
import { createServer, connect, type Server, type Socket } from 'net';
import { createInterface } from 'readline';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { SocketClient } from '../src/main/stdio/socketClient';

// Mock process.stderr.write to suppress noise
const stderrWriteSpy = vi
  .spyOn(process.stderr, 'write')
  .mockImplementation(() => true);

/** Minimal JSON-RPC server; replies result:params unless `reply` is given. */
function startServer(
  socketPath: string,
  onMessage?: (msg: { id?: number; params?: unknown }) => void,
  reply?: (msg: { id: number; params?: unknown }) => unknown,
) {
  const sockets: Socket[] = [];
  const server: Server = createServer((socket) => {
    sockets.push(socket);
    socket.on('error', () => {
      // The client RSTs on dispose when a reply is still in flight — expected.
    });
    const rl = createInterface({ input: socket });
    // readline re-emits socket errors on the Interface; the socket-level
    // handler above already covers them, swallow here.
    rl.on('error', () => {});
    rl.on('line', (line: string) => {
      if (!line.trim()) return;
      const msg = JSON.parse(line);
      onMessage?.(msg);
      if (msg.id !== undefined) {
        // reply() returns the full body: {result} or {error}.
        socket.write(
          JSON.stringify({ id: msg.id, ...(reply ? reply(msg) : { result: msg.params }) }) + '\n',
        );
      }
    });
  });
  server.listen(socketPath);
  return {
    server,
    push(message: unknown) {
      for (const s of sockets) s.write(JSON.stringify(message) + '\n');
    },
    close() {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

async function connectClient(socketPath: string): Promise<SocketClient> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const sock = connect(socketPath);
    sock.once('connect', () => resolve(sock));
    sock.once('error', reject);
  });
  return new SocketClient(socket);
}

const socketPath = path.join(
  os.tmpdir(),
  `wave-socket-client-test-${process.pid}-${Date.now()}.sock`,
);
let server: ReturnType<typeof startServer>;

afterEach(() => {
  stderrWriteSpy.mockRestore();
  server?.close();
  try {
    fs.unlinkSync(socketPath);
  } catch {
    // already gone
  }
});

test('request resolves with the server result (round-trip)', async () => {
  server = startServer(socketPath);
  const client = await connectClient(socketPath);
  const result = await client.request('echo', { hello: 'world' });
  expect(result).toEqual({ hello: 'world' });
  client.dispose();
});

test('request rejects when the server responds with an error', async () => {
  server = startServer(
    socketPath,
    undefined,
    () => ({ error: { code: -32601, message: 'method not found' } }),
  );
  const client = await connectClient(socketPath);
  await expect(client.request('nope')).rejects.toThrow('method not found');
  client.dispose();
});

test('notifications from the server dispatch to registered handlers', async () => {
  server = startServer(socketPath);
  const client = await connectClient(socketPath);
  const handler = vi.fn();
  client.onNotification('permissionRequest', handler);
  server.push({
    method: 'permissionRequest',
    params: { toolName: 'Bash' },
    sessionId: 'sess-1',
  });
  await vi.waitFor(() => {
    expect(handler).toHaveBeenCalledWith({ toolName: 'Bash' }, 'sess-1');
  });
  client.dispose();
});

test('notify writes a notification to the server', async () => {
  const seen: unknown[] = [];
  server = startServer(socketPath, (msg) => seen.push(msg));
  const client = await connectClient(socketPath);
  client.notify('permissionResponse', { requestId: 'r1' });
  await vi.waitFor(() => {
    expect(seen).toEqual([{ method: 'permissionResponse', params: { requestId: 'r1' } }]);
  });
  client.dispose();
});

test('pending request rejects when the server closes the connection', async () => {
  server = startServer(socketPath);
  const client = await connectClient(socketPath);
  const pending = client.request('echo', { x: 1 });
  server.close(); // destroys server-side sockets → client 'close' fires
  await expect(pending).rejects.toThrow('远端连接已断开');
  client.dispose();
});

test('dispose rejects pending requests and destroys the socket', async () => {
  server = startServer(socketPath);
  const client = await connectClient(socketPath);
  const pending = client.request('echo', { x: 1 });
  client.dispose();
  await expect(pending).rejects.toThrow('远端连接已断开');
  // A second dispose is a no-op (handleClosed idempotent).
  client.dispose();
});
