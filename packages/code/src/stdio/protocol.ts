/**
 * JSON-RPC 2.0-compatible protocol types for stdio communication.
 *
 * Each line on stdin/stdout is one JSON object.
 * - Requests have `id` (number|string) and expect a response.
 * - Responses match the request `id` with either `result` or `error`.
 * - Notifications have no `id` and expect no response.
 */

// ── Envelope types ──────────────────────────────────────────────

export interface JsonRpcRequest {
  id: number | string;
  method: string;
  params?: unknown;
  /** Session-scoped requests carry sessionId for routing to the right Agent. */
  sessionId?: string;
}

export interface JsonRpcResponse {
  id: number | string | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
  /** Session-scoped notifications carry sessionId for demultiplexing on the client. */
  sessionId?: string;
}

// ── Error codes (JSON-RPC 2.0 standard) ────────────────────────

export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const INTERNAL_ERROR = -32603;

// ── Client → Server request methods ─────────────────────────────

export type RequestMethod =
  | "initialize"
  | "destroy"
  | "restoreSession"
  | "listSessions"
  | "getSessionInfo"
  | "sendMessage"
  | "bang"
  | "abortMessage"
  | "clearMessages"
  | "rewindToMessage"
  | "deleteQueuedMessage"
  | "getMessages"
  | "getFullMessageThread"
  | "setPermissionMode"
  | "getPermissionMode"
  | "getMcpServers"
  | "connectMcpServer"
  | "disconnectMcpServer"
  | "getSlashCommands"
  | "searchFiles"
  | "getPromptHistory"
  | "searchPromptHistory"
  | "updateConfig"
  // Auth
  | "getAuthStatus"
  | "login"
  | "logout"
  // Plugins
  | "listPlugins"
  | "installPlugin"
  | "uninstallPlugin"
  | "enablePlugin"
  | "disablePlugin"
  | "updatePlugin"
  | "listMarketplaces"
  | "addMarketplace"
  | "removeMarketplace"
  | "updateMarketplace";

// ── Client → Server notification methods ────────────────────────

export type ClientNotificationMethod = "permissionResponse";

// ── Server → Client notification methods ────────────────────────

export type ServerNotificationMethod =
  | "messagesChange"
  | "userMessageAdded"
  | "assistantMessageAdded"
  | "assistantContentUpdated"
  | "assistantReasoningUpdated"
  | "toolBlockUpdated"
  | "errorBlockAdded"
  | "loadingChange"
  | "commandRunningChange"
  | "queuedMessagesChange"
  | "tasksChange"
  | "sessionIdChange"
  | "permissionModeChange"
  | "mcpServersChange"
  | "bangMessageAdded"
  | "bangMessageUpdated"
  | "bangMessageCompleted"
  | "notificationMessageAdded"
  | "permissionRequest"
  | "authUrl";

// ── Helper: is this a request (has id)? ─────────────────────────

export function isRequest(msg: unknown): msg is JsonRpcRequest {
  return (
    typeof msg === "object" &&
    msg !== null &&
    "method" in msg &&
    "id" in msg &&
    (typeof (msg as { id: unknown }).id === "number" ||
      typeof (msg as { id: unknown }).id === "string")
  );
}

export function isNotification(msg: unknown): msg is JsonRpcNotification {
  return (
    typeof msg === "object" && msg !== null && "method" in msg && !("id" in msg)
  );
}
