import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionChunk,
  ChatCompletion,
} from "openai/resources.js";
import { GatewayConfig } from "../types/config.js";

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
          const promise = (async () => {
            const { data } = await this._create(params, options);
            return data;
          })() as Promise<unknown> & {
            withResponse(): Promise<APIResponse<unknown>>;
          };
          promise.withResponse = async () => {
            return (await this._create(
              params,
              options,
            )) as APIResponse<unknown>;
          };
          return promise as APIPromise<
            P extends ChatCompletionCreateParamsStreaming
              ? AsyncIterable<ChatCompletionChunk>
              : ChatCompletion
          >;
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
    const response = await fetchFn(url, {
      method: "POST",
      headers,
      body: JSON.stringify(params),
      signal: options?.signal,
      ...(fetchOptions as RequestInit),
    });

    if (!response.ok) {
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
      throw error;
    }

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
          if (!trimmedLine || !trimmedLine.startsWith("data: ")) continue;

          const data = trimmedLine.slice(6);
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
