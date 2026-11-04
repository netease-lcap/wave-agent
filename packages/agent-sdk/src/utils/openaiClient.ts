import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionChunk,
  ChatCompletion,
  Responses,
} from "openai/resources.js";
import { GatewayConfig } from "../types/config.js";
import { logger } from "./globalLogger.js";
import { serializeError } from "./errorUtils.js";

const MAX_RETRIES = 10;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 32000;

const CHAT_COMPLETIONS_PATH = "/chat/completions";
/** Responses endpoint — the only one some models accept function tools on. */
const RESPONSES_PATH = "/responses";

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

type CreateParams =
  | ChatCompletionCreateParamsNonStreaming
  | ChatCompletionCreateParamsStreaming;

type CreateResponsesParams =
  | Responses.ResponseCreateParamsNonStreaming
  | Responses.ResponseCreateParamsStreaming;

/**
 * What a request body may carry that the transport itself reads: the model name
 * (for retry logging) and `stream` (shapes the return value). Everything else is
 * passed through to the endpoint untouched.
 */
interface RequestBody {
  model?: string;
  stream?: boolean;
  [key: string]: unknown;
}

interface APIResponse<T> {
  data: T;
  response: Response;
}

interface APIPromise<T> extends Promise<T> {
  withResponse(): Promise<APIResponse<T>>;
}

export class OpenAIClient {
  constructor(private config: GatewayConfig) {}

  get chat() {
    return {
      completions: {
        create: <P extends CreateParams>(
          params: P,
          options?: { signal?: AbortSignal },
        ): APIPromise<
          P extends ChatCompletionCreateParamsStreaming
            ? AsyncIterable<ChatCompletionChunk>
            : ChatCompletion
        > =>
          this.toAPIPromise(
            this._create(
              CHAT_COMPLETIONS_PATH,
              params as unknown as RequestBody,
              options,
            ),
          ),
      },
    };
  }

  /**
   * The Responses API. Same transport as `chat.completions` (retry loop, session
   * header, SSE reader) with a different path and a different response shape —
   * models past GPT-5.4 only accept function tools here (see
   * services/responsesApi.ts for when this endpoint is actually chosen).
   */
  get responses() {
    return {
      create: <P extends CreateResponsesParams>(
        params: P,
        options?: { signal?: AbortSignal },
      ): APIPromise<
        P extends Responses.ResponseCreateParamsStreaming
          ? AsyncIterable<Responses.ResponseStreamEvent>
          : Responses.Response
      > =>
        this.toAPIPromise(
          this._create(
            RESPONSES_PATH,
            params as unknown as RequestBody,
            options,
          ),
        ),
    };
  }

  /**
   * Wrap a transport promise in the SDK-shaped `APIPromise`: awaiting it yields
   * the body, `withResponse()` yields the body plus headers.
   */
  private toAPIPromise<T>(
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

  private async _create(
    path: string,
    params: RequestBody,
    options?: { signal?: AbortSignal },
  ): Promise<APIResponse<unknown>> {
    const {
      baseURL,
      apiKey,
      sessionId,
      defaultHeaders,
      fetchOptions,
      fetch: customFetch,
    } = this.config;
    const url = `${baseURL}${path}`;
    const headers = {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...(sessionId ? { "x-session-id": sessionId } : {}),
      ...defaultHeaders,
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
          signal: options?.signal,
          ...(fetchOptions as RequestInit),
        });
      } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
          throw e;
        }
        if (attempt < MAX_RETRIES) {
          logger.warn("OpenAI API network error, retrying...", {
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
        if (params.stream) {
          return { data: this.streamSSE(response), response };
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
      ) as Error & { status?: number; body?: unknown };
      error.status = response.status;
      error.body = responseText;

      const retryableStatus =
        response.status === 429 ||
        (response.status >= 500 && response.status !== 501);
      if (retryableStatus && attempt < MAX_RETRIES) {
        lastRetryAfter = response.headers.get("retry-after");
        logger.warn("OpenAI API error, retrying...", {
          model: params.model,
          attempt: attempt + 1,
          status: response.status,
          retryAfter: lastRetryAfter,
        });
        lastError = error;
        continue;
      }

      logger.error("OpenAI API Error:", {
        status: response.status,
        statusText: response.statusText,
        body: responseText,
      });
      throw error;
    }
    throw lastError;
  }

  /**
   * Read a `data:`-framed SSE body. Both endpoints stream in this envelope; only
   * the payload inside changes, so the parser stays protocol-agnostic and the
   * callers cast.
   */
  private async *streamSSE(response: Response): AsyncIterable<unknown> {
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
}
