/**
 * Error serialization for logging
 *
 * `JSON.stringify` renders an `Error` as `{}` — `name`, `message`, `code` and
 * especially the `cause` chain (where undici/node keep the real network
 * failure, e.g. `CERT_HAS_EXPIRED`) are all non-enumerable or prototype-level.
 * Passing a raw `Error` inside a log payload therefore writes an empty object
 * and destroys the only clue about what actually failed.
 *
 * `serializeError` turns a thrown value into a plain, JSON-safe object so hosts
 * that stringify their log payload get the full picture.
 */

/** Maximum depth of the `cause` chain to expand before truncating. */
const MAX_CAUSE_DEPTH = 8;

const CAUSE_TRUNCATED = "[truncated]";

/**
 * Plain, JSON-safe view of an error.
 * `cause` is expanded recursively for Error causes, and kept as its string
 * summary for anything else.
 */
export interface SerializedError {
  name: string;
  message: string;
  code?: string;
  errno?: number;
  syscall?: string;
  status?: number;
  cause?: SerializedError | string;
}

/** Summarize a non-Error thrown value (string, plain object, null, ...). */
function summarizeNonError(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    const json = JSON.stringify(value);
    if (json !== undefined) return json;
  } catch {
    // Circular or otherwise non-serializable value — fall back to String().
  }
  return String(value);
}

function serializeErrorAtDepth(error: Error, depth: number): SerializedError {
  const result: SerializedError = { name: error.name, message: error.message };

  const { code, errno, syscall, status, cause } = error as Error & {
    code?: unknown;
    errno?: unknown;
    syscall?: unknown;
    status?: unknown;
    cause?: unknown;
  };
  if (typeof code === "string") result.code = code;
  if (typeof errno === "number") result.errno = errno;
  if (typeof syscall === "string") result.syscall = syscall;
  if (typeof status === "number") result.status = status;

  if (cause !== undefined) {
    if (depth >= MAX_CAUSE_DEPTH) {
      result.cause = CAUSE_TRUNCATED;
    } else if (cause instanceof Error) {
      result.cause = serializeErrorAtDepth(cause, depth + 1);
    } else {
      result.cause = summarizeNonError(cause);
    }
  }

  return result;
}

/**
 * Convert a thrown value into a plain object that survives `JSON.stringify`,
 * keeping the `cause` chain that holds the actual failure.
 *
 * @example
 * ```ts
 * logger.warn("request failed", { error: serializeError(e) });
 * // {"error":{"name":"TypeError","message":"fetch failed","cause":{"code":"CERT_HAS_EXPIRED"}}}
 * ```
 */
export function serializeError(error: unknown): SerializedError {
  return error instanceof Error
    ? serializeErrorAtDepth(error, 0)
    : { name: "NonError", message: summarizeNonError(error) };
}

/**
 * `JSON.stringify` replacer that renders **nested** `Error` values through
 * `serializeError` instead of dropping them to `{}`.
 *
 * Log sinks receive payloads like `{ error: e }`, where the `Error` sits inside
 * a plain object — the sink's own `arg instanceof Error` check never sees it.
 * Pass this replacer wherever a log payload is stringified:
 *
 * @example
 * ```ts
 * JSON.stringify({ error: e }, errorReplacer);
 * ```
 */
export function errorReplacer(_key: string, value: unknown): unknown {
  return value instanceof Error ? serializeError(value) : value;
}
