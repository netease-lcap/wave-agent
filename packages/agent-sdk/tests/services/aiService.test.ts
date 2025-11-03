import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  CompressMessagesOptions,
  CallAgentOptions,
} from "@/services/aiService.js";
import type { GatewayConfig, ModelConfig } from "@/types.js";

// Test configuration constants
const TEST_GATEWAY_CONFIG: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "http://localhost:test",
};

const TEST_MODEL_CONFIG: ModelConfig = {
  agentModel: "claude-sonnet-4-20250514",
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
vi.mock("openai", () => ({
  default: vi.fn().mockImplementation(() => mockOpenAI),
}));

// Mock constants
vi.mock("@/utils/constants", () => ({
  AGENT_MODEL_ID: "gpt-4o",
}));

// Mock environment variables
vi.mock("process", () => ({
  env: {
    AIGW_TOKEN: "test-token",
    AIGW_URL: "https://test-url.com",
  },
  cwd: () => "/test/cwd",
}));

describe("AI Service", () => {
  beforeEach(() => {
    // Reset mock and set default behavior
    mockCreate.mockReset();
    mockCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Compressed conversation summary",
          },
        },
      ],
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("callAgent", () => {
    // Import the function after mocking
    let callAgent: (
      options: CallAgentOptions,
    ) => Promise<import("@/services/aiService.js").CallAgentResult>;

    beforeEach(async () => {
      const aiService = await import("@/services/aiService.js");
      callAgent = aiService.callAgent;
    });

    it("should use default system prompt when no custom systemPrompt provided", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "Test response",
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
      });

      const callArgs = mockCreate.mock.calls[0][0];

      // Should have system message as first message
      expect(callArgs.messages[0].role).toBe("system");
      expect(callArgs.messages[0].content).toContain(
        "You are an interactive CLI tool",
      );
      expect(callArgs.messages[0].content).toContain(
        "Working directory: /test/workdir",
      );
      expect(callArgs.messages[0].content).toContain("/test/workdir");
    });

    it("should use custom systemPrompt when provided", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "Test response",
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      const customPrompt =
        "You are a custom AI assistant with special capabilities.";

      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
        systemPrompt: customPrompt,
      });

      const callArgs = mockCreate.mock.calls[0][0];

      // Should have custom system message as first message
      expect(callArgs.messages[0].role).toBe("system");
      expect(callArgs.messages[0].content).toContain(customPrompt);
      // Should not contain default prompt content
      expect(callArgs.messages[0].content).not.toContain(
        "You are an interactive CLI tool",
      );
    });

    it("should add memory to default system prompt when no custom systemPrompt provided", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "Test response",
            },
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      });

      const memoryContent = "Important previous context and memory.";

      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
        memory: memoryContent,
      });

      const callArgs = mockCreate.mock.calls[0][0];

      // Should have system message with memory
      expect(callArgs.messages[0].role).toBe("system");
      expect(callArgs.messages[0].content).toContain("## Memory Context");
      expect(callArgs.messages[0].content).toContain(memoryContent);
    });
  });

  describe("compressMessages", () => {
    // Import the function after mocking
    let compressMessages: (options: CompressMessagesOptions) => Promise<string>;

    beforeEach(async () => {
      const aiService = await import("@/services/aiService.js");
      compressMessages = aiService.compressMessages;
    });
    it("should use max_tokens of 1500 and temperature of 0.1", async () => {
      const messages = [
        {
          role: "user" as const,
          content: "Hello, this is a test message",
        },
      ];

      await compressMessages({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages,
      });

      // Verify that create was called
      expect(mockCreate).toHaveBeenCalledTimes(1);

      // Get the actual call arguments
      const callArgs = mockCreate.mock.calls[0][0];

      // Verify model configuration
      expect(callArgs.model).toBe(TEST_MODEL_CONFIG.fastModel);
      expect(callArgs.temperature).toBe(0.1);
      expect(callArgs.max_tokens).toBe(1500);
      expect(callArgs.stream).toBe(false);
    });

    it("should include system message and user messages in correct order", async () => {
      const messages = [
        {
          role: "user" as const,
          content: "Test message 1",
        },
        {
          role: "assistant" as const,
          content: "Test response 1",
        },
      ];

      await compressMessages({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages,
      });

      const callArgs = mockCreate.mock.calls[0][0];

      // Should have system message + original messages + final user instruction
      expect(callArgs.messages).toHaveLength(4);
      expect(callArgs.messages[0].role).toBe("system");
      expect(callArgs.messages[1].role).toBe("user");
      expect(callArgs.messages[2].role).toBe("assistant");
      expect(callArgs.messages[3].role).toBe("user");
      expect(callArgs.messages[3].content).toContain(
        "Please compress this conversation",
      );
    });

    it("should return compressed content", async () => {
      const expectedContent = "Test compressed content";
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: expectedContent,
            },
          },
        ],
      });

      const messages = [
        {
          role: "user" as const,
          content: "Test message",
        },
      ];

      const result = await compressMessages({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages,
      });

      expect(result).toBe(expectedContent);
    });

    it("should handle abort signal", async () => {
      const abortController = new AbortController();
      const messages = [
        {
          role: "user" as const,
          content: "Test message",
        },
      ];

      await compressMessages({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages,
        abortSignal: abortController.signal,
      });

      // Verify that the abort signal was passed to the API call
      const callOptions = mockCreate.mock.calls[0][1];
      expect(callOptions.signal).toBe(abortController.signal);
    });

    it("should return fallback message when API response is empty", async () => {
      mockCreate.mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: null,
            },
          },
        ],
      });

      const messages = [
        {
          role: "user" as const,
          content: "Test message",
        },
      ];

      const result = await compressMessages({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages,
      });

      expect(result).toBe("Failed to compress conversation history");
    });

    it("should handle API errors gracefully", async () => {
      mockCreate.mockRejectedValueOnce(new Error("API Error"));

      const messages = [
        {
          role: "user" as const,
          content: "Test message",
        },
      ];

      const result = await compressMessages({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages,
      });

      expect(result).toBe("Failed to compress conversation history");
    });

    it("should handle abort errors", async () => {
      const abortError = new Error("Request aborted");
      abortError.name = "AbortError";
      mockCreate.mockRejectedValueOnce(abortError);

      const messages = [
        {
          role: "user" as const,
          content: "Test message",
        },
      ];

      await expect(
        compressMessages({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: TEST_MODEL_CONFIG,
          messages,
        }),
      ).rejects.toThrow("Compression request was aborted");
    });
  });
});
