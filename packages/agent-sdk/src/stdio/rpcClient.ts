/**
 * RpcClient — the structural transport surface StdioAgent + NotificationRouter
 * depend on.
 *
 * Both hosts keep their own transports (vscode's `StdioClient`; desktop's
 * `JsonRpcClient` subclasses `StdioClient` / `SocketClient`); each satisfies
 * this interface structurally (TypeScript), so the shared stdio layer never
 * needs to know which transport backs it.
 */

export type NotificationHandler = (params: unknown, sessionId?: string) => void;

export interface RpcClient {
  /** Send a request; resolves with the JSON-RPC result. */
  request(
    method: string,
    params?: unknown,
    sessionId?: string,
  ): Promise<unknown>;

  /** Fire-and-forget JSON-RPC notification (no response expected). */
  notify(method: string, params?: unknown, sessionId?: string): void;

  /** Subscribe to a server→client notification method. */
  onNotification(method: string, handler: NotificationHandler): void;
}
