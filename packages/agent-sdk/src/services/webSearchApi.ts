/**
 * 内置联网搜索工具的接口（上游契约冻结在 codechat `docs/specs/web-search.md`）。
 *
 * 一条 POST `{serverUrl}/api/v1/web-search`，请求 `{query, allowed_domains?, blocked_domains?}`
 * （两组互斥），200 返回 `{query, results: [{tool_use_id, content: [{title, url, snippet?}]}],
 * durationSeconds, searchCount, leftOut}`。`results` 恒为长度 1 的数组，
 * `content: []` 是「搜了但没命中」——那是 `ok`，不是错误。
 *
 * 三件事刻意放在这一层，不散到工具里：
 *
 * - **鉴权**只用 `createAuthAwareFetch`（登录态 + 惰性刷新，与 kb / artifact 同一条路），
 *   不新建凭证类型、不加配置项。
 * - **状态码 → 一句模型能懂的话**。契约里 400/404/429/502/503/504 各有含义，把失败伪装成
 *   空结果是最容易诱发幻觉的形态，所以 `unsupported`（404，本部署没这个能力）与
 *   `unauthorized`（401/403）单列，其余都带一句可行动的话。
 * - **重试口径照 `knowledgeBaseApi`**：网络错误与 503 各重试 1 次、间隔 300ms。
 *   400（改参数才有用）、429（按小时计的额度，等也没用）、502（重试会再计一次上游费用）、
 *   504（超时无法证明上游没执行，契约也明确不重试）、404（能力不存在）都不重试。
 *
 * 客户端超时 15 秒：宽于服务端的 10 秒，让服务端先超时（它能给 `504 WEB_SEARCH_TIMEOUT`，
 * 比客户端一律 `ETIMEDOUT` 更有信息量）。
 */
import { authService, createAuthAwareFetch } from "./authService.js";
import { logger } from "../utils/globalLogger.js";

const WEB_SEARCH_TIMEOUT_MS = 15_000;
/** One retry, matching `knowledgeBaseApi`'s `KB_RETRY_DELAY_MS`. */
const RETRY_DELAY_MS = 300;
/** Server messages are quoted back to the model; keep one from flooding the context. */
const MAX_SERVER_MESSAGE_CHARS = 300;

/** One hit as the model may use it: a link, plus a snippet it never sees (see the tool). */
export interface WebSearchHit {
  title: string;
  url: string;
  /** Page text from the provider (`≤200` chars by contract). Host UI / hooks only. */
  snippet?: string;
}

/** A successful search, normalized from the contract's response body. */
export interface WebSearchResponse {
  /** Echo of the query the caller asked for (the server echoes its own original). */
  query: string;
  results: WebSearchHit[];
  /** Hits the server dropped by the domain lists; 0 when none were filtered. */
  leftOut: number;
  /** Server-side wall clock, carried for the host card only. */
  durationSeconds?: number;
  /** Always 1 by contract; passed through, never interpreted. */
  searchCount?: number;
}

/**
 * What one call to the endpoint came back as.
 *
 * `unsupported` is the 404 of "this deployment does not have the capability" (the
 * server's switch is off) — a property of the deployment, not a transient failure,
 * and the caller must remember it rather than probe again
 * (`services/webSearchAvailability.ts`). `unauthorized` is the ordinary "this
 * account cannot search" answer, which the model phrases instead of retrying.
 */
export type WebSearchOutcome =
  | { kind: "ok"; value: WebSearchResponse }
  | { kind: "unsupported" }
  | { kind: "unauthorized"; reason: string; errorCode?: string }
  | { kind: "error"; reason: string; errorCode?: string };

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Trimmed string, or "" — the contract's fields are trusted as far as types go, no further. */
function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** `: <server message>` — the server's own wording, when it sent one. */
function quoted(message: string): string {
  if (!message) return "";
  const body =
    message.length > MAX_SERVER_MESSAGE_CHARS
      ? `${message.slice(0, MAX_SERVER_MESSAGE_CHARS)}…`
      : message;
  return `: ${body}`;
}

/**
 * One sentence per contract error code, in the same voice as the success text
 * (Claude Code's `WebSearch` result is English too). Each says what to do next,
 * because "search failed" leaves the model guessing between "rephrase" and "give
 * up"; the codes that mean "do not retry" say so explicitly.
 */
function describeServerError(
  status: number,
  code: string | undefined,
  message: string,
): string {
  const tail = quoted(message);
  switch (code) {
    case "WEB_SEARCH_INVALID_QUERY":
      return `the search query was rejected (${code})${tail} — rephrase it before searching again; retrying it unchanged fails the same way.`;
    case "WEB_SEARCH_INVALID_DOMAINS":
      return `the domain list was rejected (${code})${tail} — pass plain hostnames such as "example.com" (no scheme, no spaces) before searching again.`;
    case "WEB_SEARCH_DOMAIN_CONFLICT":
      return `allowed_domains and blocked_domains cannot be used in the same request (${code})${tail}.`;
    case "WEB_SEARCH_RATE_LIMITED":
      return `this hour's web-search quota is used up (${code})${tail} — tell the user to try again later this hour instead of retrying now.`;
    case "WEB_SEARCH_UPSTREAM_REJECTED":
      return `the search provider rejected this request (${code})${tail} — rephrasing the query may help.`;
    case "UPSTREAM_BODY_MALFORMED":
      return `the search provider returned a malformed response (${code})${tail} — the results cannot be trusted, so search again later rather than answering from them.`;
    case "WEB_SEARCH_UNAVAILABLE":
      return `web search is temporarily unavailable on this server (${code})${tail} — try again later.`;
    case "WEB_SEARCH_UPSTREAM_BUSY":
      return `the search provider is busy right now (${code})${tail} — try again shortly.`;
    case "WEB_SEARCH_TIMEOUT":
      return `the search timed out (${code})${tail} — a narrower query, or a retry later, may succeed.`;
    default:
      return `web search failed (HTTP ${status}${code ? ` ${code}` : ""})${tail}.`;
  }
}

/** 401 / 403's one-liner: the account half (the license half for private deployments). */
function describeAuthError(
  status: number,
  code: string | undefined,
  message: string,
): string {
  const tail = quoted(message);
  if (status === 401) {
    return `the account is not signed in, or the session expired${tail} — ask the user to run /login, then search again.`;
  }
  if (code?.startsWith("LICENSE_")) {
    return `this deployment's license does not allow web search (${code})${tail} — this is for an administrator, not something a retry can fix.`;
  }
  return `this account may not use web search (${code ? `${code}` : `HTTP ${status}`})${tail} — enterprise membership, or an admin switch, is missing.`;
}

/** `{ error: { code, message } }` → its two fields, tolerantly. */
function readErrorBody(body: unknown): { code?: string; message: string } {
  const error = asRecord(asRecord(body)?.error);
  return { code: str(error?.code) || undefined, message: str(error?.message) };
}

/**
 * 200's body → hits. A `results` that is not an array is malformed (never "no
 * results"): treating a broken body as an empty search is exactly the silent lie
 * the contract's `UPSTREAM_BODY_MALFORMED` exists to prevent.
 */
function readResponse(body: unknown, query: string): WebSearchOutcome {
  const data = asRecord(body);
  const blocks = data?.results;
  if (!Array.isArray(blocks)) {
    logger?.warn("Web search response was malformed", {
      queryLength: query.length,
    });
    return {
      kind: "error",
      reason:
        'the server response was malformed: no results array — do not treat this as "no results found".',
    };
  }

  const results: WebSearchHit[] = [];
  for (const block of blocks) {
    const content = asRecord(block)?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content) {
      const hit = asRecord(item);
      const url = str(hit?.url);
      // Without a URL the hit is not a source the model can cite or open.
      if (!url) continue;
      const snippet = str(hit?.snippet);
      results.push({
        title: str(hit?.title) || url,
        url,
        ...(snippet ? { snippet } : {}),
      });
    }
  }

  const leftOut = data?.leftOut;
  const durationSeconds = data?.durationSeconds;
  const searchCount = data?.searchCount;
  return {
    kind: "ok",
    value: {
      query: str(data?.query) || query,
      results,
      leftOut:
        typeof leftOut === "number" && Number.isFinite(leftOut) && leftOut > 0
          ? leftOut
          : 0,
      ...(typeof durationSeconds === "number" &&
      Number.isFinite(durationSeconds)
        ? { durationSeconds }
        : {}),
      ...(typeof searchCount === "number" && Number.isFinite(searchCount)
        ? { searchCount }
        : {}),
    },
  };
}

/**
 * Whether a failed attempt is worth one more.
 *
 * `undefined` means "no response at all" (a network error) — the one case where a
 * second attempt can plausibly work. Among status codes only `503` qualifies:
 * 502 has already spent an upstream call and cannot turn a malformed body into a
 * good one, 504 may already have been billed (the contract forbids retrying a
 * timeout), 429 is an hourly quota and 400 needs different arguments.
 */
function isRetryable(status: number | undefined): boolean {
  return status === undefined || status === 503;
}

/** One search round trip, with the retry policy above. */
export async function searchWeb(
  args: {
    query: string;
    allowedDomains?: string[];
    blockedDomains?: string[];
  },
  opts: { abortSignal?: AbortSignal } = {},
): Promise<WebSearchOutcome> {
  const serverUrl = authService.getServerUrl();
  const authFetch = createAuthAwareFetch(globalThis.fetch);
  const timeoutSignal = AbortSignal.timeout(WEB_SEARCH_TIMEOUT_MS);
  const signal = opts.abortSignal
    ? AbortSignal.any([opts.abortSignal, timeoutSignal])
    : timeoutSignal;

  const body: Record<string, unknown> = { query: args.query };
  // The two lists are mutually exclusive by contract; an empty one is "not given".
  if (args.allowedDomains?.length) body.allowed_domains = args.allowedDomains;
  if (args.blockedDomains?.length) body.blocked_domains = args.blockedDomains;

  let res: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await authFetch(`${serverUrl}/api/v1/web-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (opts.abortSignal?.aborted) {
        return { kind: "error", reason: "the search was cancelled." };
      }
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError") {
        // The contract forbids retrying a timeout: it cannot prove the upstream
        // did not run, and a completed search is billable.
        logger?.warn("Web search timed out on the client", {
          queryLength: args.query.length,
          timeoutMs: WEB_SEARCH_TIMEOUT_MS,
        });
        return {
          kind: "error",
          errorCode: "CLIENT_TIMEOUT",
          reason: `the search did not answer within ${WEB_SEARCH_TIMEOUT_MS / 1000} seconds and was abandoned — say so rather than treating it as "no results".`,
        };
      }
      if (attempt === 0) {
        await delay(RETRY_DELAY_MS);
        continue;
      }
      logger?.warn("Web search request failed", {
        queryLength: args.query.length,
        error: String(error),
      });
      return {
        kind: "error",
        reason: `could not reach the server: ${error instanceof Error ? error.message : String(error)}`,
      };
    }

    // 404 is the deployment's answer, not this request's: no retry, no probing.
    if (res.status === 404) return { kind: "unsupported" };

    if (isRetryable(res.status) && attempt === 0) {
      await delay(RETRY_DELAY_MS);
      continue;
    }
    break;
  }

  if (!res) {
    return { kind: "error", reason: "could not reach the server." };
  }
  if (res.status === 401 || res.status === 403) {
    const failure = readErrorBody(await res.json().catch(() => null));
    return {
      kind: "unauthorized",
      reason: describeAuthError(res.status, failure.code, failure.message),
      errorCode: failure.code,
    };
  }

  if (!res.ok) {
    const failure = readErrorBody(await res.json().catch(() => null));
    logger?.warn("Web search rejected", {
      status: res.status,
      code: failure.code,
      queryLength: args.query.length,
    });
    return {
      kind: "error",
      errorCode: failure.code,
      reason: describeServerError(res.status, failure.code, failure.message),
    };
  }

  return readResponse(await res.json().catch(() => null), args.query);
}
