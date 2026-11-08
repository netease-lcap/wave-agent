/**
 * Native Anthropic Messages endpoint client.
 *
 * Deliberately not `@anthropic-ai/sdk`: the transport Wave already has
 * (`utils/modelTransport.ts`) covers the retry loop, session header and SSE
 * reader, and pulling the SDK in would land a third-party dependency inside the
 * `/host` closure that `scripts/check-sdk-surface.mjs` keeps empty.
 *
 * The only protocol-specific parts here are the path, the two Anthropic headers
 * and the response type. `Authorization: Bearer` is kept alongside `x-api-key`
 * because the codechat gateway authenticates by bearer today while the official
 * API reads `x-api-key`.
 *
 * spec: core/anthropic-messages-api.md 边界情况 9
 */

import { GatewayConfig } from "../types/config.js";
import {
  postModelEndpoint,
  toAPIPromise,
  type APIPromise,
} from "./modelTransport.js";
import type {
  AnthropicMessageStreamEvent,
  AnthropicMessageResponse,
} from "../types/anthropicMessages.js";

const MESSAGES_PATH = "/messages";

/** The only version Anthropic currently accepts on the header. */
export const ANTHROPIC_VERSION = "2023-06-01";

export interface AnthropicMessagesCreateParams {
  model: string;
  messages: unknown[];
  max_tokens: number;
  stream?: boolean;
  [key: string]: unknown;
}

export class AnthropicMessagesClient {
  constructor(private config: GatewayConfig) {}

  get messages() {
    return {
      create: <P extends AnthropicMessagesCreateParams>(
        params: P,
        options?: { signal?: AbortSignal },
      ): APIPromise<
        P extends { stream: true }
          ? AsyncIterable<AnthropicMessageStreamEvent>
          : AnthropicMessageResponse
      > =>
        this.toAPIPromise(
          postModelEndpoint(
            this.config,
            MESSAGES_PATH,
            params as unknown as Record<string, unknown>,
            {
              signal: options?.signal,
              stream: params.stream === true,
              headers: {
                "anthropic-version": ANTHROPIC_VERSION,
                ...(this.config.apiKey
                  ? { "x-api-key": this.config.apiKey }
                  : {}),
              },
              logLabel: "Anthropic Messages API",
            },
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
