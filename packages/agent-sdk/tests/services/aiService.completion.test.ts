import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GatewayConfig, ModelConfig } from "@/types/index.js";

const TEST_GATEWAY_CONFIG: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "http://localhost:test",
};

const TEST_MODEL_CONFIG: ModelConfig = {
  model: "agent-model",
  fastModel: "fast-model",
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

/**
 * A thenable that also exposes `withResponse`, so the same mock serves
 * `getCompletion` (awaits the call directly) and `callAgent` (reads
 * `.withResponse`).
 */
function mockCreateWith(content: string) {
  const data = { choices: [{ message: { content }, finish_reason: "stop" }] };
  mockCreate.mockImplementation(() => ({
    withResponse: vi.fn().mockResolvedValue({
      data,
      response: { headers: new Map() },
    }),
    then: (resolve: (value: unknown) => void) => resolve(data),
  }));
}

describe("AI Service - inline completion", () => {
  let getCompletion: typeof import("@/services/aiService.js").getCompletion;
  let callAgent: typeof import("@/services/aiService.js").callAgent;
  let resetRateLimiter: () => void;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1000000);
    mockCreate.mockReset();

    const aiService = await import("@/services/aiService.js");
    getCompletion = aiService.getCompletion;
    callAgent = aiService.callAgent;
    resetRateLimiter = aiService.resetRateLimiter;
    resetRateLimiter();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("uses the configured completion model", async () => {
    mockCreateWith("const answer = 42;");

    const result = await getCompletion({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: {
        ...TEST_MODEL_CONFIG,
        completionModel: "completion-model",
      },
      prefix: "const answer = ",
      suffix: ";",
    });

    expect(mockCreate.mock.calls[0][0].model).toBe("completion-model");
    expect(result).toEqual({
      text: "const answer = 42;",
      model: "completion-model",
    });
  });

  it("falls back to the fast model when no completion model is configured", async () => {
    mockCreateWith("42");

    const result = await getCompletion({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      prefix: "const answer = ",
      suffix: ";",
    });

    expect(mockCreate.mock.calls[0][0].model).toBe("fast-model");
    expect(result.model).toBe("fast-model");
  });

  it("refuses to run when no model is available at all", async () => {
    await expect(
      getCompletion({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: {},
        prefix: "",
        suffix: "",
      }),
    ).rejects.toThrow(/requires model/);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("does not call the model at all when completion is switched off", async () => {
    mockCreateWith("42");

    const result = await getCompletion({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: { ...TEST_MODEL_CONFIG, completionEnabled: false },
      prefix: "const a = ",
      suffix: ";",
    });

    expect(result.text).toBe("");
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns an empty completion instead of throwing when the model declines", async () => {
    mockCreateWith("   ");

    const result = await getCompletion({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      prefix: "const x = ",
      suffix: ";",
    });

    expect(result.text).toBe("");
  });

  it("does not wait on the conversation's 1 QPS slot", async () => {
    mockCreateWith("42");

    // Consume the immediate slot the way a conversation turn would.
    await callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: { ...TEST_MODEL_CONFIG, model: "rate-limit-test" },
      messages: [{ role: "user", content: "hi" }],
      workdir: "/test/workdir",
    });

    // No timer advance: a shared slot would leave this promise pending.
    const result = await getCompletion({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      prefix: "",
      suffix: "",
    });

    expect(result.text).toBe("42");
  });

  it("leaves the conversation's 1 QPS slot untouched", async () => {
    mockCreateWith("42");

    await getCompletion({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      prefix: "",
      suffix: "",
    });

    // If completion had reserved a slot, this turn would now wait a second.
    await callAgent({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: { ...TEST_MODEL_CONFIG, model: "rate-limit-test" },
      messages: [{ role: "user", content: "hi" }],
      workdir: "/test/workdir",
    });

    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("merges the completion model's options and disables thinking", async () => {
    mockCreateWith("42");

    await getCompletion({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: {
        ...TEST_MODEL_CONFIG,
        completionModel: "completion-model",
        completionModelOptions: {
          temperature: 0,
          thinking: { type: "disabled" },
        },
      },
      prefix: "",
      suffix: "",
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.temperature).toBe(0);
    expect(callArgs.thinking).toEqual({ type: "disabled" });
    expect(callArgs.max_tokens).toBe(256);
  });

  it("sends the cursor context and the completion system prompt", async () => {
    mockCreateWith("42");

    await getCompletion({
      gatewayConfig: TEST_GATEWAY_CONFIG,
      modelConfig: TEST_MODEL_CONFIG,
      prefix: "const answer = ",
      suffix: ";\nconsole.log(answer);",
      language: "typescript",
      filePath: "/repo/src/index.ts",
    });

    const messages = mockCreate.mock.calls[0][0].messages;
    expect(messages[0].role).toBe("system");
    expect(messages[0].content).toContain("code completion engine");
    expect(messages[1].content).toContain("/repo/src/index.ts");
    expect(messages[1].content).toContain("typescript");
    expect(messages[1].content).toContain("const answer = ");
    expect(messages[1].content).toContain("console.log(answer);");
  });

  it("propagates the abort signal to the model call", async () => {
    const controller = new AbortController();
    mockCreate.mockImplementation(
      (_params, options: { signal?: AbortSignal }) => {
        expect(options.signal).toBe(controller.signal);
        const error = new Error("aborted");
        error.name = "AbortError";
        return Promise.reject(error);
      },
    );

    await expect(
      getCompletion({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        prefix: "",
        suffix: "",
        abortSignal: controller.signal,
      }),
    ).rejects.toThrow("Completion request was aborted");
  });
});
