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

// ── Method / notification lists ────────────────────────────────
// Declared once, in the SDK (`src/types/stdioProtocol.ts`), because the RPC
// client lives there too and both sides of the wire must read the same union.
// Re-exported here so this package has one module to import from.
//
// The compiler — not a source-scanning test — is what keeps them honest: the
// bridge's `default:` branch is `never`-checked, and `emit` / `RpcClient` are
// typed with these unions, so a method added on one side without the other does
// not build.
export type {
  ClientNotificationMethod,
  RequestMethod,
  ServerNotificationMethod,
} from "wave-agent-sdk";

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
