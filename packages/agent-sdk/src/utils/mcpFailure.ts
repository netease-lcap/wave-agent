/**
 * Why an MCP dial produced nothing — as a stable, closed set — plus the
 * summary that is safe to put in telemetry.
 *
 * Two problems this solves (both visible in the field as one opaque
 * `MCP server X failed to connect`):
 *
 * - The manager's dial used to collapse every failure into a boolean, so the
 *   reason it already had (`updateServerStatus({status: 'error', error})`, which
 *   the settings panel shows) never reached the reporting call site.
 * - A raw `error.message` can carry an absolute path, a URL with a token in its
 *   query, or a `Bearer …` header pasted in by a server's response body. That
 *   must not leave the process (spec enterprise/opentelemetry.md 属性面).
 *
 * The reason list is deliberately short. Claude Code 2.1.331 has a ~40-value
 * `errorCode` vocabulary plus a message hash channel (`2990:7476-7535`); we only
 * need monitoring to separate "the command does not exist" from "the server
 * rejected our auth" from "it answered but its tool list failed", so the same
 * handful of values covers every branch this code can reach.
 */

/** What a failed dial failed on. Reported as `mcp_failure_reason`. */
export type McpFailureReason =
  /** The executable could not be started (ENOENT / EACCES / EPERM). */
  | "spawn"
  /** A connection or handshake that gave up on a timer the SDK already had. */
  | "timeout"
  /** The server answered and refused us (401 / 403). */
  | "auth"
  /** Handshake-level protocol problem: version mismatch, invalid initialize reply. */
  | "protocol"
  /**
   * The channel was closed before the handshake finished — in practice the
   * server process exited right after being spawned (wrong args, missing env,
   * a crash on startup). Its own bucket because it is the most common real
   * failure and files nothing like a rejected token or a bad config.
   */
  | "closed"
  /** Our own validation of the config: unknown type, missing command/url, unparsable URL. */
  | "config"
  /** The handshake succeeded but `listTools()` failed. */
  | "list_tools"
  /** Anything else — the SDK error did not land in a bucket above. */
  | "other";

/** How far the dial got before it failed; `list_tools` is the interesting one. */
export type McpDialStage = "connect" | "list_tools";

/**
 * A config problem this repo detected itself (unknown `type`, missing
 * `command`/`url`).
 *
 * Its own class rather than a bare `Error` so classification is structural
 * instead of a message match — and so `error_type` says something more useful
 * than `Error`.
 */
export class McpConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "McpConfigError";
  }
}

/** Upper bound on the failure summary handed to telemetry. */
export const MCP_FAILURE_MESSAGE_LIMIT = 200;

/** Spawn failures `cross-spawn` reports through `error.code`. */
const SPAWN_ERROR_CODES = new Set(["ENOENT", "EACCES", "EPERM"]);

/** `McpError` codes that mean "the peer spoke JSON-RPC wrong" (-32700…-32600). */
function isJsonRpcErrorCode(code: number): boolean {
  return code >= -32700 && code <= -32600;
}

function codeOf(error: unknown): unknown {
  if (typeof error !== "object" || error === null) return undefined;
  return (error as { code?: unknown }).code;
}

function nameOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const name = (error as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

export function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : String(error);
}

/**
 * Bucket a failed dial.
 *
 * `stage` is the only thing that separates `list_tools` from the rest: the
 * handshake already succeeded at that point, which is a different situation
 * from "we never reached the server" and worth telling apart in monitoring.
 * It has to be passed in because no property of the thrown error says it.
 */
export function classifyMcpFailure(
  error: unknown,
  stage: McpDialStage = "connect",
): McpFailureReason {
  if (stage === "list_tools") return "list_tools";

  const message = messageOf(error);
  const code = codeOf(error);

  // Config problems are ours, and structural — no message guessing needed.
  if (error instanceof McpConfigError) return "config";
  // `new URL(str)` throws a TypeError with `Invalid URL` for a url field that
  // does not parse; that is a config problem, not a network one.
  if (error instanceof TypeError && /\binvalid url\b/i.test(message)) {
    return "config";
  }

  if (
    code === 401 ||
    code === 403 ||
    nameOf(error) === "UnauthorizedError" ||
    /\(HTTP 40[13]\)/.test(message)
  ) {
    return "auth";
  }

  if (typeof code === "string" && SPAWN_ERROR_CODES.has(code)) return "spawn";
  // `spawn npx ENOENT` — cross-spawn keeps the code on the error, but a wrapped
  // error on Windows can arrive with the message alone.
  if (/\b(ENOENT|EACCES|EPERM)\b/.test(message) && /\bspawn\b/i.test(message)) {
    return "spawn";
  }

  if (
    code === -32001 || // McpError.RequestTimeout
    code === "ETIMEDOUT" ||
    /timed out|timeout/i.test(message)
  ) {
    return "timeout";
  }

  // `McpError.ConnectionClosed` (-32000): the peer stopped answering before the
  // handshake completed. Verified on a real machine with a server script that
  // calls `process.exit(1)` immediately.
  if (code === -32000 || /connection closed/i.test(message)) return "closed";

  if (typeof code === "number" && isJsonRpcErrorCode(code)) {
    return "protocol";
  }
  if (
    /protocol version/i.test(message) ||
    /unexpected content type/i.test(message)
  ) {
    return "protocol";
  }

  return "other";
}

/**
 * Turn an error into a one-line summary that carries no customer paths and no
 * credentials.
 *
 * Kept deliberately crude — a regex, not a parser — because it runs on an
 * arbitrary string:
 *
 * 1. Newlines collapse, so a multi-line HTTP body stays one attribute.
 * 2. The session workdir is replaced by `<workdir>` and the home directory by
 *    `~`. The dial's own cwd is a plain path with no diagnostic value in it.
 * 3. URLs keep scheme/host/path: userinfo and the query string are where tokens
 *    live (`?access_token=…`, `https://user:pass@host`).
 * 4. `Bearer …` tokens are masked, in case a server echoed a header back.
 * 5. The result is truncated. The full original stays in the local log
 *    (`logger?.error` at the dial site) — telemetry is not the place to debug
 *    from.
 */
export function sanitizeMcpFailureMessage(
  error: unknown,
  options: { workdir?: string; homeDir?: string } = {},
): string {
  let text = messageOf(error).replace(/\s+/g, " ").trim();

  for (const [value, placeholder] of [
    [options.workdir, "<workdir>"],
    [options.homeDir, "~"],
  ] as const) {
    if (!value || value.length < 2) continue;
    // The same directory may reach us with either separator, in either
    // direction: a config written on one platform and read on another, or (on
    // Windows) a POSIX-style home like `/tmp` joined by `path.win32` into
    // `\tmp`. Matching only the value's own spelling would leak the path into
    // telemetry in exactly those cases.
    const forms = new Set([
      value,
      value.replace(/\\/g, "/"),
      value.replace(/\//g, "\\"),
    ]);
    for (const form of forms) {
      if (form.length < 2) continue;
      text = text.split(form).join(placeholder);
    }
  }

  text = text.replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]+/gi, redactUrl);
  text = text.replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>");

  return text.length <= MCP_FAILURE_MESSAGE_LIMIT
    ? text
    : `${text.slice(0, MCP_FAILURE_MESSAGE_LIMIT)}…`;
}

/** Drop userinfo, query and fragment; keep enough of the URL to recognise it. */
function redactUrl(raw: string): string {
  try {
    const url = new URL(raw);
    return `${url.origin}${url.pathname}`;
  } catch {
    // Not a URL the platform understands. Still strip the parts that carry
    // credentials rather than passing them through untouched.
    return raw
      .replace(/\/\/[^/@]*@/, "//<redacted>@")
      .split("?")[0]
      .split("#")[0];
  }
}
