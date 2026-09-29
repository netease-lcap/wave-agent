import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CallAgentOptions } from "@/services/aiService.js";
import type { GatewayConfig, ModelConfig } from "@/types/index.js";

const TEST_GATEWAY_CONFIG: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "http://localhost:test",
};

const TEST_MODEL_CONFIG: ModelConfig = {
  model: "gemini-3-flash",
  fastModel: "gemini-2.5-flash",
};

const mockCreate = vi.fn();
const mockOpenAI = {
  chat: {
    completions: {
      create: mockCreate,
    },
  },
};

vi.mock("@/utils/openaiClient.js", () => ({
  OpenAIClient: vi.fn().mockImplementation(function () {
    return mockOpenAI;
  }),
}));

vi.mock("@/utils/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/constants.js")>();
  return { ...actual, AGENT_MODEL_ID: "gpt-4o" };
});

vi.mock("process", () => ({
  env: {
    WAVE_API_KEY: "test-token",
    WAVE_BASE_URL: "https://test-url.com",
  },
  cwd: () => "/test/cwd",
}));

/** The error undici raises when a response body's connection dies mid-stream. */
function terminatedError(): Error {
  return new TypeError("terminated");
}

function streamingResponse(
  chunks: unknown[],
  failWith?: Error,
): { withResponse: () => Promise<unknown> } {
  return {
    withResponse: vi.fn().mockResolvedValue({
      data: (async function* () {
        for (const chunk of chunks) {
          yield chunk;
        }
        if (failWith) throw failWith;
      })(),
      response: { headers: new Map() },
    }),
  };
}

function nonStreamingResponse(content: string): {
  withResponse: () => Promise<unknown>;
} {
  return {
    withResponse: vi.fn().mockResolvedValue({
      data: {
        choices: [{ message: { content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      },
      response: { headers: new Map() },
    }),
  };
}

describe("AI Service - streaming body failure falls back to non-streaming", () => {
  let callAgent: (
    options: CallAgentOptions,
  ) => Promise<import("@/services/aiService.js").CallAgentResult>;

  beforeEach(async () => {
    mockCreate.mockReset();
    const aiService = await import("@/services/aiService.js");
    callAgent = aiService.callAgent;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("re-issues the same request without streaming when the stream dies mid-body", async () => {
    mockCreate
      .mockReturnValueOnce(
        streamingResponse(
          [{ choices: [{ delta: { content: "half an ans" } }] }],
          terminatedError(),
        ),
      )
      .mockReturnValueOnce(nonStreamingResponse("the full answer"));

    const contentUpdates: string[] = [];
    const result = await callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Test message" }],
      workdir: "/test/workdir",
      onContentUpdate: (content) => contentUpdates.push(content),
    });

    // First attempt streamed, second one did not (spec: 降级为非流式重发).
    expect(mockCreate).toHaveBeenCalledTimes(2);
    expect(mockCreate.mock.calls[0][0].stream).toBe(true);
    expect(mockCreate.mock.calls[1][0].stream).toBe(false);

    // The fallback result carries the whole answer and the flag that tells the
    // caller to drop what the failed attempt had already streamed.
    expect(result.content).toBe("the full answer");
    expect(result.stream_fallback).toBe(true);

    // The partial output did reach the streaming callback before the fallback —
    // that is exactly why the caller has to discard it.
    expect(contentUpdates).toEqual(["half an ans"]);
  });

  it("keeps the non-streaming attempt off the streaming callbacks", async () => {
    mockCreate
      .mockReturnValueOnce(streamingResponse([], terminatedError()))
      .mockReturnValueOnce(nonStreamingResponse("fresh"));

    const contentUpdates: string[] = [];
    const result = await callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Test message" }],
      workdir: "/test/workdir",
      onContentUpdate: (content) => contentUpdates.push(content),
    });

    expect(result.stream_fallback).toBe(true);
    expect(contentUpdates).toEqual([]);
  });

  it("propagates a user abort without re-issuing the request", async () => {
    const abortController = new AbortController();
    mockCreate.mockReturnValueOnce(
      streamingResponse(
        [{ choices: [{ delta: { content: "half an ans" } }] }],
        new Error("Request was aborted"),
      ),
    );
    abortController.abort();

    await expect(
      callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
        abortSignal: abortController.signal,
        onContentUpdate: () => {},
      }),
    ).rejects.toThrow(/aborted/i);

    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("propagates the error when the non-streaming re-issue fails as well", async () => {
    mockCreate
      .mockReturnValueOnce(streamingResponse([], terminatedError()))
      .mockReturnValueOnce({
        withResponse: vi.fn().mockRejectedValue(new Error("boom")),
      });

    await expect(
      callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
        onContentUpdate: () => {},
      }),
    ).rejects.toThrow("boom");

    // One fallback only — never a third attempt.
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("does not mark a healthy stream as a fallback", async () => {
    mockCreate.mockReturnValueOnce(
      streamingResponse([
        { choices: [{ delta: { content: "complete" } }] },
        { choices: [{ delta: {}, finish_reason: "stop" }] },
      ]),
    );

    const result = await callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Test message" }],
      workdir: "/test/workdir",
      onContentUpdate: () => {},
    });

    expect(result.content).toBe("complete");
    expect(result.stream_fallback).toBeUndefined();
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
