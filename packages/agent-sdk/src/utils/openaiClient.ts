import {
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
  ChatCompletionChunk,
  ChatCompletion,
  Responses,
} from "openai/resources.js";
import { GatewayConfig } from "../types/config.js";
import {
  postModelEndpoint,
  toAPIPromise,
  type APIPromise,
} from "./modelTransport.js";

const CHAT_COMPLETIONS_PATH = "/chat/completions";
/** Responses endpoint — the only one some models accept function tools on. */
const RESPONSES_PATH = "/responses";

type CreateParams =
  | ChatCompletionCreateParamsNonStreaming
  | ChatCompletionCreateParamsStreaming;

type CreateResponsesParams =
  | Responses.ResponseCreateParamsNonStreaming
  | Responses.ResponseCreateParamsStreaming;

/**
 * Since protocol clients split apart (`utils/anthropicMessagesClient.ts` speaks
 * Messages), this file describes the Chat Completions shape rather than the
 * transport: the response type `T` is the OpenAI wire shape and the endpoint
 * path is the one thing each getter owns.
 *
 * The retry loop, auth headers and SSE reader live in
 * `utils/modelTransport.ts` and are shared with the Messages client unchanged.
 */
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
            postModelEndpoint(
              this.config,
              CHAT_COMPLETIONS_PATH,
              params as unknown as Record<string, unknown>,
              { signal: options?.signal, stream: params.stream === true },
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
          postModelEndpoint(
            this.config,
            RESPONSES_PATH,
            params as unknown as Record<string, unknown>,
            { signal: options?.signal, stream: params.stream === true },
          ),
        ),
    };
  }

  private toAPIPromise<T>(
    responsePromise: ReturnType<typeof postModelEndpoint>,
  ): APIPromise<T> {
    return toAPIPromise<T>(responsePromise);
  }
}
