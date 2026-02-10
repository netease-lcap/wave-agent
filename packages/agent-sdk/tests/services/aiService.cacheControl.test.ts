import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CallAgentOptions } from "@/services/aiService.js";
import type { GatewayConfig, ModelConfig } from "@/types/index.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

// Test configuration constants
const TEST_GATEWAY_CONFIG: GatewayConfig = {
  apiKey: "test-api-key",
  baseURL: "http://localhost:test",
};

// Claude-specific model config for cache control testing
const CLAUDE_MODEL_CONFIG: ModelConfig = {
  agentModel: "claude-3-sonnet-20240229",
  fastModel: "gemini-2.5-flash",
};

// Non-Claude model config for compatibility testing
const NON_CLAUDE_MODEL_CONFIG: ModelConfig = {
  agentModel: "gpt-4o",
  fastModel: "gpt-4o-mini",
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

describe("AI Service - Claude Cache Control", () => {
  beforeEach(() => {
    // Reset mock and set default behavior
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Cache Control Utility Tests - Interval-Based Implementation
  // ============================================================================

  describe("Cache Control Utilities", () => {
    let cacheUtils: typeof import("@/utils/cacheControlUtils.js");

    beforeEach(async () => {
      cacheUtils = await import("@/utils/cacheControlUtils.js");
    });

    describe("isClaudeModel", () => {
      it("should return true for Claude model names (case-insensitive)", async () => {
        expect(cacheUtils.isClaudeModel("claude-3-sonnet-20240229")).toBe(true);
        expect(cacheUtils.isClaudeModel("CLAUDE-3-OPUS")).toBe(true);
        expect(cacheUtils.isClaudeModel("anthropic/claude-2")).toBe(true);
        expect(cacheUtils.isClaudeModel("Claude-Instant")).toBe(true);
      });

      it("should return false for non-Claude model names", async () => {
        expect(cacheUtils.isClaudeModel("gpt-4o")).toBe(false);
        expect(cacheUtils.isClaudeModel("gpt-3.5-turbo")).toBe(false);
        expect(cacheUtils.isClaudeModel("gemini-pro")).toBe(false);
        expect(cacheUtils.isClaudeModel("llama2")).toBe(false);
      });

      it("should handle invalid inputs gracefully", async () => {
        expect(cacheUtils.isClaudeModel("")).toBe(false);
        expect(cacheUtils.isClaudeModel(null as unknown as string)).toBe(false);
        expect(cacheUtils.isClaudeModel(undefined as unknown as string)).toBe(
          false,
        );
        expect(cacheUtils.isClaudeModel(123 as unknown as string)).toBe(false);
      });
    });

    describe("findIntervalMessageIndex", () => {
      it("should return -1 for conversations with fewer than 20 messages", async () => {
        // Test with various message counts under 20
        for (let i = 0; i < 20; i++) {
          const messages = Array.from({ length: i }, (_, idx) => ({
            role: idx % 2 === 0 ? "user" : "assistant",
            content: `Message ${idx + 1}`,
          })) as ChatCompletionMessageParam[];

          expect(cacheUtils.findIntervalMessageIndex(messages)).toBe(-1);
        }
      });

      it("should return 19 (20th message, 0-based) for exactly 20 messages", async () => {
        const messages = Array.from({ length: 20 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as ChatCompletionMessageParam[];

        expect(cacheUtils.findIntervalMessageIndex(messages)).toBe(19);
      });

      it("should return 19 for 21-39 messages (keeps 20th message)", async () => {
        for (let messageCount = 21; messageCount <= 39; messageCount++) {
          const messages = Array.from({ length: messageCount }, (_, i) => ({
            role: i % 2 === 0 ? "user" : "assistant",
            content: `Message ${i + 1}`,
          })) as ChatCompletionMessageParam[];

          expect(cacheUtils.findIntervalMessageIndex(messages)).toBe(19);
        }
      });

      it("should return 39 (40th message) for exactly 40 messages (sliding window)", async () => {
        const messages = Array.from({ length: 40 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as ChatCompletionMessageParam[];

        expect(cacheUtils.findIntervalMessageIndex(messages)).toBe(39);
      });

      it("should return correct index for larger conversation (sliding window behavior)", async () => {
        // Test 60-message conversation (should return index 59 for 60th message)
        const messages60 = Array.from({ length: 60 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as ChatCompletionMessageParam[];

        expect(cacheUtils.findIntervalMessageIndex(messages60)).toBe(59);

        // Test 80-message conversation (should return index 79 for 80th message)
        const messages80 = Array.from({ length: 80 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as ChatCompletionMessageParam[];

        expect(cacheUtils.findIntervalMessageIndex(messages80)).toBe(79);
      });

      it("should handle edge cases gracefully", async () => {
        // Empty array
        expect(cacheUtils.findIntervalMessageIndex([])).toBe(-1);

        // Invalid input
        expect(
          cacheUtils.findIntervalMessageIndex(
            null as unknown as ChatCompletionMessageParam[],
          ),
        ).toBe(-1);
        expect(
          cacheUtils.findIntervalMessageIndex(
            undefined as unknown as ChatCompletionMessageParam[],
          ),
        ).toBe(-1);
      });
    });

    describe("isValidCacheControl", () => {
      it("should validate correct cache control objects", async () => {
        expect(cacheUtils.isValidCacheControl({ type: "ephemeral" })).toBe(
          true,
        );
      });

      it("should reject invalid cache control objects", async () => {
        expect(cacheUtils.isValidCacheControl({ type: "persistent" })).toBe(
          false,
        );
        expect(cacheUtils.isValidCacheControl({ cache: "ephemeral" })).toBe(
          false,
        );
        expect(cacheUtils.isValidCacheControl(null)).toBe(false);
        expect(cacheUtils.isValidCacheControl(undefined)).toBe(false);
        expect(cacheUtils.isValidCacheControl("ephemeral")).toBe(false);
        expect(cacheUtils.isValidCacheControl({})).toBe(false);
      });
    });

    describe("isValidClaudeUsage", () => {
      it("should validate correct Claude usage objects", async () => {
        const validUsage = {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
          cache_read_input_tokens: 30,
          cache_creation_input_tokens: 70,
          cache_creation: {
            ephemeral_5m_input_tokens: 70,
            ephemeral_1h_input_tokens: 0,
          },
        };
        expect(cacheUtils.isValidClaudeUsage(validUsage)).toBe(true);
      });

      it("should validate usage objects without cache fields", async () => {
        const basicUsage = {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        };
        expect(cacheUtils.isValidClaudeUsage(basicUsage)).toBe(true);
      });

      it("should reject invalid usage objects", async () => {
        expect(cacheUtils.isValidClaudeUsage({})).toBe(false);
        expect(cacheUtils.isValidClaudeUsage(null)).toBe(false);
        expect(cacheUtils.isValidClaudeUsage({ prompt_tokens: "100" })).toBe(
          false,
        );
        expect(cacheUtils.isValidClaudeUsage({ prompt_tokens: 100 })).toBe(
          false,
        ); // missing required fields
      });
    });

    describe("addCacheControlToContent", () => {
      it("should transform string content to structured arrays with cache control", async () => {
        const result = cacheUtils.addCacheControlToContent(
          "Test content",
          true,
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: "text",
          text: "Test content",
          cache_control: { type: "ephemeral" },
        });
      });

      it("should preserve existing structured content and add cache control markers", async () => {
        const structuredContent = [
          { type: "text" as const, text: "First part" },
          { type: "text" as const, text: "Second part" },
        ];

        const result = cacheUtils.addCacheControlToContent(
          structuredContent,
          true,
        );

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
          type: "text",
          text: "First part",
          cache_control: { type: "ephemeral" },
        });
        expect(result[1]).toEqual({
          type: "text",
          text: "Second part",
          cache_control: { type: "ephemeral" },
        });
      });

      it("should not add cache control when shouldCache is false", async () => {
        const result = cacheUtils.addCacheControlToContent(
          "Test content",
          false,
        );

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: "text",
          text: "Test content",
        });
        expect(result[0]).not.toHaveProperty("cache_control");
      });

      it("should filter out non-text content parts", async () => {
        const mixedContent = [
          { type: "text" as const, text: "Text part" },
          {
            type: "image_url" as const,
            image_url: { url: "https://example.com/image.jpg" },
          },
        ];

        const result = cacheUtils.addCacheControlToContent(mixedContent, true);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          type: "text",
          text: "Text part",
          cache_control: { type: "ephemeral" },
        });
      });
    });

    describe("addCacheControlToLastTool", () => {
      it("should add cache control to the last tool only", async () => {
        const tools = [
          {
            type: "function" as const,
            function: {
              name: "tool1",
              description: "First tool",
              parameters: { type: "object", properties: {} },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "tool2",
              description: "Second tool",
              parameters: { type: "object", properties: {} },
            },
          },
        ];

        const result = cacheUtils.addCacheControlToLastTool(tools);

        expect(result).toHaveLength(2);
        expect(result[0]).not.toHaveProperty("cache_control");
        expect(result[1]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
        expect(result[1].function.name).toBe("tool2");
      });

      it("should handle empty tools array", async () => {
        const result = cacheUtils.addCacheControlToLastTool([]);
        expect(result).toHaveLength(0);
      });

      it("should handle single tool", async () => {
        const tools = [
          {
            type: "function" as const,
            function: {
              name: "single_tool",
              description: "Only tool",
              parameters: { type: "object", properties: {} },
            },
          },
        ];

        const result = cacheUtils.addCacheControlToLastTool(tools);

        expect(result).toHaveLength(1);
        expect(result[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
        expect(result[0].function.name).toBe("single_tool");
      });
    });

    describe("transformMessagesForClaudeCache", () => {
      it("should not add cache markers for conversations with fewer than 20 total messages", async () => {
        const messages = [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "Hello" },
          { role: "assistant" as const, content: "Hi there!" },
        ];

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "claude-3-sonnet",
        );

        expect(result).toHaveLength(3);

        // System message should have cache control (always cached)
        const systemMessage = result[0];
        expect(systemMessage.role).toBe("system");
        expect(Array.isArray(systemMessage.content)).toBe(true);

        // User and assistant messages should not have cache control (< 20 messages)
        expect(typeof result[1].content).toBe("string");
        expect(typeof result[2].content).toBe("string");
      });

      it("should add cache marker on 20th message exactly for 20-message conversations", async () => {
        const messages = Array.from({ length: 20 }, (_, i) => ({
          role: i === 0 ? "system" : i % 2 === 1 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as ChatCompletionMessageParam[];

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "claude-3-sonnet",
        );

        expect(result).toHaveLength(20);

        // System message (first) should have cache control
        expect(Array.isArray(result[0].content)).toBe(true);

        // 20th message (index 19) should have cache control
        expect(Array.isArray(result[19].content)).toBe(true);
        const intervalContent = result[19].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(intervalContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });

        // Other messages should not have cache control
        for (let i = 1; i < 19; i++) {
          expect(typeof result[i].content).toBe("string");
        }
      });

      it("should maintain 20th cache marker for 21-39 message conversations", async () => {
        // Test with 25 messages
        const messages = Array.from({ length: 25 }, (_, i) => ({
          role: i === 0 ? "system" : i % 2 === 1 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as ChatCompletionMessageParam[];

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "claude-3-sonnet",
        );

        expect(result).toHaveLength(25);

        // System message should have cache control
        expect(Array.isArray(result[0].content)).toBe(true);

        // 20th message (index 19) should still have cache control (sliding window keeps it)
        expect(Array.isArray(result[19].content)).toBe(true);

        // 25th message (index 24) should NOT have cache control (not at interval boundary)
        expect(typeof result[24].content).toBe("string");
      });

      it("should move cache to 40th message for 40-message conversations (sliding window)", async () => {
        const messages = Array.from({ length: 40 }, (_, i) => ({
          role: i === 0 ? "system" : i % 2 === 1 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as ChatCompletionMessageParam[];

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "claude-3-sonnet",
        );

        expect(result).toHaveLength(40);

        // System message should have cache control
        expect(Array.isArray(result[0].content)).toBe(true);

        // 20th message (index 19) should NOT have cache control anymore
        expect(typeof result[19].content).toBe("string");

        // 40th message (index 39) should have cache control (latest interval)
        expect(Array.isArray(result[39].content)).toBe(true);
        const intervalContent = result[39].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(intervalContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
      });

      it("should always cache last system message", async () => {
        const messages = [
          { role: "user" as const, content: "First user message" },
          { role: "system" as const, content: "System message in middle" },
          { role: "assistant" as const, content: "Assistant response" },
          { role: "user" as const, content: "Second user message" },
          { role: "system" as const, content: "Last system message" },
        ];

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "claude-3-sonnet",
        );

        // Last system message (index 4) should have cache control
        expect(Array.isArray(result[4].content)).toBe(true);
        const systemContent = result[4].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(systemContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });

        // Middle system message (index 1) should NOT have cache control
        expect(typeof result[1].content).toBe("string");
      });

      it("should not cache assistant messages with tool calls", async () => {
        const messages = [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "Use a tool" },
          {
            role: "assistant" as const,
            content: "I'll use the tool",
            tool_calls: [
              {
                id: "call_123",
                type: "function" as const,
                function: {
                  name: "test_tool",
                  arguments: '{"param": "value"}',
                },
              },
            ],
          },
        ];

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "claude-3-sonnet",
        );

        // Assistant message with tool_calls should NOT have cache control
        // Cache control should only be applied to tool definitions, not messages with tool calls
        expect(typeof result[2].content).toBe("string");
        expect(result[2].content).toBe("I'll use the tool");

        // Only system message should have cache control (it's the last system message)
        expect(Array.isArray(result[0].content)).toBe(true);
        const systemContent = result[0].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(systemContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
      });

      it("should cache last tool call in interval messages with tool_calls", async () => {
        // Create a 20-message conversation where the 20th message has tool calls
        const messages = Array.from({ length: 19 }, (_, i) => ({
          role: i === 0 ? "system" : i % 2 === 1 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as ChatCompletionMessageParam[];

        // Add the 20th message with tool calls (this will be at interval position 19, 0-based)
        messages.push({
          role: "assistant" as const,
          content: "",
          tool_calls: [
            {
              id: "call_1",
              type: "function" as const,
              function: {
                name: "first_tool",
                arguments: '{"param": "value1"}',
              },
            },
            {
              id: "call_2",
              type: "function" as const,
              function: {
                name: "second_tool",
                arguments: '{"param": "value2"}',
              },
            },
          ],
        });

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "claude-3-sonnet",
        );

        expect(result).toHaveLength(20);

        // System message (first) should have cache control
        expect(Array.isArray(result[0].content)).toBe(true);

        // 20th message (index 19) should have cache control on the LAST tool call, not content
        const intervalMessage = result[19];
        expect(intervalMessage.role).toBe("assistant");

        // Type check for assistant message with tool calls
        if (
          intervalMessage.role === "assistant" &&
          intervalMessage.tool_calls
        ) {
          expect(intervalMessage.tool_calls).toBeDefined();
          expect(intervalMessage.tool_calls).toHaveLength(2);

          // First tool call should NOT have cache control
          expect(intervalMessage.tool_calls[0]).not.toHaveProperty(
            "cache_control",
          );

          // Last tool call should have cache control
          expect(intervalMessage.tool_calls[1]).toHaveProperty(
            "cache_control",
            {
              type: "ephemeral",
            },
          );
        } else {
          throw new Error("Expected assistant message with tool_calls");
        }

        // Content should remain unchanged (not cached)
        expect(intervalMessage.content).toBe("");
      });

      it("should cache tool role messages at interval positions", async () => {
        // Create a 20-message conversation where the 20th message is a tool response
        const messages = Array.from({ length: 19 }, (_, i) => ({
          role: i === 0 ? "system" : i % 2 === 1 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as ChatCompletionMessageParam[];

        // Add the 20th message as a tool response (this will be at interval position 19, 0-based)
        messages.push({
          role: "tool" as const,
          content: "rain",
          tool_call_id: "toolu_vrtx_01SPwKHBh5KmA6dhcmZmCaRg",
        });

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "claude-3-sonnet",
        );

        expect(result).toHaveLength(20);

        // System message (first) should have cache control
        expect(Array.isArray(result[0].content)).toBe(true);

        // 20th message (index 19) should be a tool role with cache control
        const intervalMessage = result[19];
        expect(intervalMessage.role).toBe("tool");
        expect(intervalMessage).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
        expect(intervalMessage.content).toBe("rain");

        // Type guard for tool message
        if (intervalMessage.role === "tool") {
          expect(intervalMessage.tool_call_id).toBe(
            "toolu_vrtx_01SPwKHBh5KmA6dhcmZmCaRg",
          );
        }
      });

      it("should not apply cache control for non-Claude models", async () => {
        const messages = Array.from({ length: 25 }, (_, i) => ({
          role: i === 0 ? "system" : i % 2 === 1 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as ChatCompletionMessageParam[];

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "gpt-4o",
        );

        // Should return messages unchanged for non-Claude models
        expect(result).toEqual(messages);
        result.forEach((message) => {
          expect(typeof message.content).toBe("string");
        });
      });

      it("should handle edge cases gracefully", async () => {
        // Empty conversation
        expect(
          cacheUtils.transformMessagesForClaudeCache([], "claude-3-sonnet"),
        ).toEqual([]);

        // Invalid messages array
        expect(
          cacheUtils.transformMessagesForClaudeCache(
            null as unknown as ChatCompletionMessageParam[],
            "claude-3-sonnet",
          ),
        ).toEqual([]);
        expect(
          cacheUtils.transformMessagesForClaudeCache(
            undefined as unknown as ChatCompletionMessageParam[],
            "claude-3-sonnet",
          ),
        ).toEqual([]);
      });

      it("should handle mixed message types correctly", async () => {
        const messages = [
          { role: "system" as const, content: "You are helpful" },
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Describe this image" },
              {
                type: "image_url" as const,
                image_url: { url: "data:image/jpeg;base64,..." },
              },
            ],
          },
          { role: "assistant" as const, content: "I can see the image" },
        ];

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "claude-3-sonnet",
        );

        // System message should have cache control
        expect(Array.isArray(result[0].content)).toBe(true);

        // User message with mixed content should remain unchanged (no cache for < 20 messages)
        expect(Array.isArray(result[1].content)).toBe(true);
        expect(result[1].content).toEqual(messages[1].content);

        // Assistant message should remain as string
        expect(typeof result[2].content).toBe("string");
      });
    });
  });

  // ============================================================================
  // Integration Tests with AI Service - Interval-Based Cache Control
  // ============================================================================

  describe("AI Service Integration", () => {
    let callAgent: (
      options: CallAgentOptions,
    ) => Promise<import("@/services/aiService.js").CallAgentResult>;

    beforeEach(async () => {
      const aiService = await import("@/services/aiService.js");
      callAgent = aiService.callAgent;

      // Mock standard OpenAI response
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
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
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

    describe("System Message Caching for Claude Models", () => {
      it("should apply cache control to system messages for Claude models", async () => {
        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: [{ role: "user", content: "Test message" }],
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        // Verify system message has cache control applied
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.messages).toBeDefined();
        expect(callArgs.messages).toHaveLength(2); // system + user message

        const systemMessage = callArgs.messages[0];
        expect(systemMessage.role).toBe("system");
        expect(Array.isArray(systemMessage.content)).toBe(true);

        const systemContent = systemMessage.content as Array<{
          type: string;
          text: string;
          cache_control?: { type: string };
        }>;
        expect(systemContent[0]).toHaveProperty("type", "text");
        expect(systemContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
      });

      it("should not apply cache control to system messages for non-Claude models", async () => {
        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: NON_CLAUDE_MODEL_CONFIG,
          messages: [{ role: "user", content: "Test message" }],
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        // Verify system message does NOT have cache control
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.messages).toBeDefined();
        expect(callArgs.messages).toHaveLength(2); // system + user message

        const systemMessage = callArgs.messages[0];
        expect(systemMessage.role).toBe("system");
        expect(typeof systemMessage.content).toBe("string"); // Should remain as string
      });
    });

    describe("Interval-Based Message Caching for Claude Models", () => {
      it("should not cache messages for conversations with fewer than 20 messages", async () => {
        const shortConversation = Array.from({ length: 10 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as Array<{ role: "user" | "assistant"; content: string }>;

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: shortConversation,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        const callArgs = mockCreate.mock.calls[0][0];

        // System message (index 0) should have cache control
        expect(Array.isArray(callArgs.messages[0].content)).toBe(true);

        // All other messages should be strings (no interval caching for < 20 messages)
        for (let i = 1; i < callArgs.messages.length; i++) {
          expect(typeof callArgs.messages[i].content).toBe("string");
        }
      });

      it("should cache 20th message exactly in 20-message conversations", async () => {
        // Create 19 messages (system will be added automatically to make 20 total)
        const twentyMessageConversation = Array.from(
          { length: 19 },
          (_, i) => ({
            role: i % 2 === 0 ? "user" : "assistant",
            content: `Message ${i + 1}`,
          }),
        ) as Array<{ role: "user" | "assistant"; content: string }>;

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: twentyMessageConversation,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.messages).toHaveLength(20); // system + 19 messages

        // System message (index 0) should have cache control
        expect(Array.isArray(callArgs.messages[0].content)).toBe(true);

        // 20th message (index 19) should have cache control
        expect(Array.isArray(callArgs.messages[19].content)).toBe(true);
        const intervalContent = callArgs.messages[19].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(intervalContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });

        // Messages 1-18 should be strings (no cache control)
        for (let i = 1; i < 19; i++) {
          expect(typeof callArgs.messages[i].content).toBe("string");
        }
      });

      it("should maintain sliding window behavior for 40+ message conversations", async () => {
        // Create 39 messages (system will be added automatically to make 40 total)
        const fortyMessageConversation = Array.from({ length: 39 }, (_, i) => ({
          role: i % 2 === 0 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as Array<{ role: "user" | "assistant"; content: string }>;

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: fortyMessageConversation,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.messages).toHaveLength(40); // system + 39 messages

        // System message (index 0) should have cache control
        expect(Array.isArray(callArgs.messages[0].content)).toBe(true);

        // 20th message (index 19) should NOT have cache control (sliding window moved)
        expect(typeof callArgs.messages[19].content).toBe("string");

        // 40th message (index 39) should have cache control (latest interval)
        expect(Array.isArray(callArgs.messages[39].content)).toBe(true);
        const intervalContent = callArgs.messages[39].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(intervalContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
      });

      it("should not cache interval messages for non-Claude models", async () => {
        const twentyMessageConversation = Array.from(
          { length: 19 },
          (_, i) => ({
            role: i % 2 === 0 ? "user" : "assistant",
            content: `Message ${i + 1}`,
          }),
        ) as Array<{ role: "user" | "assistant"; content: string }>;

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: NON_CLAUDE_MODEL_CONFIG,
          messages: twentyMessageConversation,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        const callArgs = mockCreate.mock.calls[0][0];

        // All messages should remain as strings for non-Claude models
        callArgs.messages.forEach((message: { content: unknown }) => {
          expect(typeof message.content).toBe("string");
        });
      });
    });

    describe("Tool Definition Caching for Claude Models", () => {
      it("should cache the last tool definition for Claude models", async () => {
        const testTools = [
          {
            type: "function" as const,
            function: {
              name: "tool1",
              description: "First tool",
              parameters: { type: "object", properties: {} },
            },
          },
          {
            type: "function" as const,
            function: {
              name: "tool2",
              description: "Second tool",
              parameters: { type: "object", properties: {} },
            },
          },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: [{ role: "user", content: "Test message" }],
          workdir: "/test/workdir",
          tools: testTools,
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        // Verify last tool has cache control applied
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.tools).toBeDefined();
        expect(callArgs.tools).toHaveLength(2);

        // First tool should NOT have cache control
        expect(callArgs.tools[0]).not.toHaveProperty("cache_control");
        expect(callArgs.tools[0].function.name).toBe("tool1");

        // Last tool should have cache control
        expect(callArgs.tools[1]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
        expect(callArgs.tools[1].function.name).toBe("tool2");
      });

      it("should not cache tools for non-Claude models", async () => {
        const testTools = [
          {
            type: "function" as const,
            function: {
              name: "tool1",
              description: "First tool",
              parameters: { type: "object", properties: {} },
            },
          },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: NON_CLAUDE_MODEL_CONFIG,
          messages: [{ role: "user", content: "Test message" }],
          workdir: "/test/workdir",
          tools: testTools,
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        // Verify tools remain unchanged
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.tools).toBeDefined();
        expect(callArgs.tools).toHaveLength(1);
        expect(callArgs.tools[0]).not.toHaveProperty("cache_control");
        expect(callArgs.tools[0]).toEqual(testTools[0]);
      });

      it("should handle single tool caching", async () => {
        const singleTool = [
          {
            type: "function" as const,
            function: {
              name: "single_tool",
              description: "Only tool",
              parameters: { type: "object", properties: {} },
            },
          },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: [{ role: "user", content: "Test message" }],
          workdir: "/test/workdir",
          tools: singleTool,
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        // Verify single tool has cache control
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.tools).toBeDefined();
        expect(callArgs.tools).toHaveLength(1);
        expect(callArgs.tools[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
        expect(callArgs.tools[0].function.name).toBe("single_tool");
      });
    });

    describe("Mixed Content and Edge Cases", () => {
      it("should handle conversations with mixed content types", async () => {
        const mixedContentMessages = [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Here's an image:" },
              {
                type: "image_url" as const,
                image_url: {
                  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
                },
              },
              { type: "text" as const, text: "What do you see?" },
            ],
          },
          {
            role: "assistant" as const,
            content: "I see a test image.",
          },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: mixedContentMessages,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        const callArgs = mockCreate.mock.calls[0][0];

        // System message should have cache control
        expect(Array.isArray(callArgs.messages[0].content)).toBe(true);

        // Mixed content messages should remain unchanged (< 20 total messages)
        expect(Array.isArray(callArgs.messages[1].content)).toBe(true);
        expect(callArgs.messages[1].content).toEqual(
          mixedContentMessages[0].content,
        );

        expect(typeof callArgs.messages[2].content).toBe("string");
      });

      it("should handle empty conversation gracefully", async () => {
        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: [], // Empty messages array
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
      });

      it("should handle tool calls in assistant messages correctly", async () => {
        const messagesWithToolCall = [
          { role: "user" as const, content: "Use the search tool" },
          {
            role: "assistant" as const,
            content: "I'll search for that",
            tool_calls: [
              {
                id: "call_123",
                type: "function" as const,
                function: {
                  name: "search",
                  arguments: '{"query": "test"}',
                },
              },
            ],
          },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: messagesWithToolCall,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        const callArgs = mockCreate.mock.calls[0][0];

        // Assistant message with tool_calls should NOT have cache control
        // Cache control should only be applied to tool definitions, not messages with tool calls
        const lastMessage = callArgs.messages[callArgs.messages.length - 1];
        expect(lastMessage.tool_calls).toBeDefined();
        expect(typeof lastMessage.content).toBe("string");
        expect(lastMessage.content).toBe("I'll search for that");

        // Only system message should have cache control (it's the last system message)
        const systemMessage = callArgs.messages[0];
        expect(systemMessage.role).toBe("system");
        expect(Array.isArray(systemMessage.content)).toBe(true);
        const systemContent = systemMessage.content as Array<{
          cache_control?: { type: string };
        }>;
        expect(systemContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
      });
    });
  });

  // ============================================================================
  // Usage Tracking Integration Tests
  // ============================================================================

  describe("Cache Usage Tracking", () => {
    let callAgent: (
      options: CallAgentOptions,
    ) => Promise<import("@/services/aiService.js").CallAgentResult>;

    beforeEach(async () => {
      const aiService = await import("@/services/aiService.js");
      callAgent = aiService.callAgent;
    });

    it("should extend usage tracking with cache metrics for Claude models", async () => {
      // Mock Claude response with cache metrics
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
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
            cache_read_input_tokens: 30,
            cache_creation_input_tokens: 70,
            cache_creation: {
              ephemeral_5m_input_tokens: 70,
              ephemeral_1h_input_tokens: 0,
            },
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

      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: CLAUDE_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
      });

      expect(result).toBeDefined();
      expect(result.usage).toBeDefined();

      // Test will verify cache metrics are properly handled once implementation is complete
    });

    it("should maintain backward compatibility for non-Claude usage tracking", async () => {
      // Set up mock for this specific test
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
            prompt_tokens: 100,
            completion_tokens: 50,
            total_tokens: 150,
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

      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: NON_CLAUDE_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
      });

      expect(result).toBeDefined();
      expect(result.usage).toBeDefined();
      expect(result.usage?.prompt_tokens).toBe(100);
      expect(result.usage?.completion_tokens).toBe(50);
      expect(result.usage?.total_tokens).toBe(150);

      // Ensure no cache-specific fields are present for non-Claude models
      expect(result.usage).not.toHaveProperty("cache_read_input_tokens");
      expect(result.usage).not.toHaveProperty("cache_creation_input_tokens");
      expect(result.usage).not.toHaveProperty("cache_creation");
    });
  });

  // ============================================================================
  // Backward Compatibility & Model Support Tests
  // ============================================================================

  describe("Backward Compatibility & Model Support", () => {
    let callAgent: (
      options: CallAgentOptions,
    ) => Promise<import("@/services/aiService.js").CallAgentResult>;

    beforeEach(async () => {
      const aiService = await import("@/services/aiService.js");
      callAgent = aiService.callAgent;

      // Standard mock setup
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

    describe("Non-Claude Model Compatibility", () => {
      const nonClaudeModels = [
        {
          name: "OpenAI GPT-4o",
          config: { agentModel: "gpt-4o", fastModel: "gpt-4o-mini" },
        },
        {
          name: "OpenAI GPT-3.5",
          config: { agentModel: "gpt-3.5-turbo", fastModel: "gpt-3.5-turbo" },
        },
        {
          name: "Google Gemini",
          config: { agentModel: "gemini-pro", fastModel: "gemini-flash" },
        },
        {
          name: "Meta Llama",
          config: { agentModel: "llama2-70b", fastModel: "llama2-7b" },
        },
      ];

      nonClaudeModels.forEach(({ name, config }) => {
        it(`should preserve original behavior for ${name}`, async () => {
          const result = await callAgent({
            gatewayConfig: TEST_GATEWAY_CONFIG,
            modelConfig: config,
            messages: [
              { role: "user", content: "First message" },
              { role: "assistant", content: "Response" },
              { role: "user", content: "Second message" },
            ],
            workdir: "/test/workdir",
            tools: [
              {
                type: "function" as const,
                function: {
                  name: "test_tool",
                  description: "Test tool",
                  parameters: { type: "object", properties: {} },
                },
              },
            ],
          });

          expect(result).toBeDefined();
          expect(mockCreate).toHaveBeenCalledOnce();

          const callArgs = mockCreate.mock.calls[0][0];

          // System message should remain as string
          const systemMessage = callArgs.messages.find(
            (msg: ChatCompletionMessageParam) => msg.role === "system",
          );
          expect(systemMessage).toBeDefined();
          expect(typeof systemMessage.content).toBe("string");

          // User messages should remain as strings
          const userMessages = callArgs.messages.filter(
            (msg: ChatCompletionMessageParam) => msg.role === "user",
          );
          userMessages.forEach((msg: ChatCompletionMessageParam) => {
            expect(typeof msg.content).toBe("string");
          });

          // Tools should not have cache control
          if (callArgs.tools) {
            callArgs.tools.forEach((tool: unknown) => {
              expect(tool).not.toHaveProperty("cache_control");
            });
          }
        });
      });

      it("should handle mixed Claude and non-Claude model names correctly", async () => {
        const testCases = [
          { modelName: "claude-3-sonnet", shouldCache: true },
          { modelName: "gpt-4o-claude-variant", shouldCache: true }, // Contains 'claude'
          { modelName: "anthropic-claude-2", shouldCache: true },
          { modelName: "CLAUDE-INSTANT", shouldCache: true },
          { modelName: "gpt-4o", shouldCache: false }, // Pure GPT model
          { modelName: "gemini-pro", shouldCache: false }, // Pure Gemini model
        ];

        for (const testCase of testCases) {
          const result = await callAgent({
            gatewayConfig: TEST_GATEWAY_CONFIG,
            modelConfig: {
              agentModel: testCase.modelName,
              fastModel: "gpt-4o-mini",
            },
            messages: [{ role: "user", content: "Test message" }],
            workdir: "/test/workdir",
          });

          expect(result).toBeDefined();

          const callArgs =
            mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0];
          const systemMessage = callArgs.messages[0];

          if (testCase.shouldCache) {
            expect(Array.isArray(systemMessage.content)).toBe(true);
          } else {
            expect(typeof systemMessage.content).toBe("string");
          }
        }
      });
    });

    describe("Usage Tracking Compatibility", () => {
      it("should maintain standard usage tracking for non-Claude models", async () => {
        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: { agentModel: "gpt-4o", fastModel: "gpt-4o-mini" },
          messages: [{ role: "user", content: "Test message" }],
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(result.usage).toBeDefined();
        expect(result.usage?.prompt_tokens).toBe(10);
        expect(result.usage?.completion_tokens).toBe(20);
        expect(result.usage?.total_tokens).toBe(30);

        // Should not have Claude-specific cache fields
        expect(result.usage).not.toHaveProperty("cache_read_input_tokens");
        expect(result.usage).not.toHaveProperty("cache_creation_input_tokens");
        expect(result.usage).not.toHaveProperty("cache_creation");
      });

      it("should handle missing usage gracefully", async () => {
        // Mock response without usage
        const mockWithResponse = vi.fn().mockResolvedValue({
          data: {
            choices: [
              {
                message: { content: "Test response" },
                finish_reason: "stop",
              },
            ],
            // No usage field
          },
          response: {
            headers: new Map([["x-request-id", "req-12345"]]),
          },
        });
        mockCreate.mockReturnValue({ withResponse: mockWithResponse });

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: [{ role: "user", content: "Test message" }],
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(result.usage).toBeUndefined();
      });
    });

    describe("Edge Cases", () => {
      it("should handle empty conversation gracefully", async () => {
        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: [], // Empty messages array
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
      });

      it("should handle undefined model gracefully", async () => {
        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: [{ role: "user", content: "Test message" }],
          workdir: "/test/workdir",
          model: undefined,
        });

        expect(result).toBeDefined();
      });
    });
  });
});
