import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  AnthropicMessagesClient,
  ANTHROPIC_VERSION,
} from "../../src/utils/anthropicMessagesClient.js";
import {
  setGlobalLogger,
  clearGlobalLogger,
} from "../../src/utils/globalLogger.js";
import { createMockLogger } from "./mockLogger.js";

function sseStream(lines: string[]): ReadableStream {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(line));
      }
      controller.close();
    },
  });
}

function jsonResponse(body: unknown, headers = new Headers()) {
  return {
    ok: true,
    status: 200,
    headers,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("AnthropicMessagesClient", () => {
  beforeEach(() => {
    setGlobalLogger(createMockLogger());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearGlobalLogger();
  });

  it("POSTs to /messages with the Anthropic headers and keeps the bearer token", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const mockFetch = vi.fn(
      async (url: string, init: RequestInit): Promise<unknown> => {
        capturedUrl = url;
        capturedInit = init;
        return jsonResponse({
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: "claude-opus-4-5",
          content: [{ type: "text", text: "ok" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 1 },
        });
      },
    );

    const client = new AnthropicMessagesClient({
      baseURL: "https://gateway.example/v1",
      apiKey: "test-key",
      defaultHeaders: { "x-tenant": "t1" },
      fetch: mockFetch,
    });

    const response = await client.messages.create({
      model: "claude-opus-4-5",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1024,
    });

    expect(capturedUrl).toBe("https://gateway.example/v1/messages");
    expect(capturedInit?.method).toBe("POST");
    const headers = capturedInit?.headers as Record<string, string>;
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
    expect(headers["x-api-key"]).toBe("test-key");
    // The codechat gateway authenticates by bearer today, so both go out.
    expect(headers["Authorization"]).toBe("Bearer test-key");
    expect(headers["x-tenant"]).toBe("t1");
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(capturedInit?.body))).toEqual({
      model: "claude-opus-4-5",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1024,
    });
    expect(response.content).toEqual([{ type: "text", text: "ok" }]);
  });

  it("omits x-api-key when the gateway has no key", async () => {
    let headers: Record<string, string> = {};
    const mockFetch = vi.fn(async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return jsonResponse({ content: [] });
    });

    const client = new AnthropicMessagesClient({
      baseURL: "https://gateway.example/v1",
      fetch: mockFetch,
    });
    await client.messages.create({
      model: "m",
      messages: [],
      max_tokens: 1,
    });

    expect(headers["x-api-key"]).toBeUndefined();
    expect(headers["anthropic-version"]).toBe(ANTHROPIC_VERSION);
  });

  it("reads a data:-framed event stream, keeping the event type in the payload", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      body: sseStream([
        'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n',
        'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}\n\n',
        'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      ]),
    });

    const client = new AnthropicMessagesClient({
      baseURL: "https://gateway.example/v1",
      apiKey: "k",
      fetch: mockFetch,
    });

    const stream = await client.messages.create({
      model: "m",
      messages: [],
      max_tokens: 1,
      stream: true,
    });

    const events = [];
    for await (const event of stream) {
      events.push(event as { type: string });
    }

    expect(events.map((event) => event.type)).toEqual([
      "message_start",
      "content_block_delta",
      "message_stop",
    ]);
  });

  it("retries a 429 with the Anthropic label before giving up", async () => {
    vi.useFakeTimers();
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: "Too Many Requests",
        headers: new Headers({ "retry-after": "0" }),
        text: async () => "rate limited",
      })
      .mockResolvedValueOnce(
        jsonResponse({
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        }),
      );

    const client = new AnthropicMessagesClient({
      baseURL: "https://gateway.example/v1",
      apiKey: "k",
      fetch: mockFetch,
    });

    const promise = client.messages.create({
      model: "m",
      messages: [],
      max_tokens: 1,
    });
    await vi.runAllTimersAsync();
    const response = await promise;

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(response.content).toEqual([{ type: "text", text: "ok" }]);
    vi.useRealTimers();
  });
});
