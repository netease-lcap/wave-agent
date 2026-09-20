/**
 * Host-side stdio RPC layer shared by the VS Code extension and the desktop
 * app: a typed StdioAgent wrapper (mirrors the CLI Agent API over JSON-RPC)
 * plus the sessionId-demultiplexing NotificationRouter.
 *
 * Re-exported by the `wave-agent-sdk/host` entry — import it from there. It has
 * no subpath of its own: the RPC layer is only reachable through `/host`, so a
 * host cannot pick it up by accident while reaching for a shared literal.
 */

export * from "./rpcClient.js";
export * from "./notificationRouter.js";
export * from "./stdioAgent.js";
