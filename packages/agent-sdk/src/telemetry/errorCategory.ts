/**
 * Low-cardinality classification of client-side failures.
 *
 * The `error` event carries this as `error.category`, so a monitoring backend
 * can bucket failures straight into a counter or a log query. The two fields we
 * already had cannot do that job: `message` is free text (unbounded cardinality)
 * and `error_type` is the error class name, which for everything Wave throws
 * itself is the same string — `Error`. See spec
 * `enterprise/opentelemetry.md`「事件级别与错误的可监控性」.
 *
 * The value set is **closed**: an unrecognized failure is `unknown`, never a new
 * label, so a one-off error cannot grow a series nobody reads.
 */

/** Categories `error.category` can take. Adding one is a spec change. */
export type ErrorCategory =
  | "network"
  | "timeout"
  | "auth"
  | "rate_limit"
  | "server"
  | "invalid_request"
  | "config"
  | "persist"
  | "mcp"
  | "tool"
  | "unknown";

/**
 * Local write failures: the transcript could not be written. Deliberately not
 * including `ENOENT` as a code — a missing path is only a persistence failure
 * when the message says so (see `PERSIST_PATTERNS`), otherwise it is some other
 * lookup that happened to fail.
 */
const PERSIST_CODES = new Set([
  "ENOSPC",
  "EDQUOT",
  "EACCES",
  "EROFS",
  "EPERM",
  "EISDIR",
  "EMFILE",
  "ENFILE",
]);

/** The transcript is gone or unwritable — the write path has no fallback. */
const PERSIST_PATTERNS = [
  /session file not found/i,
  /failed to save (?:the )?session/i,
  /cannot (?:write|append) (?:to )?(?:the )?session/i,
];

/** Node/undici codes meaning "the request never got a real reply". */
const NETWORK_CODES = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  // TLS: a certificate the runtime refuses is still a transport-level failure.
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
]);

const TIMEOUT_CODES = new Set([
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
]);

/** Local misconfiguration: no model, no credential — not an upstream failure. */
const CONFIG_PATTERNS = [
  /requires model/i,
  /no (?:available |supported )?model/i,
  /model (?:is )?not (?:configured|selected|found)/i,
  /missing (?:api key|api_key|access token|credential)/i,
  /(?:api key|apikey|access token|credential)s? (?:is |are )?not (?:configured|set|provided)/i,
];

/** The request was rejected: too big, malformed, or unsupported input. */
const INVALID_REQUEST_PATTERNS = [
  /prompt (?:is )?too long/i,
  /context (?:length|window) (?:exceeded|too (?:long|large))/i,
  /image .*(?:exceed|too large|unsupported|invalid)/i,
  /invalid (?:request|parameter|model name)/i,
];

function readString(error: unknown, key: string): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function readNumber(error: unknown, key: string): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

function matches(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

/**
 * Classify a failure into one of the closed categories. Order is by how much
 * the signal can be trusted: a structured HTTP status first, then the error's
 * type/code, then message text (only for the two families that have no
 * structured form).
 */
export function classifyError(error: unknown): ErrorCategory {
  const status = readNumber(error, "status") ?? readNumber(error, "statusCode");
  if (status !== undefined) {
    if (status === 401 || status === 403) return "auth";
    if (status === 429) return "rate_limit";
    if (status === 408) return "timeout";
    // 529 is an overload flavor of 5xx; both mean "the far side is unwell".
    if (status >= 500) return "server";
    if (status >= 400) return "invalid_request";
  }

  const name = readString(error, "name") ?? "";
  const code = readString(error, "code") ?? "";
  const message = messageOf(error);

  // Local persistence is checked before the transport families: a disk that is
  // full or a directory that drifted out from under us both surface as a plain
  // `Error`, and neither is an upstream problem.
  if (PERSIST_CODES.has(code) || matches(PERSIST_PATTERNS, message)) {
    return "persist";
  }

  // Provider SDKs name these types (`APIConnectionTimeoutError`,
  // `APIConnectionError` — same names in the OpenAI and Anthropic SDKs).
  if (
    /timeout/i.test(name) ||
    TIMEOUT_CODES.has(code) ||
    /timed out|timeout/i.test(message)
  ) {
    return "timeout";
  }
  if (/connection/i.test(name) || NETWORK_CODES.has(code)) return "network";

  if (matches(CONFIG_PATTERNS, message)) return "config";
  if (matches(INVALID_REQUEST_PATTERNS, message)) return "invalid_request";

  return "unknown";
}
