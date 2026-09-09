/**
 * Host-side stdio RPC layer shared by the VS Code extension and the desktop
 * app: a typed StdioAgent wrapper (mirrors the CLI Agent API over JSON-RPC)
 * plus the sessionId-demultiplexing NotificationRouter.
 *
 * Import via the `wave-agent-sdk/stdio` subpath.
 */

export * from "./rpcClient.js";
export * from "./notificationRouter.js";
export * from "./stdioAgent.js";
