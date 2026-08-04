import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GatewayConfig, ModelConfig } from "@/types/index.js";

// Test configuration constants
const TEST_GATEWAY_CONFIG: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "http://localhost:test",
};

const TEST_MODEL_CONFIG: ModelConfig = {
  model: "agent-model",
  fastModel: "fast-model",
};

const DEFAULT_THINKING = { thinking: { type: "disabled" } };

// Mock the OpenAI client
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

function mockCreateWithResponse(content = "processed") {
  mockCreate.mockReturnValue({
    withResponse: vi.fn().mockResolvedValue({
      data: {
        choices: [{ message: { content }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      },
      response: {
        headers: new Map([["content-type", "application/json"]]),
      },
    }),
  });
}

describe("AI Service - disable thinking options (fast-model scenarios)", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe("processWebContent", () => {
    let processWebContent: typeof import("@/services/aiService.js").processWebContent;

    beforeEach(async () => {
      const aiService = await import("@/services/aiService.js");
      processWebContent = aiService.processWebContent;
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: "processed content" } }],
        usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
      });
    });

    it("does not send disable-thinking params when none configured", async () => {
      await processWebContent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        content: "<html>...</html>",
        prompt: "Summarize",
        model: "fast-model",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe("fast-model");
      expect(callArgs.thinking).toBeUndefined();
      expect(callArgs.enable_thinking).toBeUndefined();
    });

    it("uses explicitly configured disableThinkingOptions", async () => {
      await processWebContent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: {
          ...TEST_MODEL_CONFIG,
          disableThinkingOptions: { enable_thinking: false },
        },
        content: "<html>...</html>",
        prompt: "Summarize",
        model: "fast-model",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.enable_thinking).toBe(false);
      expect(callArgs.thinking).toBeUndefined();
    });

    it("omits disable-thinking params when explicitly configured as an empty object", async () => {
      await processWebContent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: {
          ...TEST_MODEL_CONFIG,
          disableThinkingOptions: {},
        },
        content: "<html>...</html>",
        prompt: "Summarize",
        model: "fast-model",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.thinking).toBeUndefined();
      expect(callArgs.enable_thinking).toBeUndefined();
    });

    it("does not send disable-thinking params when no fast model override is used", async () => {
      await processWebContent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        content: "<html>...</html>",
        prompt: "Summarize",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.model).toBe("agent-model");
      expect(callArgs.thinking).toBeUndefined();
    });
  });

  describe("callAgent", () => {
    let callAgent: typeof import("@/services/aiService.js").callAgent;

    beforeEach(async () => {
      const aiService = await import("@/services/aiService.js");
      callAgent = aiService.callAgent;
      mockCreateWithResponse();
    });

    it("merges disableThinkingOptions when provided (fast-model subagent loop)", async () => {
      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
        disableThinkingOptions: DEFAULT_THINKING,
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.thinking).toEqual({ type: "disabled" });
    });

    it("does not send disable-thinking params when none provided (agent loop untouched)", async () => {
      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.thinking).toBeUndefined();
      expect(callArgs.enable_thinking).toBeUndefined();
    });
  });
});
