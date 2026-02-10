import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CallAgentOptions } from "@/services/aiService.js";
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

// Mock constants
vi.mock("@/utils/constants", () => ({
  AGENT_MODEL_ID: "gpt-4o",
}));

// Mock environment variables
vi.mock("process", () => ({
  env: {
    WAVE_API_KEY: "test-token",
    WAVE_BASE_URL: "https://test-url.com",
  },
  cwd: () => "/test/cwd",
}));

describe("AI Service - Basic CallAgent", () => {
  beforeEach(() => {
    // Reset mock and set default behavior
    mockCreate.mockReset();
    // Mock withResponse() method
    const mockWithResponse = vi.fn().mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: "Test response",
            },
            finish_reason: "stop",
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 20,
          total_tokens: 30,
        },
      },
      response: {
        headers: new Map([
          ["x-request-id", "req-12345"],
          ["content-type", "application/json"],
        ]),
      },
    });
    mockCreate.mockReturnValue({ withResponse: mockWithResponse });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // Helper function to get content from system message (handles both string and array formats)
  const getSystemMessageContent = (
    content: string | Array<{ type: string; text?: string }>,
  ): string => {
    if (typeof content === "string") {
      return content;
    }
    if (Array.isArray(content)) {
      return content.map((part) => part.text || "").join("");
    }
    return "";
  };

  describe("callAgent basic functionality", () => {
    // Import the function after mocking
    let callAgent: (
      options: CallAgentOptions,
    ) => Promise<import("@/services/aiService.js").CallAgentResult>;

    beforeEach(async () => {
      const aiService = await import("@/services/aiService.js");
      callAgent = aiService.callAgent;
    });

    it("should use default system prompt when no custom systemPrompt provided", async () => {
      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
      });

      const callArgs = mockCreate.mock.calls[0][0];

      // Should have system message as first message
      expect(callArgs.messages[0].role).toBe("system");
      const systemContent = getSystemMessageContent(
        callArgs.messages[0].content,
      );
      expect(systemContent).toContain("You are an interactive CLI tool");
      expect(systemContent).toContain("Working directory: /test/workdir");
    });

    it("should use custom systemPrompt when provided", async () => {
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
      const systemContent = getSystemMessageContent(
        callArgs.messages[0].content,
      );
      expect(systemContent).toContain(customPrompt);
      // Should not contain default prompt content
      expect(systemContent).not.toContain("You are an interactive CLI tool");
    });

    it("should add memory to default system prompt when no custom systemPrompt provided", async () => {
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
      const systemContent = getSystemMessageContent(
        callArgs.messages[0].content,
      );
      expect(systemContent).toContain("## Memory Context");
      expect(systemContent).toContain(memoryContent);
    });

    it("should handle response with usage information", async () => {
      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
      });

      expect(result.content).toBe("Test response");
      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      });
    });

    it("should handle response without usage information", async () => {
      const mockWithResponse = vi.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: "Test response without usage",
              },
              finish_reason: "length",
            },
          ],
        },
        response: {
          headers: new Map([["x-request-id", "req-67890"]]),
        },
      });
      mockCreate.mockReturnValue({ withResponse: mockWithResponse });

      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
      });

      expect(result.content).toBe("Test response without usage");
      expect(result.usage).toBeUndefined();
      expect(result.finish_reason).toBe("length");
      expect(result.response_headers).toEqual({
        "x-request-id": "req-67890",
      });
    });

    it("should include finish_reason and response_headers in result", async () => {
      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
      });

      expect(result.content).toBe("Test response");
      expect(result.finish_reason).toBe("stop");
      expect(result.response_headers).toEqual({
        "x-request-id": "req-12345",
        "content-type": "application/json",
      });
      expect(result.usage).toEqual({
        prompt_tokens: 10,
        completion_tokens: 20,
        total_tokens: 30,
      });
    });

    it("should pass max_tokens to OpenAI from modelConfig", async () => {
      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: {
          ...TEST_MODEL_CONFIG,
          maxTokens: 1234,
        },
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.max_tokens).toBe(1234);
    });

    it("should prioritize maxTokens from callAgent options over modelConfig", async () => {
      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: {
          ...TEST_MODEL_CONFIG,
          maxTokens: 1234,
        },
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
        maxTokens: 5678,
      });

      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.max_tokens).toBe(5678);
    });

    it("should handle different finish_reason values", async () => {
      const mockWithResponse = vi.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: null,
                tool_calls: [
                  {
                    id: "call_123",
                    type: "function",
                    function: {
                      name: "test_tool",
                      arguments: '{"arg": "value"}',
                    },
                  },
                ],
              },
              finish_reason: "tool_calls",
            },
          ],
        },
        response: {
          headers: new Map([["x-request-id", "req-tool-call"]]),
        },
      });
      mockCreate.mockReturnValue({ withResponse: mockWithResponse });

      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
      });

      expect(result.finish_reason).toBe("tool_calls");
      expect(result.tool_calls).toHaveLength(1);
      expect(result.tool_calls?.[0].type).toBe("function");
      if (result.tool_calls?.[0].type === "function") {
        expect(result.tool_calls[0].function.name).toBe("test_tool");
      }
    });

    it("should handle response with empty headers", async () => {
      const mockWithResponse = vi.fn().mockResolvedValue({
        data: {
          choices: [
            {
              message: {
                content: "Test response",
              },
              finish_reason: "stop",
            },
          ],
        },
        response: {
          headers: new Map(),
        },
      });
      mockCreate.mockReturnValue({ withResponse: mockWithResponse });

      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
      });

      expect(result.content).toBe("Test response");
      expect(result.finish_reason).toBe("stop");
      expect(result.response_headers).toBeUndefined();
    });
  });
});
