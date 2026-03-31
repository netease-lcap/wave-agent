import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { BTW_SYSTEM_PROMPT } from "@/prompts/index.js";
import type { BtwOptions } from "@/services/aiService.js";
import type { GatewayConfig, ModelConfig } from "@/types/index.js";
import type { ChatCompletionMessageParam } from "openai/resources.js";

// Test configuration constants
const TEST_GATEWAY_CONFIG: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "http://localhost:test",
};

const TEST_MODEL_CONFIG: ModelConfig = {
  model: "gemini-3-flash",
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

describe("AI Service - BTW", () => {
  beforeEach(() => {
    // Reset mock and set default behavior
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Test side response",
          },
          finish_reason: "stop",
        },
      ],
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("btw functionality", () => {
    // Import the function after mocking
    let btw: (
      options: BtwOptions,
    ) => Promise<import("@/services/aiService.js").BtwResult>;

    beforeEach(async () => {
      const aiService = await import("@/services/aiService.js");
      btw = aiService.btw;
    });

    it("should call OpenAI with correct messages and system prompt", async () => {
      const question = "What is the current working directory?";
      const messages: ChatCompletionMessageParam[] = [
        { role: "user", content: "Previous message" },
      ];

      const result = await btw({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages,
        question,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "system", content: BTW_SYSTEM_PROMPT },
            ...messages,
            { role: "user", content: question },
          ],
          temperature: 0.1,
          max_tokens: 4096,
        }),
        expect.objectContaining({
          signal: undefined,
        }),
      );

      expect(result.content).toBe("Test side response");
      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      });
    });

    it("should handle empty response from AI", async () => {
      mockCreate.mockResolvedValue({
        choices: [
          {
            message: {
              content: "",
            },
          },
        ],
      });

      const question = "Test question";
      await expect(
        btw({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: TEST_MODEL_CONFIG,
          messages: [],
          question,
        }),
      ).rejects.toThrow(
        "Failed to process side question: Empty response from AI",
      );
    });

    it("should handle AbortError", async () => {
      const abortError = new Error("Request was aborted");
      abortError.name = "AbortError";
      mockCreate.mockRejectedValue(abortError);

      const question = "Test question";
      await expect(
        btw({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: TEST_MODEL_CONFIG,
          messages: [],
          question,
        }),
      ).rejects.toThrow("Side question request was aborted");
    });
  });
});
