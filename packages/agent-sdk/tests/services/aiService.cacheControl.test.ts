import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CallAgentOptions } from "@/services/aiService.js";
import type { GatewayConfig, ModelConfig } from "@/types/index.js";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type { ClaudeChatCompletionContentPartText } from "@/utils/cacheControlUtils.js";

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

describe("AI Service - Claude Cache Control", () => {
  beforeEach(() => {
    // Reset mock and set default behavior
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // Cache Control Utility Tests
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
      it("should add cache control to system messages for Claude models", async () => {
        const messages = [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "Hello" },
        ];

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "claude-3-sonnet",
        );

        expect(result).toHaveLength(2);

        // System message should have cache control
        const systemMessage = result[0];
        expect(systemMessage.role).toBe("system");
        expect(Array.isArray(systemMessage.content)).toBe(true);
        const systemContent = systemMessage.content as Array<{
          type: string;
          text: string;
          cache_control?: { type: string };
        }>;
        expect(systemContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
      });

      it("should not modify messages for non-Claude models", async () => {
        const messages = [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "Hello" },
        ];

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "gpt-4o",
        );

        expect(result).toEqual(messages); // Should be unchanged
      });

      it("should cache last 2 user messages by default", async () => {
        const messages = [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "First user message" },
          { role: "assistant" as const, content: "First response" },
          { role: "user" as const, content: "Second user message" },
          { role: "assistant" as const, content: "Second response" },
          { role: "user" as const, content: "Third user message" },
        ];

        const result = cacheUtils.transformMessagesForClaudeCache(
          messages,
          "claude-3-sonnet",
        );

        // Check that only last 2 user messages have cache control
        const userMessages = result.filter((msg) => msg.role === "user");
        expect(userMessages).toHaveLength(3);

        // First user message should NOT have cache control
        expect(typeof userMessages[0].content).toBe("string");

        // Last 2 user messages should have cache control
        expect(Array.isArray(userMessages[1].content)).toBe(true);
        expect(Array.isArray(userMessages[2].content)).toBe(true);
      });
    });
  });

  // ============================================================================
  // Integration Tests with AI Service
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

    describe("User Message Caching for Claude Models", () => {
      it("should cache only the last 2 user messages for Claude models", async () => {
        const multipleUserMessages = [
          { role: "user" as const, content: "First message" },
          { role: "assistant" as const, content: "First response" },
          { role: "user" as const, content: "Second message" },
          { role: "assistant" as const, content: "Second response" },
          { role: "user" as const, content: "Third message" },
          { role: "assistant" as const, content: "Third response" },
          { role: "user" as const, content: "Fourth message" },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: multipleUserMessages,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        // Verify only last 2 user messages have cache control
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.messages).toBeDefined();

        // Find user messages in the call (excluding system message at index 0)
        const userMessages = callArgs.messages
          .slice(1)
          .filter((msg: { role: string }) => msg.role === "user");
        expect(userMessages).toHaveLength(4);

        // First 2 user messages should be strings (no cache control)
        expect(typeof userMessages[0].content).toBe("string");
        expect(typeof userMessages[1].content).toBe("string");

        // Last 2 user messages should be arrays with cache control
        expect(Array.isArray(userMessages[2].content)).toBe(true);
        expect(Array.isArray(userMessages[3].content)).toBe(true);

        const lastUserContent = userMessages[3].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(lastUserContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
      });

      it("should not cache user messages for non-Claude models", async () => {
        const multipleUserMessages = [
          { role: "user" as const, content: "First message" },
          { role: "assistant" as const, content: "First response" },
          { role: "user" as const, content: "Second message" },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: NON_CLAUDE_MODEL_CONFIG,
          messages: multipleUserMessages,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        // Verify user messages remain as strings
        const callArgs = mockCreate.mock.calls[0][0];
        const userMessages = callArgs.messages
          .slice(1)
          .filter(
            (msg: { role: string; content: unknown }) => msg.role === "user",
          );

        userMessages.forEach((msg: { content: unknown }) => {
          expect(typeof msg.content).toBe("string");
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

    describe("User Message Caching for Claude Models", () => {
      it("should cache the last 2 user messages in a multi-turn conversation", async () => {
        const conversationMessages = [
          { role: "user" as const, content: "First user message" },
          { role: "assistant" as const, content: "First assistant response" },
          { role: "user" as const, content: "Second user message" },
          { role: "assistant" as const, content: "Second assistant response" },
          { role: "user" as const, content: "Third user message" },
          { role: "assistant" as const, content: "Third assistant response" },
          { role: "user" as const, content: "Fourth user message" },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: conversationMessages,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.messages).toBeDefined();

        // Find user messages in the processed messages
        const userMessages = callArgs.messages.filter(
          (msg: ChatCompletionMessageParam) => msg.role === "user",
        );
        expect(userMessages).toHaveLength(4);

        // First two user messages should NOT have cache control (too old)
        expect(userMessages[0].content).toEqual("First user message");
        expect(userMessages[1].content).toEqual("Second user message");

        // Last two user messages should have cache control
        expect(Array.isArray(userMessages[2].content)).toBe(true);
        const thirdUserContent = userMessages[2]
          .content as ClaudeChatCompletionContentPartText[];
        expect(thirdUserContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
        expect(thirdUserContent[0].text).toBe("Third user message");

        expect(Array.isArray(userMessages[3].content)).toBe(true);
        const fourthUserContent = userMessages[3]
          .content as ClaudeChatCompletionContentPartText[];
        expect(fourthUserContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
        expect(fourthUserContent[0].text).toBe("Fourth user message");
      });

      it("should cache only 1 user message when conversation has only 1 user message", async () => {
        const singleUserMessage = [
          { role: "user" as const, content: "Only user message" },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: singleUserMessage,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        const callArgs = mockCreate.mock.calls[0][0];
        const userMessages = callArgs.messages.filter(
          (msg: ChatCompletionMessageParam) => msg.role === "user",
        );
        expect(userMessages).toHaveLength(1);

        // Single user message should have cache control
        expect(Array.isArray(userMessages[0].content)).toBe(true);
        const userContent = userMessages[0]
          .content as ClaudeChatCompletionContentPartText[];
        expect(userContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
        expect(userContent[0].text).toBe("Only user message");
      });

      it("should handle conversation with no user messages gracefully", async () => {
        // This would be an unusual case, but should be handled gracefully
        const noUserMessages = [
          { role: "assistant" as const, content: "Assistant only message" },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: noUserMessages,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        const callArgs = mockCreate.mock.calls[0][0];
        const userMessages = callArgs.messages.filter(
          (msg: ChatCompletionMessageParam) => msg.role === "user",
        );
        expect(userMessages).toHaveLength(0);

        // System message should still have cache control
        const systemMessages = callArgs.messages.filter(
          (msg: ChatCompletionMessageParam) => msg.role === "system",
        );
        expect(systemMessages).toHaveLength(1);
        expect(Array.isArray(systemMessages[0].content)).toBe(true);
      });

      it("should not cache user messages for non-Claude models", async () => {
        const userMessages = [
          { role: "user" as const, content: "First user message" },
          { role: "user" as const, content: "Second user message" },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: NON_CLAUDE_MODEL_CONFIG,
          messages: userMessages,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        const callArgs = mockCreate.mock.calls[0][0];
        const processedUserMessages = callArgs.messages.filter(
          (msg: ChatCompletionMessageParam) => msg.role === "user",
        );

        // All user messages should remain as strings (no cache control)
        processedUserMessages.forEach((msg: ChatCompletionMessageParam) => {
          expect(typeof msg.content).toBe("string");
        });
      });

      it("should preserve mixed content (text + images) in user message caching", async () => {
        const mixedContentMessages = [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Here's an image with question:" },
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
            content: "I see a small test image.",
          },
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "Another message with image:" },
              {
                type: "image_url" as const,
                image_url: {
                  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
                },
              },
            ],
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
        const userMessages = callArgs.messages.filter(
          (msg: ChatCompletionMessageParam) => msg.role === "user",
        );
        expect(userMessages).toHaveLength(2);

        // Both user messages should have cache control (last 2 messages)
        userMessages.forEach((msg: ChatCompletionMessageParam) => {
          expect(Array.isArray(msg.content)).toBe(true);
          const content = msg.content as ClaudeChatCompletionContentPartText[];

          // Should only have text parts with cache control (images are filtered out by addCacheControlToContent)
          expect(content.length).toBeGreaterThan(0);
          content.forEach((part) => {
            expect(part.type).toBe("text");
            expect(part).toHaveProperty("cache_control", { type: "ephemeral" });
            expect(part.text).toBeTruthy();
          });
        });
      });

      it("should handle user messages with only images (no text)", async () => {
        const imageOnlyMessages = [
          {
            role: "user" as const,
            content: [
              {
                type: "image_url" as const,
                image_url: {
                  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
                },
              },
            ],
          },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: imageOnlyMessages,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        const callArgs = mockCreate.mock.calls[0][0];
        const userMessages = callArgs.messages.filter(
          (msg: ChatCompletionMessageParam) => msg.role === "user",
        );
        expect(userMessages).toHaveLength(1);

        // Image-only message should result in empty array after cache control processing
        // (since addCacheControlToContent only processes text parts)
        expect(Array.isArray(userMessages[0].content)).toBe(true);
        const content = userMessages[0]
          .content as ClaudeChatCompletionContentPartText[];
        expect(content).toHaveLength(0);
      });

      it("should handle empty user message content gracefully", async () => {
        const emptyContentMessages = [
          {
            role: "user" as const,
            content: "",
          },
        ];

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: emptyContentMessages,
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(mockCreate).toHaveBeenCalledOnce();

        const callArgs = mockCreate.mock.calls[0][0];
        const userMessages = callArgs.messages.filter(
          (msg: ChatCompletionMessageParam) => msg.role === "user",
        );
        expect(userMessages).toHaveLength(1);

        // Empty string should be converted to structured format with cache control
        expect(Array.isArray(userMessages[0].content)).toBe(true);
        const content = userMessages[0]
          .content as ClaudeChatCompletionContentPartText[];
        expect(content).toHaveLength(1);
        expect(content[0].type).toBe("text");
        expect(content[0].text).toBe("");
        expect(content[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
      });
    });
  });

  // ============================================================================
  // Usage Tracking Extension Tests
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
  // Edge Cases and Error Handling
  // ============================================================================

  describe("Edge Cases and Error Handling", () => {
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

    it("should handle empty conversation gracefully", async () => {
      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: CLAUDE_MODEL_CONFIG,
        messages: [], // Empty messages array
        workdir: "/test/workdir",
      });

      expect(result).toBeDefined();
    });

    it("should handle mixed content types (text + images) properly", async () => {
      const mixedContentMessage = {
        role: "user" as const,
        content: [
          {
            type: "text" as const,
            text: "Describe this image",
          },
          {
            type: "image_url" as const,
            image_url: {
              url: "data:image/jpeg;base64,/9j/4AAQSkZJRgABA...",
            },
          },
        ],
      };

      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: CLAUDE_MODEL_CONFIG,
        messages: [mixedContentMessage],
        workdir: "/test/workdir",
      });

      expect(result).toBeDefined();

      // Test will verify that only text parts receive cache control markers
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

  // ============================================================================
  // Backward Compatibility & Edge Cases Tests
  // ============================================================================

  describe("Backward Compatibility & Edge Cases", () => {
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
        {
          name: "Anthropic Non-Claude",
          config: {
            agentModel: "anthropic-other",
            fastModel: "anthropic-fast",
          },
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
          { modelName: "gpt-4o-claude-variant", shouldCache: true }, // Contains 'claude' so cache control applies
          { modelName: "anthropic-claude-2", shouldCache: true },
          { modelName: "not-claude-model", shouldCache: true }, // Contains 'claude' so cache control applies
          { modelName: "CLAUDE-INSTANT", shouldCache: true },
          { modelName: "claude", shouldCache: true },
          { modelName: "xclaude", shouldCache: true }, // Contains 'claude'
          { modelName: "my-claude-model", shouldCache: true },
          { modelName: "gpt-4o", shouldCache: false }, // Pure GPT model
          { modelName: "gemini-pro", shouldCache: false }, // Pure Gemini model
          { modelName: "llama-2", shouldCache: false }, // Pure Llama model
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
  });

  // ============================================================================
  // Performance Benchmark Tests
  // ============================================================================

  describe("Performance Benchmarks", () => {
    let callAgent: (
      options: CallAgentOptions,
    ) => Promise<import("@/services/aiService.js").CallAgentResult>;

    beforeEach(async () => {
      const aiService = await import("@/services/aiService.js");
      callAgent = aiService.callAgent;

      // Fast mock setup for performance testing
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

    it("should have minimal performance impact for Claude models (<50ms overhead)", async () => {
      // Baseline test with non-Claude model (no cache control processing)
      const baselineStart = performance.now();
      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: NON_CLAUDE_MODEL_CONFIG,
        messages: [
          { role: "user", content: "Message 1" },
          { role: "assistant", content: "Response 1" },
          { role: "user", content: "Message 2" },
          { role: "assistant", content: "Response 2" },
          { role: "user", content: "Message 3" },
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
      const baselineEnd = performance.now();
      const baselineTime = baselineEnd - baselineStart;

      // Cache control test with Claude model
      const claudeStart = performance.now();
      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: CLAUDE_MODEL_CONFIG,
        messages: [
          { role: "user", content: "Message 1" },
          { role: "assistant", content: "Response 1" },
          { role: "user", content: "Message 2" },
          { role: "assistant", content: "Response 2" },
          { role: "user", content: "Message 3" },
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
      const claudeEnd = performance.now();
      const claudeTime = claudeEnd - claudeStart;

      const overhead = claudeTime - baselineTime;

      // Log for debugging/monitoring
      console.log(`Performance benchmark:
        Baseline (non-Claude): ${baselineTime.toFixed(2)}ms
        Claude (with cache):   ${claudeTime.toFixed(2)}ms
        Overhead:             ${overhead.toFixed(2)}ms`);

      // Validate <50ms overhead requirement
      expect(overhead).toBeLessThan(50);
    });

    it("should scale well with large conversations", async () => {
      // Create a large conversation (50 messages)
      const largeConversation = Array.from({ length: 50 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `Message ${i + 1} with some content to make it realistic`,
      })) as Array<{ role: "user" | "assistant"; content: string }>;

      const start = performance.now();
      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: CLAUDE_MODEL_CONFIG,
        messages: largeConversation,
        workdir: "/test/workdir",
      });
      const end = performance.now();
      const processingTime = end - start;

      console.log(
        `Large conversation processing time: ${processingTime.toFixed(2)}ms`,
      );

      // Should process even large conversations quickly (most time should be mock delay)
      expect(processingTime).toBeLessThan(200);
    });

    it("should handle multiple tools efficiently", async () => {
      // Create many tools to test tool processing performance
      const manyTools = Array.from({ length: 20 }, (_, i) => ({
        type: "function" as const,
        function: {
          name: `tool_${i}`,
          description: `Tool number ${i}`,
          parameters: {
            type: "object",
            properties: {
              param1: { type: "string", description: "First parameter" },
              param2: { type: "number", description: "Second parameter" },
            },
          },
        },
      }));

      const start = performance.now();
      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: CLAUDE_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test with many tools" }],
        workdir: "/test/workdir",
        tools: manyTools,
      });
      const end = performance.now();
      const processingTime = end - start;

      console.log(`Many tools processing time: ${processingTime.toFixed(2)}ms`);

      // Should handle many tools efficiently
      expect(processingTime).toBeLessThan(100);
    });

    it("should not significantly impact memory usage", async () => {
      // Measure memory usage during cache control processing
      const initialMemory = process.memoryUsage();

      // Process multiple requests to check for memory leaks
      for (let i = 0; i < 10; i++) {
        await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: CLAUDE_MODEL_CONFIG,
          messages: [
            { role: "user", content: `Test message ${i}` },
            { role: "assistant", content: `Response ${i}` },
            { role: "user", content: `Follow-up ${i}` },
          ],
          workdir: "/test/workdir",
          tools: [
            {
              type: "function" as const,
              function: {
                name: `tool_${i}`,
                description: "Test tool",
                parameters: { type: "object", properties: {} },
              },
            },
          ],
        });
      }

      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;

      console.log(
        `Memory usage increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`,
      );

      // Should not significantly increase memory usage (allow 10MB for test overhead)
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // 10MB
    });
  });
});
