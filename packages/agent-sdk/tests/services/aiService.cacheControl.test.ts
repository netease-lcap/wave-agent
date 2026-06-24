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
  model: "claude-3-sonnet-20240229",
  fastModel: "gemini-2.5-flash",
};

// Non-Claude model config for compatibility testing
const NON_CLAUDE_MODEL_CONFIG: ModelConfig = {
  model: "gpt-4o",
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
  // Cache Control Utility Tests
  // ============================================================================

  describe("Cache Control Utilities", () => {
    let cacheUtils: typeof import("@/utils/cacheControlUtils.js");

    beforeEach(async () => {
      cacheUtils = await import("@/utils/cacheControlUtils.js");
    });

    describe("supportsPromptCaching", () => {
      it("should return true for Claude model names (case-insensitive)", async () => {
        expect(
          cacheUtils.supportsPromptCaching("claude-3-sonnet-20240229"),
        ).toBe(true);
        expect(cacheUtils.supportsPromptCaching("CLAUDE-3-OPUS")).toBe(true);
        expect(cacheUtils.supportsPromptCaching("anthropic/claude-2")).toBe(
          true,
        );
        expect(cacheUtils.supportsPromptCaching("Claude-Instant")).toBe(true);
      });

      it("should return false for non-Claude model names", async () => {
        expect(cacheUtils.supportsPromptCaching("gpt-4o")).toBe(false);
        expect(cacheUtils.supportsPromptCaching("gpt-3.5-turbo")).toBe(false);
        expect(cacheUtils.supportsPromptCaching("gemini-pro")).toBe(false);
        expect(cacheUtils.supportsPromptCaching("llama2")).toBe(false);
      });

      it("should handle invalid inputs gracefully", async () => {
        expect(cacheUtils.supportsPromptCaching("")).toBe(false);
        expect(
          cacheUtils.supportsPromptCaching(null as unknown as string),
        ).toBe(false);
        expect(
          cacheUtils.supportsPromptCaching(undefined as unknown as string),
        ).toBe(false);
        expect(cacheUtils.supportsPromptCaching(123 as unknown as string)).toBe(
          false,
        );
      });

      it("should support regex patterns via WAVE_PROMPT_CACHE_REGEX", async () => {
        // Save original env
        const originalEnv = process.env.WAVE_PROMPT_CACHE_REGEX;

        // Test with regex pattern "claude|qwen"
        process.env.WAVE_PROMPT_CACHE_REGEX = "claude|qwen";

        // Re-import to pick up new env variable
        vi.resetModules();
        const cacheUtilsNew = await import("@/utils/cacheControlUtils.js");

        // Should match claude
        expect(cacheUtilsNew.supportsPromptCaching("claude-3-sonnet")).toBe(
          true,
        );
        // Should match qwen
        expect(cacheUtilsNew.supportsPromptCaching("qwen3.6-plus")).toBe(true);
        expect(cacheUtilsNew.supportsPromptCaching("QWEN-turbo")).toBe(true);
        // Should not match others
        expect(cacheUtilsNew.supportsPromptCaching("gpt-4o")).toBe(false);
        expect(cacheUtilsNew.supportsPromptCaching("gemini-pro")).toBe(false);

        // Restore original env
        if (originalEnv === undefined) {
          delete process.env.WAVE_PROMPT_CACHE_REGEX;
        } else {
          process.env.WAVE_PROMPT_CACHE_REGEX = originalEnv;
        }
        vi.resetModules();
      });

      it("should fall back to default for invalid regex patterns", async () => {
        // Save original env
        const originalEnv = process.env.WAVE_PROMPT_CACHE_REGEX;

        // Test with invalid regex pattern
        process.env.WAVE_PROMPT_CACHE_REGEX = "[invalid(regex";

        // Re-import to pick up new env variable
        vi.resetModules();
        const cacheUtilsNew = await import("@/utils/cacheControlUtils.js");

        // Should fall back to default "claude" matching
        expect(cacheUtilsNew.supportsPromptCaching("claude-3-sonnet")).toBe(
          true,
        );
        expect(cacheUtilsNew.supportsPromptCaching("CLAUDE")).toBe(true);
        expect(cacheUtilsNew.supportsPromptCaching("gpt-4o")).toBe(false);

        // Restore original env
        if (originalEnv === undefined) {
          delete process.env.WAVE_PROMPT_CACHE_REGEX;
        } else {
          process.env.WAVE_PROMPT_CACHE_REGEX = originalEnv;
        }
        vi.resetModules();
      });
    });

    describe("isClaudeModel (deprecated alias)", () => {
      it("should be an alias for supportsPromptCaching", async () => {
        // Both should return the same result
        expect(cacheUtils.isClaudeModel("claude-3-sonnet")).toBe(
          cacheUtils.supportsPromptCaching("claude-3-sonnet"),
        );
        expect(cacheUtils.isClaudeModel("gpt-4o")).toBe(
          cacheUtils.supportsPromptCaching("gpt-4o"),
        );
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
        // Only the last text part gets cache_control
        expect(result[0]).toEqual({
          type: "text",
          text: "First part",
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

      it("should preserve non-text content parts and cache last text part", async () => {
        const mixedContent = [
          { type: "text" as const, text: "Text part" },
          {
            type: "image_url" as const,
            image_url: { url: "https://example.com/image.jpg" },
          },
        ];

        const result = cacheUtils.addCacheControlToContent(mixedContent, true);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
          type: "text",
          text: "Text part",
          cache_control: { type: "ephemeral" },
        });
        expect(result[1]).toEqual({
          type: "image_url",
          image_url: { url: "https://example.com/image.jpg" },
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

    describe("transformMessagesForExplicitCache", () => {
      it("should cache first system message and last user message", async () => {
        const messages = [
          { role: "user" as const, content: "First user message" },
          { role: "system" as const, content: "System message in middle" },
          { role: "assistant" as const, content: "Assistant response" },
          { role: "user" as const, content: "Second user message" },
          { role: "system" as const, content: "Last system message" },
        ];

        const result = cacheUtils.transformMessagesForExplicitCache(
          messages,
          "claude-3-sonnet",
        );

        // First system message (index 1) should have cache control
        expect(Array.isArray(result[1].content)).toBe(true);
        const firstSystemContent = result[1].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(firstSystemContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });

        // Last system message (index 4) should NOT have cache control
        expect(typeof result[4].content).toBe("string");
        expect(result[4].content).toBe("Last system message");

        // Last user message (index 3) should have cache control
        expect(Array.isArray(result[3].content)).toBe(true);
        const lastUserContent = result[3].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(lastUserContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });

        // First user message (index 0) should NOT have cache control
        expect(typeof result[0].content).toBe("string");
        expect(result[0].content).toBe("First user message");
      });

      it("should cache only the last user message in multi-turn conversation", async () => {
        const messages = [
          { role: "system" as const, content: "You are helpful" },
          { role: "user" as const, content: "Hello" },
          { role: "assistant" as const, content: "Hi there!" },
          { role: "user" as const, content: "How are you?" },
          { role: "assistant" as const, content: "I'm good!" },
          { role: "user" as const, content: "What can you do?" },
        ];

        const result = cacheUtils.transformMessagesForExplicitCache(
          messages,
          "claude-3-sonnet",
        );

        // System message (index 0) should have cache control
        expect(Array.isArray(result[0].content)).toBe(true);

        // First user message (index 1) should NOT have cache control
        expect(typeof result[1].content).toBe("string");

        // Second user message (index 3) should NOT have cache control
        expect(typeof result[3].content).toBe("string");

        // Last user message (index 5) should have cache control
        expect(Array.isArray(result[5].content)).toBe(true);
        const lastUserContent = result[5].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(lastUserContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
      });

      it("should handle conversation with no user messages", async () => {
        const messages = [
          { role: "system" as const, content: "You are helpful" },
          { role: "assistant" as const, content: "Hello!" },
        ];

        const result = cacheUtils.transformMessagesForExplicitCache(
          messages,
          "claude-3-sonnet",
        );

        // System message should have cache control
        expect(Array.isArray(result[0].content)).toBe(true);

        // Assistant message should NOT have cache control
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

        const result = cacheUtils.transformMessagesForExplicitCache(
          messages,
          "claude-3-sonnet",
        );

        // Assistant message with tool_calls should NOT have cache control
        // Cache control should only be applied to tool definitions, not messages with tool calls
        expect(typeof result[2].content).toBe("string");
        expect(result[2].content).toBe("I'll use the tool");

        // System message should have cache control
        expect(Array.isArray(result[0].content)).toBe(true);
        const systemContent = result[0].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(systemContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });

        // Last user message (index 1) should have cache control
        expect(Array.isArray(result[1].content)).toBe(true);
        const userContent = result[1].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(userContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });
      });

      it("should not apply cache control for non-Claude models", async () => {
        const messages = Array.from({ length: 25 }, (_, i) => ({
          role: i === 0 ? "system" : i % 2 === 1 ? "user" : "assistant",
          content: `Message ${i + 1}`,
        })) as ChatCompletionMessageParam[];

        const result = cacheUtils.transformMessagesForExplicitCache(
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
          cacheUtils.transformMessagesForExplicitCache([], "claude-3-sonnet"),
        ).toEqual([]);

        // Invalid messages array
        expect(
          cacheUtils.transformMessagesForExplicitCache(
            null as unknown as ChatCompletionMessageParam[],
            "claude-3-sonnet",
          ),
        ).toEqual([]);
        expect(
          cacheUtils.transformMessagesForExplicitCache(
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

        const result = cacheUtils.transformMessagesForExplicitCache(
          messages,
          "claude-3-sonnet",
        );

        // System message should have cache control
        expect(Array.isArray(result[0].content)).toBe(true);

        // User message with mixed content should preserve structure and add cache control on last text part
        expect(Array.isArray(result[1].content)).toBe(true);
        const userContent = result[1].content as unknown as Array<
          Record<string, unknown>
        >;
        expect(userContent[0]).toEqual({
          type: "text",
          text: "Describe this image",
          cache_control: { type: "ephemeral" },
        });
        expect(userContent[1]).toEqual({
          type: "image_url",
          image_url: { url: "data:image/jpeg;base64,..." },
        });

        // Assistant message should remain as string
        expect(typeof result[2].content).toBe("string");
      });

      it("should use bridge marker for long conversations (>20 blocks)", async () => {
        // 25 messages, each with string content = 25 content blocks (>20)
        const messages = Array.from({ length: 25 }, (_, i) => ({
          role:
            i === 0
              ? ("system" as const)
              : i % 2 === 1
                ? ("user" as const)
                : ("assistant" as const),
          content: `Message ${i + 1}`,
        })) as ChatCompletionMessageParam[];

        const result = cacheUtils.transformMessagesForExplicitCache(
          messages,
          "claude-3-sonnet",
        );

        // System message (index 0) should have cache control
        expect(Array.isArray(result[0].content)).toBe(true);

        // Last user message (index 24) should NOT have cache control (long conversation)
        // In a 25-block conversation, target = 25 - 20 + 2 = 7
        // Bridge marker should be at the message where cumulative blocks first reach 7
        // Messages 0-6 = 7 blocks, so bridge is at index 6 (assistant)
        expect(Array.isArray(result[6].content)).toBe(true);
        const bridgeContent = result[6].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(bridgeContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });

        // Last user message (index 23) should NOT have cache control
        expect(typeof result[23].content).toBe("string");

        // Only system and bridge should have cache_control (2 markers, not 3)
        let markerCount = 0;
        for (const msg of result) {
          if (Array.isArray(msg.content)) {
            const content = msg.content as Array<{
              cache_control?: { type: string };
            }>;
            if (content.some((c) => c.cache_control)) markerCount++;
          }
        }
        expect(markerCount).toBe(2);
      });

      it("should not place bridge marker on system message", async () => {
        // 22 messages: 1 system + 21 user/assistant = 22 blocks
        const messages = [
          { role: "system" as const, content: "System prompt" },
          ...Array.from({ length: 21 }, (_, i) => ({
            role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
            content: `Message ${i + 1}`,
          })),
        ] as ChatCompletionMessageParam[];

        const result = cacheUtils.transformMessagesForExplicitCache(
          messages,
          "claude-3-sonnet",
        );

        // System (index 0) has cache control
        expect(Array.isArray(result[0].content)).toBe(true);

        // Bridge marker: target = 22 - 20 + 2 = 4
        // i=0 system (cumulative=1, skip), i=1 user (cumulative=2),
        // i=2 assistant (cumulative=3), i=3 user (cumulative=4 ≥ target → bridge)
        expect(Array.isArray(result[3].content)).toBe(true);
        const bridgeContent = result[3].content as Array<{
          cache_control?: { type: string };
        }>;
        expect(bridgeContent[0]).toHaveProperty("cache_control", {
          type: "ephemeral",
        });

        // Only 2 markers
        let markerCount = 0;
        for (const msg of result) {
          if (Array.isArray(msg.content)) {
            const content = msg.content as Array<{
              cache_control?: { type: string };
            }>;
            if (content.some((c) => c.cache_control)) markerCount++;
          }
        }
        expect(markerCount).toBe(2);
      });

      it("should fall back to last user when no bridge candidate found", async () => {
        // System + many assistant messages with null content (0 blocks each)
        // Total blocks = 1 (only system has content), but 30 messages
        const messages = [
          { role: "system" as const, content: "System prompt" },
          ...Array.from({ length: 29 }, (_, i) => ({
            role: "assistant" as const,
            content: null as unknown as string,
            tool_calls: [
              {
                id: `call_${i}`,
                type: "function" as const,
                function: { name: "tool", arguments: "{}" },
              },
            ],
          })),
        ] as ChatCompletionMessageParam[];

        // totalBlocks = 1 (only system), so ≤ 20 → short conversation path
        // No user messages, so only system gets a marker
        const result = cacheUtils.transformMessagesForExplicitCache(
          messages,
          "claude-3-sonnet",
        );

        // System has cache control
        expect(Array.isArray(result[0].content)).toBe(true);

        // Assistant messages should not have cache control (content stays null)
        expect(result[1].content).toBeNull();

        // Only 1 marker (system)
        let markerCount = 0;
        for (const msg of result) {
          if (Array.isArray(msg.content)) {
            const content = msg.content as Array<{
              cache_control?: { type: string };
            }>;
            if (content.some((c) => c.cache_control)) markerCount++;
          }
        }
        expect(markerCount).toBe(1);
      });
    });

    describe("countContentBlocks", () => {
      it("should count string content as 1 block", async () => {
        const messages = [
          { role: "system" as const, content: "Hello" },
          { role: "user" as const, content: "World" },
        ] as ChatCompletionMessageParam[];

        expect(cacheUtils.countContentBlocks(messages)).toBe(2);
      });

      it("should count array content elements as individual blocks", async () => {
        const messages = [
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "part 1" },
              { type: "text" as const, text: "part 2" },
              { type: "image_url" as const, image_url: { url: "..." } },
            ],
          },
        ] as ChatCompletionMessageParam[];

        expect(cacheUtils.countContentBlocks(messages)).toBe(3);
      });

      it("should count null/undefined content as 0 blocks", async () => {
        const messages = [
          { role: "system" as const, content: "System" },
          {
            role: "assistant" as const,
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function" as const,
                function: { name: "tool", arguments: "{}" },
              },
            ],
          },
          { role: "user" as const, content: "Hello" },
        ] as ChatCompletionMessageParam[];

        expect(cacheUtils.countContentBlocks(messages)).toBe(2);
      });

      it("should handle empty messages array", async () => {
        expect(cacheUtils.countContentBlocks([])).toBe(0);
      });

      it("should handle mixed content types across messages", async () => {
        const messages = [
          { role: "system" as const, content: "System" }, // 1
          {
            role: "user" as const,
            content: [
              { type: "text" as const, text: "a" },
              { type: "text" as const, text: "b" },
            ],
          }, // 2
          { role: "assistant" as const, content: "reply" }, // 1
          {
            role: "assistant" as const,
            content: null,
            tool_calls: [],
          }, // 0
          { role: "user" as const, content: "hello" }, // 1
        ] as ChatCompletionMessageParam[];

        expect(cacheUtils.countContentBlocks(messages)).toBe(5);
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

        // Mixed content user message should preserve structure with cache control on last text part
        expect(Array.isArray(callArgs.messages[1].content)).toBe(true);
        const userContent = callArgs.messages[1].content as Array<
          Record<string, unknown>
        >;
        expect(userContent).toHaveLength(3);
        expect(userContent[0]).toEqual({
          type: "text",
          text: "Here's an image:",
        });
        expect(userContent[1]).toEqual({
          type: "image_url",
          image_url: {
            url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
          },
        });
        expect(userContent[2]).toEqual({
          type: "text",
          text: "What do you see?",
          cache_control: { type: "ephemeral" },
        });

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
          config: { model: "gpt-4o", fastModel: "gpt-4o-mini" },
        },
        {
          name: "OpenAI GPT-3.5",
          config: { model: "gpt-3.5-turbo", fastModel: "gpt-3.5-turbo" },
        },
        {
          name: "Google Gemini",
          config: { model: "gemini-pro", fastModel: "gemini-flash" },
        },
        {
          name: "Meta Llama",
          config: { model: "llama2-70b", fastModel: "llama2-7b" },
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
              model: testCase.modelName,
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
          modelConfig: { model: "gpt-4o", fastModel: "gpt-4o-mini" },
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

    describe("prompt_tokens_details cache extraction", () => {
      it("should extract cached_tokens from prompt_tokens_details for non-Claude models", async () => {
        const mockWithResponse = vi.fn().mockResolvedValue({
          data: {
            choices: [
              {
                message: { content: "Test response" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
              prompt_tokens_details: {
                cached_tokens: 80,
              },
            },
          },
          response: {
            headers: new Map([["x-request-id", "req-12345"]]),
          },
        });
        mockCreate.mockReturnValue({ withResponse: mockWithResponse });

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: { model: "gpt-4o", fastModel: "gpt-4o-mini" },
          messages: [{ role: "user", content: "Test message" }],
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(result.usage).toBeDefined();
        expect(result.usage?.prompt_tokens).toBe(100);
        expect(result.usage?.completion_tokens).toBe(50);
        expect(result.usage?.total_tokens).toBe(150);
        expect(result.usage?.cache_read_input_tokens).toBe(80);
      });

      it("should extract cache_creation_input_tokens from prompt_tokens_details", async () => {
        const mockWithResponse = vi.fn().mockResolvedValue({
          data: {
            choices: [
              {
                message: { content: "Test response" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 200,
              completion_tokens: 50,
              total_tokens: 250,
              prompt_tokens_details: {
                cached_tokens: 120,
                cache_creation_input_tokens: 40,
              },
            },
          },
          response: {
            headers: new Map([["x-request-id", "req-12345"]]),
          },
        });
        mockCreate.mockReturnValue({ withResponse: mockWithResponse });

        const result = await callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: {
            model: "gemini-2.5-pro",
            fastModel: "gemini-2.5-flash",
          },
          messages: [{ role: "user", content: "Test message" }],
          workdir: "/test/workdir",
        });

        expect(result).toBeDefined();
        expect(result.usage?.cache_read_input_tokens).toBe(120);
        expect(result.usage?.cache_creation_input_tokens).toBe(40);
      });

      it("should prefer Claude top-level fields over prompt_tokens_details when both present", async () => {
        const mockWithResponse = vi.fn().mockResolvedValue({
          data: {
            choices: [
              {
                message: { content: "Test response" },
                finish_reason: "stop",
              },
            ],
            usage: {
              prompt_tokens: 100,
              completion_tokens: 50,
              total_tokens: 150,
              cache_read_input_tokens: 30,
              cache_creation_input_tokens: 70,
              prompt_tokens_details: {
                cached_tokens: 999,
                cache_creation_input_tokens: 888,
              },
            },
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
        // Claude top-level fields take priority
        expect(result.usage?.cache_read_input_tokens).toBe(30);
        expect(result.usage?.cache_creation_input_tokens).toBe(70);
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
