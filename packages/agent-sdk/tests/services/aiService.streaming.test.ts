import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { CallAgentOptions } from "@/services/aiService.js";
import type { GatewayConfig, ModelConfig } from "@/types/index.js";

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
    WAVE_API_KEY: "test-token",
    WAVE_BASE_URL: "https://test-url.com",
  },
  cwd: () => "/test/cwd",
}));

describe("AI Service - Streaming", () => {
  beforeEach(() => {
    // Reset mock for streaming tests
    mockCreate.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("content streaming functionality", () => {
    // Import the function after mocking
    let callAgent: (
      options: CallAgentOptions,
    ) => Promise<import("@/services/aiService.js").CallAgentResult>;

    beforeEach(async () => {
      const aiService = await import("@/services/aiService.js");
      callAgent = aiService.callAgent;
    });

    it("should enable streaming mode when onContentUpdate callback is provided", async () => {
      // Mock streaming response
      const mockStream = (async function* () {
        yield {
          choices: [
            {
              delta: { content: "Hello" },
            },
          ],
        };
        yield {
          choices: [
            {
              delta: { content: " world" },
              finish_reason: "stop",
            },
          ],
        };
      })();

      const mockWithResponse = vi.fn().mockResolvedValue({
        data: mockStream,
        response: {
          headers: new Map([["x-request-id", "req-stream-123"]]),
        },
      });
      mockCreate.mockReturnValue({ withResponse: mockWithResponse });

      const contentUpdates: string[] = [];

      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
        onContentUpdate: (content) => {
          contentUpdates.push(content);
        },
      });

      // Should call create with stream: true
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.stream).toBe(true);
      // Should include response headers
      expect(result.response_headers).toEqual({
        "x-request-id": "req-stream-123",
      });
      // Should include finish_reason
      expect(result.finish_reason).toBe("stop");
    });

    it("should accumulate content from multiple chunks with onContentUpdate", async () => {
      // Mock streaming response with multiple content chunks
      const mockStream = (async function* () {
        yield {
          choices: [
            {
              delta: { content: "Hello" },
            },
          ],
        };
        yield {
          choices: [
            {
              delta: { content: " " },
            },
          ],
        };
        yield {
          choices: [
            {
              delta: { content: "world!" },
            },
          ],
        };
      })();

      mockCreate.mockReturnValue({
        withResponse: vi.fn().mockResolvedValue({
          data: mockStream,
          response: {
            headers: new Map(),
          },
        }),
      });

      const contentUpdates: string[] = [];

      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
        onContentUpdate: (content) => {
          contentUpdates.push(content);
        },
      });

      // Should receive accumulated content in each update
      expect(contentUpdates).toEqual(["Hello", "Hello ", "Hello world!"]);

      // Final result should contain complete content
      expect(result.content).toBe("Hello world!");
    });

    it("should handle mixed content and tool streaming scenarios", async () => {
      // Mock streaming response with both content and tool calls
      const mockStream = (async function* () {
        yield {
          choices: [
            {
              delta: { content: "I'll help you with that. " },
            },
          ],
        };
        yield {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_456",
                    type: "function",
                    function: {
                      name: "file_read",
                      arguments: '{"path": "/test/file.txt"}',
                    },
                  },
                ],
              },
            },
          ],
        };
        yield {
          choices: [
            {
              delta: { content: "Let me read that file for you." },
            },
          ],
        };
      })();

      mockCreate.mockReturnValue({
        withResponse: vi.fn().mockResolvedValue({
          data: mockStream,
          response: {
            headers: new Map(),
          },
        }),
      });

      const contentUpdates: string[] = [];
      const toolUpdates: Array<{
        id: string;
        name: string;
        parameters: string;
      }> = [];

      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
        tools: [
          {
            type: "function",
            function: {
              name: "file_read",
              description: "Read a file",
              parameters: {},
            },
          },
        ],
        onContentUpdate: (content) => {
          contentUpdates.push(content);
        },
        onToolUpdate: (toolCall) => {
          toolUpdates.push(toolCall);
        },
      });

      // Should receive both content and tool updates
      expect(contentUpdates).toEqual([
        "I'll help you with that. ",
        "I'll help you with that. Let me read that file for you.",
      ]);

      // Final result should contain both content and tool calls
      expect(result.content).toBe(
        "I'll help you with that. Let me read that file for you.",
      );
      expect(result.tool_calls).toEqual([
        {
          id: "call_456",
          type: "function",
          function: {
            name: "file_read",
            arguments: '{"path": "/test/file.txt"}',
          },
        },
      ]);
    });

    it("should handle streaming errors gracefully", async () => {
      // Mock streaming response that throws an error
      const mockStream = (async function* () {
        yield {
          choices: [
            {
              delta: { content: "Starting response..." },
            },
          ],
        };
        throw new Error("Streaming error occurred");
      })();

      mockCreate.mockReturnValue({
        withResponse: vi.fn().mockResolvedValue({
          data: mockStream,
          response: {
            headers: new Map(),
          },
        }),
      });

      const contentUpdates: string[] = [];

      await expect(
        callAgent({
          gatewayConfig: TEST_GATEWAY_CONFIG,
          modelConfig: TEST_MODEL_CONFIG,
          messages: [{ role: "user", content: "Test message" }],
          workdir: "/test/workdir",
          onContentUpdate: (content) => {
            contentUpdates.push(content);
          },
        }),
      ).rejects.toThrow("Streaming error occurred");

      // Should have received partial content before error
      expect(contentUpdates).toEqual(["Starting response..."]);
    });

    it("should handle AbortSignal during streaming", async () => {
      const abortController = new AbortController();

      // Mock streaming response that will be aborted
      const mockStream = (async function* () {
        yield {
          choices: [
            {
              delta: { content: "Starting..." },
            },
          ],
        };
        // Simulate delay before next chunk
        await new Promise((resolve) => setTimeout(resolve, 100));
        yield {
          choices: [
            {
              delta: { content: " continuing..." },
            },
          ],
        };
      })();

      mockCreate.mockReturnValue({
        withResponse: vi.fn().mockResolvedValue({
          data: mockStream,
          response: {
            headers: new Map(),
          },
        }),
      });

      const contentUpdates: string[] = [];

      // Start the request
      const requestPromise = callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
        abortSignal: abortController.signal,
        onContentUpdate: (content) => {
          contentUpdates.push(content);
        },
      });

      // Abort after a short delay
      setTimeout(() => abortController.abort(), 50);

      await expect(requestPromise).rejects.toThrow("Request was aborted");

      // Should have passed the abort signal to the API call
      const callOptions = mockCreate.mock.calls[0][1];
      expect(callOptions.signal).toBe(abortController.signal);
    });

    it("should handle empty streaming responses", async () => {
      // Mock streaming response with no content
      const mockStream = (async function* () {
        yield {
          choices: [
            {
              delta: {},
            },
          ],
        };
        yield {
          choices: [
            {
              delta: {},
            },
          ],
        };
      })();

      mockCreate.mockReturnValue({
        withResponse: vi.fn().mockResolvedValue({
          data: mockStream,
          response: {
            headers: new Map(),
          },
        }),
      });

      const contentUpdates: string[] = [];

      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
        onContentUpdate: (content) => {
          contentUpdates.push(content);
        },
      });

      // Should not call onContentUpdate for empty deltas
      expect(contentUpdates).toEqual([]);

      // Final result should have no content
      expect(result.content).toBeUndefined();
    });

    it("should handle streaming with usage information", async () => {
      // Mock streaming response with usage data at the end
      const mockStream = (async function* () {
        yield {
          choices: [
            {
              delta: { content: "Test response" },
            },
          ],
        };
        yield {
          choices: [
            {
              delta: {},
            },
          ],
          usage: {
            prompt_tokens: 15,
            completion_tokens: 25,
            total_tokens: 40,
          },
        };
      })();

      mockCreate.mockReturnValue({
        withResponse: vi.fn().mockResolvedValue({
          data: mockStream,
          response: {
            headers: new Map(),
          },
        }),
      });

      const result = await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
        onContentUpdate: () => {},
      });

      // Should include usage information in the final result
      expect(result.usage).toEqual({
        prompt_tokens: 15,
        completion_tokens: 25,
        total_tokens: 40,
      });
    });

    it("should default to non-streaming when no streaming callbacks provided", async () => {
      mockCreate.mockReturnValue({
        withResponse: vi.fn().mockResolvedValue({
          data: {
            choices: [
              {
                message: {
                  content: "Non-streaming response",
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
            headers: new Map([["x-request-id", "req-non-stream"]]),
          },
        }),
      });

      await callAgent({
        gatewayConfig: TEST_GATEWAY_CONFIG,
        modelConfig: TEST_MODEL_CONFIG,
        messages: [{ role: "user", content: "Test message" }],
        workdir: "/test/workdir",
      });

      // Should call create with stream: false (or undefined)
      const callArgs = mockCreate.mock.calls[0][0];
      expect(callArgs.stream).toBeFalsy();
    });
  });
});
