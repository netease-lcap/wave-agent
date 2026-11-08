/**
 * Shared model-endpoint transport.
 *
 * Every wire protocol Wave speaks (`/chat/completions`, `/responses`,
 * `/messages`) is a `POST` of a JSON body to `${baseURL}${path}` whose response
 * is either a JSON document or a `data:`-framed SSE stream. Only the payloads
 * inside differ, so the retry loop, auth headers and SSE reader live here once
 * and the per-protocol clients only supply a path and a response type.
 *
 * Transport-owned request fields: `model` (for retry logging) and `stream`
 * (shapes the return value). Everything else is passed through untouched.
 */

import { logger } from "./globalLogger.js";
import { serializeError } from "./errorUtils.js";

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 32000;

/** The subset of `GatewayConfig` the transport reads. */
export interface TransportConfig {
  apiKey?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  fetchOptions?: unknown;
  fetch?: unknown;
  sessionId?: string;
}

/**
 * What a request body may carry that the transport itself reads: the model name
 * (for retry logging) and `stream` (shapes the return value). Everything else is
 * passed through to the endpoint untouched.
 */
export interface RequestBody {
  model?: string;
  stream?: boolean;
  [key: string]: unknown;
}

export interface APIResponse<T> {
  data: T;
  response: Response;
}

export interface APIPromise<T> extends Promise<T> {
  withResponse(): Promise<APIResponse<T>>;
}

export interface PostOptions {
  /** Abort signal forwarded to `fetch`. */
  signal?: AbortSignal;
  /** Whether the caller expects an SSE body (`true` yields an async iterable). */
  stream?: boolean;
  /**
   * Protocol headers merged after `defaultHeaders` — the Messages endpoint
   * needs `anthropic-version` and `x-api-key`, Chat Completions needs neither.
   */
  headers?: Record<string, string>;
  /**
   * Prefix for retry/error log lines. Defaults to `"OpenAI API"` so the log
   * corpus for the existing endpoints is unchanged.
   */
  logLabel?: string;
}

function getRetryDelay(
  attempt: number,
  retryAfterHeader: string | null,
): number {
  if (retryAfterHeader) {
    const seconds = parseInt(retryAfterHeader, 10);
    if (!isNaN(seconds)) {
      return seconds * 1000;
    }
  }
  const baseDelay = Math.min(
    BASE_DELAY_MS * Math.pow(2, attempt - 1),
    MAX_DELAY_MS,
  );
  const jitter = Math.random() * 0.25 * baseDelay;
  return baseDelay + jitter;
}

/**
 * Wrap a transport promise in the SDK-shaped `APIPromise`: awaiting it yields
 * the body, `withResponse()` yields the body plus headers.
 */
export function toAPIPromise<T>(
  responsePromise: Promise<APIResponse<unknown>>,
): APIPromise<T> {
  const promise = responsePromise.then(
    (res) => res.data,
  ) as unknown as Promise<T> & {
    withResponse?: () => Promise<APIResponse<T>>;
  };
  promise.withResponse = () => responsePromise as Promise<APIResponse<T>>;
  const apiPromise = promise as APIPromise<T>;
  // Prevent unhandled rejection if only withResponse() is used
  apiPromise.catch((e) => {
    if (!(e instanceof Error && e.name === "AbortError")) {
      logger.error("Unhandled OpenAI promise rejection:", e);
    }
  });
  return apiPromise;
}

/**
 * POST a model request, retrying 429/5xx and network failures with exponential
 * backoff (honouring `retry-after`). Only the phase before response headers
 * arrive is retried — a body that dies mid-stream is the caller's problem, and
 * every caller answers it with a non-streaming re-issue.
 */
export async function postModelEndpoint(
  config: TransportConfig,
  path: string,
  params: RequestBody,
  options: PostOptions = {},
): Promise<APIResponse<unknown>> {
  const {
    baseURL,
    apiKey,
    sessionId,
    defaultHeaders,
    fetchOptions,
    fetch: customFetch,
  } = config;
  const logLabel = options.logLabel ?? "OpenAI API";
  const url = `${baseURL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
    ...(sessionId ? { "x-session-id": sessionId } : {}),
    ...defaultHeaders,
    ...options.headers,
  };

  const fetchFn = (customFetch as typeof fetch) || fetch;
  let lastError: (Error & { status?: number; body?: unknown }) | undefined;
  let lastRetryAfter: string | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) {
      const delay = getRetryDelay(attempt, lastRetryAfter);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }

    let response: Response;
    try {
      response = await fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
        signal: options.signal,
        ...(fetchOptions as RequestInit),
      });
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        throw e;
      }
      if (attempt < MAX_RETRIES) {
        logger.warn(`${logLabel} network error, retrying...`, {
          model: params.model,
          attempt: attempt + 1,
          error: serializeError(e),
        });
        lastError = e as Error;
        lastRetryAfter = null;
        continue;
      }
      throw e;
    }

    if (response.ok) {
      if (options.stream) {
        return { data: streamSSE(response), response };
      }
      const data = await response.json();
      return { data, response };
    }

    let responseText = "";
    try {
      responseText = await response.text();
    } catch (e) {
      logger.error("Failed to read error response text", {
        error: serializeError(e),
      });
    }

    const error = new Error(
      `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}: ${responseText}`,
    ) as Error & {
      status?: number;
      body?: unknown;
      /**
       * 非 2xx 的响应头。额度读数（`x-codechat-quota-*`）在 402 阻断、上游
       * 429/5xx 上与成功响应同值——「被拦下」这一刻正是用户最需要看到读数的
       * 时刻，所以错误也必须把头带出去（spec: desktop/desktop-account.md
       * 「额度响应头」、`utils/quotaHeaders.ts` 的 `quotaHeadersFromError`）。
       */
      headers?: Headers;
    };
    error.status = response.status;
    error.body = responseText;
    error.headers = response.headers;

    const retryableStatus =
      response.status === 429 ||
      (response.status >= 500 && response.status !== 501);
    if (retryableStatus && attempt < MAX_RETRIES) {
      lastRetryAfter = response.headers.get("retry-after");
      logger.warn(`${logLabel} error, retrying...`, {
        model: params.model,
        attempt: attempt + 1,
        status: response.status,
        retryAfter: lastRetryAfter,
      });
      lastError = error;
      continue;
    }

    logger.error(`${logLabel} Error:`, {
      status: response.status,
      statusText: response.statusText,
      body: responseText,
    });
    throw error;
  }
  throw lastError;
}

/**
 * Read a `data:`-framed SSE body. Every endpoint Wave speaks streams in this
 * envelope — the event name, where a protocol has one, is also a `type` field
 * inside the JSON payload (Anthropic Messages does exactly this), so the parser
 * stays protocol-agnostic and the callers cast.
 */
export async function* streamSSE(response: Response): AsyncIterable<unknown> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine || !trimmedLine.startsWith("data:")) continue;

        const data = trimmedLine.slice(5).trim();
        if (data === "[DONE]") return;
        if (!data) continue; // Skip empty data lines (keepalive heartbeats)

        try {
          const json = JSON.parse(data);
          yield json;
        } catch (e) {
          logger.error("Failed to parse stream chunk", {
            error: e instanceof Error ? e.message : String(e),
            data,
          });
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
