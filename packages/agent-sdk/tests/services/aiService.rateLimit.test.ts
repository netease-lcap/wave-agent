import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  CallAgentOptions,
  CompressMessagesOptions,
} from "@/services/aiService.js";
import type { GatewayConfig, ModelConfig } from "@/types/index.js";

// Test configuration constants
const TEST_GATEWAY_CONFIG: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "http://localhost:test",
};

const TEST_MODEL_CONFIG: ModelConfig = {
  agentModel: "gemini-3-flash",
  fastModel: "gemini-2.5-flash",
};

// Mock the OpenAI client
const mockCreate = vi.fn();
const mockOpenAI = {
  chat: {
    completions: {
      create: mockCreate,
    },
  },
};

// Mock OpenAI constructor
vi.mock("@/utils/openaiClient.js", () => ({
  OpenAIClient: vi.fn().mockImplementation(function () {
    return mockOpenAI;
  }),
}));

describe("AI Service - Rate Limiting", () => {
  let callAgent: (
    options: CallAgentOptions,
  ) => Promise<import("@/services/aiService.js").CallAgentResult>;
  let compressMessages: (
    options: CompressMessagesOptions,
  ) => Promise<import("@/services/aiService.js").CompressMessagesResult>;
  let resetRateLimiter: () => void;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000); // Start at a fixed time

    // Reset mock and set default behavior
    mockCreate.mockReset();
    const mockWithResponse = vi.fn().mockResolvedValue({
      data: {
        choices: [
          { message: { content: "Test response" }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      },
      response: { headers: new Map() },
    });
    mockCreate.mockReturnValue({ withResponse: mockWithResponse });

    const aiService = await import("@/services/aiService.js");
    callAgent = aiService.callAgent;
    compressMessages = aiService.compressMessages;
    resetRateLimiter = aiService.resetRateLimiter;

    resetRateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("should space sequential calls at least 1 second apart", async () => {
    const start = Date.now();

    await callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Call 1" }],
      workdir: "/test/workdir",
    });
    const time1 = Date.now();

    const p2 = callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Call 2" }],
      workdir: "/test/workdir",
    });

    await vi.advanceTimersByTimeAsync(1000);
    await p2;
    const time2 = Date.now();

    expect(time1).toBe(start);
    expect(time2).toBe(start + 1000);
  });

  it("should queue concurrent calls and execute them 1 second apart", async () => {
    const callTimes: number[] = [];
    mockCreate.mockImplementation(() => {
      callTimes.push(Date.now());
      return {
        withResponse: vi
          .fn()
          .mockResolvedValue({
            data: { choices: [] },
            response: { headers: new Map() },
          }),
      };
    });

    const p1 = callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Call 1" }],
      workdir: "/test/workdir",
    });

    const p2 = callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Call 2" }],
      workdir: "/test/workdir",
    });

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.all([p1, p2]);

    expect(callTimes).toHaveLength(2);
    expect(callTimes[1] - callTimes[0]).toBe(1000);
  });

  it("should reject immediately when aborted while waiting", async () => {
    // First call to consume the immediate slot
    await callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Call 1" }],
      workdir: "/test/workdir",
    });

    const controller = new AbortController();
    const p2 = callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Call 2" }],
      workdir: "/test/workdir",
      abortSignal: controller.signal,
    });

    controller.abort();

    await expect(p2).rejects.toThrow("Request was aborted");
    expect(mockCreate).toHaveBeenCalledTimes(1); // Only the first call should have reached OpenAI
  });

  it("should share rate limit between callAgent and compressMessages", async () => {
    const start = Date.now();

    await callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Call 1" }],
      workdir: "/test/workdir",
    });

    const p2 = compressMessages({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      messages: [{ role: "user", content: "Compress 1" }],
    });

    await vi.advanceTimersByTimeAsync(1000);
    await p2;

    expect(Date.now()).toBe(start + 1000);
  });
});
