import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionChunk,
  ChatCompletion,
} from "openai/resources.js";
import { GatewayConfig } from "../types/config.js";
import { logger } from "./globalLogger.js";

type CreateParams =
  | ChatCompletionCreateParamsNonStreaming
  | ChatCompletionCreateParamsStreaming;

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
        > => {
          const responsePromise = this._create(params, options);
          const promise = responsePromise.then(
            (res) => res.data,
          ) as unknown as APIPromise<
            P extends ChatCompletionCreateParamsStreaming
              ? AsyncIterable<ChatCompletionChunk>
              : ChatCompletion
          >;
          promise.withResponse = () =>
            responsePromise as Promise<
              APIResponse<
                P extends ChatCompletionCreateParamsStreaming
                  ? AsyncIterable<ChatCompletionChunk>
                  : ChatCompletion
              >
            >;
          // Prevent unhandled rejection if only withResponse() is used
          promise.catch(() => {});
          return promise;
        },
      },
    };
  }

  private async _create<P extends CreateParams>(
    params: P,
    options?: { signal?: AbortSignal },
  ): Promise<
    APIResponse<
      P extends ChatCompletionCreateParamsStreaming
        ? AsyncIterable<ChatCompletionChunk>
        : ChatCompletion
    >
  > {
    const {
      baseURL,
      apiKey,
      defaultHeaders,
      fetchOptions,
      fetch: customFetch,
    } = this.config;
    const url = `${baseURL}/chat/completions`;
    const headers = {
      "Content-Type": "application/json",
      ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      ...defaultHeaders,
    };

    const fetchFn = (customFetch as typeof fetch) || fetch;
    let lastError: (Error & { status?: number; body?: unknown }) | undefined;
    const maxRetries = 3;
    const initialDelay = 1000;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        const delay = initialDelay * Math.pow(2, attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      const response = await fetchFn(url, {
        method: "POST",
        headers,
        body: JSON.stringify(params),
        signal: options?.signal,
        ...(fetchOptions as RequestInit),
      });

      if (response.ok) {
        if (params.stream) {
          return {
            data: this.streamChatCompletion(response),
            response,
          } as unknown as APIResponse<
            P extends ChatCompletionCreateParamsStreaming
              ? AsyncIterable<ChatCompletionChunk>
              : ChatCompletion
          >;
        } else {
          const data = await response.json();
          return {
            data,
            response,
          } as unknown as APIResponse<
            P extends ChatCompletionCreateParamsStreaming
              ? AsyncIterable<ChatCompletionChunk>
              : ChatCompletion
          >;
        }
      }

      let errorBody: unknown;
      try {
        const text = await response.text();
        try {
          errorBody = JSON.parse(text);
        } catch {
          errorBody = text;
        }
      } catch {
        errorBody = {};
      }

      const error = new Error(
        typeof errorBody === "object" &&
        errorBody !== null &&
        "error" in errorBody &&
        typeof (errorBody as { error: unknown }).error === "object" &&
        (errorBody as { error: object }).error !== null &&
        "message" in (errorBody as { error: { message: unknown } }).error
          ? String((errorBody as { error: { message: string } }).error.message)
          : typeof errorBody === "string"
            ? errorBody
            : response.statusText,
      ) as Error & { status?: number; body?: unknown };
      error.status = response.status;
      error.body = errorBody;

      if (response.status === 429 && attempt < maxRetries) {
        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });
        logger.warn("OpenAI API 429 Too Many Requests, retrying...", {
          attempt: attempt + 1,
          status: response.status,
          responseHeaders,
        });
        lastError = error;
        continue;
      }

      const responseHeaders: Record<string, string> = {};
      response.headers.forEach((value, key) => {
        responseHeaders[key] = value;
      });
      logger.error("OpenAI API Error:", {
        status: response.status,
        statusText: response.statusText,
        requestHeaders: headers,
        responseHeaders,
        errorBody,
      });
      throw error;
    }
    throw lastError;
  }

  private async *streamChatCompletion(
    response: Response,
  ): AsyncIterable<ChatCompletionChunk> {
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

          try {
            const json = JSON.parse(data);
            yield json as ChatCompletionChunk;
          } catch {
            // Ignore parse errors for non-JSON lines if any
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }
}
