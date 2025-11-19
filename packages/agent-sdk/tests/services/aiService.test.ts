import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  CompressMessagesOptions,
  CallAgentOptions,
} from "@/services/aiService.js";
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

    describe("streaming functionality", () => {
      beforeEach(() => {
        // Reset mock for streaming tests
        mockCreate.mockReset();
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
              },
            ],
          };
        })();

        mockCreate.mockResolvedValueOnce(mockStream);

        const contentUpdates: string[] = [];

        await callAgent({
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

        mockCreate.mockResolvedValueOnce(mockStream);

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

      it("should handle tool call streaming with onToolUpdate callback", async () => {
        // Mock streaming response with tool calls
        const mockStream = (async function* () {
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_123",
                      type: "function",
                      function: {
                        name: "test_tool",
                        arguments: '{"param1"',
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
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: {
                        arguments: ': "value1"}',
                      },
                    },
                  ],
                },
              },
            ],
          };
        })();

        mockCreate.mockResolvedValueOnce(mockStream);

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
                name: "test_tool",
                description: "A test tool",
                parameters: {},
              },
            },
          ],
          onToolUpdate: (toolCall) => {
            toolUpdates.push(toolCall);
          },
        });

        // Should receive tool updates with accumulated parameters
        expect(toolUpdates).toEqual([
          {
            id: "call_123",
            name: "test_tool",
            parameters: '{"param1"',
          },
          {
            id: "call_123",
            name: "test_tool",
            parameters: '{"param1": "value1"}',
            extractedParams: { param1: "value1" },
          },
        ]);

        // Final result should contain complete tool calls
        expect(result.tool_calls).toEqual([
          {
            id: "call_123",
            type: "function",
            function: {
              name: "test_tool",
              arguments: '{"param1": "value1"}',
            },
          },
        ]);
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

        mockCreate.mockResolvedValueOnce(mockStream);

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

        expect(toolUpdates).toEqual([
          {
            id: "call_456",
            name: "file_read",
            parameters: '{"path": "/test/file.txt"}',
            extractedParams: { path: "/test/file.txt" },
          },
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

        mockCreate.mockResolvedValueOnce(mockStream);

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

        mockCreate.mockResolvedValueOnce(mockStream);

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

        mockCreate.mockResolvedValueOnce(mockStream);

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

        mockCreate.mockResolvedValueOnce(mockStream);

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
        mockCreate.mockResolvedValueOnce({
          choices: [
            {
              message: {
                content: "Non-streaming response",
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

        // Should call create with stream: false (or undefined)
        const callArgs = mockCreate.mock.calls[0][0];
        expect(callArgs.stream).toBeFalsy();
      });

      describe("tool parameter streaming functionality", () => {
        it("should handle incremental JSON parameter building for string values", async () => {
          // Mock streaming response with incremental JSON building
          const mockStream = (async function* () {
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_123",
                        type: "function",
                        function: {
                          name: "file_read",
                          arguments: '{"path"',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ': "',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: "/home/user",
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: '/test.txt"}',
                        },
                      },
                    ],
                  },
                },
              ],
            };
          })();

          mockCreate.mockResolvedValueOnce(mockStream);

          const toolUpdates: Array<{
            id: string;
            name: string;
            parameters: string;
          }> = [];

          await callAgent({
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
            onToolUpdate: (toolCall) => {
              toolUpdates.push(toolCall);
            },
          });

          // Should receive incremental parameter updates as JSON is built
          expect(toolUpdates).toEqual([
            {
              id: "call_123",
              name: "file_read",
              parameters: '{"path"',
            },
            {
              id: "call_123",
              name: "file_read",
              parameters: '{"path": "',
              extractedParams: { path: "" },
            },
            {
              id: "call_123",
              name: "file_read",
              parameters: '{"path": "/home/user',
              extractedParams: { path: "/home/user" },
            },
            {
              id: "call_123",
              name: "file_read",
              parameters: '{"path": "/home/user/test.txt"}',
              extractedParams: { path: "/home/user/test.txt" },
            },
          ]);
        });

        it("should handle complex parameter types during streaming", async () => {
          // Mock streaming response with different data types
          const mockStream = (async function* () {
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
                          name: "complex_tool",
                          arguments: '{"name": "test",',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ' "count": 42,',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ' "enabled": true,',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ' "value": null}',
                        },
                      },
                    ],
                  },
                },
              ],
            };
          })();

          mockCreate.mockResolvedValueOnce(mockStream);

          const toolUpdates: Array<{
            id: string;
            name: string;
            parameters: string;
          }> = [];

          await callAgent({
            gatewayConfig: TEST_GATEWAY_CONFIG,
            modelConfig: TEST_MODEL_CONFIG,
            messages: [{ role: "user", content: "Test message" }],
            workdir: "/test/workdir",
            tools: [
              {
                type: "function",
                function: {
                  name: "complex_tool",
                  description: "A complex tool",
                  parameters: {},
                },
              },
            ],
            onToolUpdate: (toolCall) => {
              toolUpdates.push(toolCall);
            },
          });

          // Should accumulate parameters with different data types
          expect(toolUpdates).toEqual([
            {
              id: "call_456",
              name: "complex_tool",
              parameters: '{"name": "test",',
              extractedParams: { name: "test" },
            },
            {
              id: "call_456",
              name: "complex_tool",
              parameters: '{"name": "test", "count": 42,',
              extractedParams: { name: "test", count: 42 },
            },
            {
              id: "call_456",
              name: "complex_tool",
              parameters: '{"name": "test", "count": 42, "enabled": true,',
              extractedParams: { name: "test", count: 42, enabled: true },
            },
            {
              id: "call_456",
              name: "complex_tool",
              parameters:
                '{"name": "test", "count": 42, "enabled": true, "value": null}',
              extractedParams: {
                name: "test",
                count: 42,
                enabled: true,
                value: null,
              },
            },
          ]);
        });

        it("should handle multiple tool calls streaming in parallel", async () => {
          // Mock streaming response with multiple concurrent tool calls
          const mockStream = (async function* () {
            // First tool call starts
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        id: "call_read",
                        index: 0,
                        type: "function",
                        function: {
                          name: "file_read",
                          arguments: '{"path": "file1.txt"}',
                        },
                      },
                    ],
                  },
                },
              ],
            };
            // Second tool call starts
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        id: "call_write",
                        index: 1,
                        type: "function",
                        function: {
                          name: "file_write",
                          arguments: '{"path"',
                        },
                      },
                    ],
                  },
                },
              ],
            };
            // Update second tool call
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 1,
                        function: {
                          arguments: ': "file2.txt", "content": "Hello"}',
                        },
                      },
                    ],
                  },
                },
              ],
            };
            // Third tool call starts
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        id: "call_delete",
                        index: 2,
                        type: "function",
                        function: {
                          name: "file_delete",
                          arguments: '{"path": "temp.txt"}',
                        },
                      },
                    ],
                  },
                },
              ],
            };
          })();

          mockCreate.mockResolvedValueOnce(mockStream);

          const toolUpdates: Array<{
            id: string;
            name: string;
            parameters: string;
          }> = [];

          await callAgent({
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
              {
                type: "function",
                function: {
                  name: "file_write",
                  description: "Write a file",
                  parameters: {},
                },
              },
              {
                type: "function",
                function: {
                  name: "file_delete",
                  description: "Delete a file",
                  parameters: {},
                },
              },
            ],
            onToolUpdate: (toolCall) => {
              toolUpdates.push(toolCall);
            },
          });

          // Should receive updates for each tool call independently
          expect(toolUpdates).toEqual([
            {
              id: "call_read",
              name: "file_read",
              parameters: '{"path": "file1.txt"}',
              extractedParams: { path: "file1.txt" },
            },
            {
              id: "call_write",
              name: "file_write",
              parameters: '{"path"',
            },
            {
              id: "call_write",
              name: "file_write",
              parameters: '{"path": "file2.txt", "content": "Hello"}',
              extractedParams: { path: "file2.txt", content: "Hello" },
            },
            {
              id: "call_delete",
              name: "file_delete",
              parameters: '{"path": "temp.txt"}',
              extractedParams: { path: "temp.txt" },
            },
          ]);
        });

        it("should handle parameter accumulation across many small chunks", async () => {
          // Mock streaming response with very small chunks to test accumulation
          const mockStream = (async function* () {
            const chunks = [
              "{",
              '"',
              "file",
              "name",
              '"',
              ":",
              " ",
              '"',
              "my",
              "-",
              "document",
              ".txt",
              '"',
              ",",
              " ",
              '"',
              "mode",
              '"',
              ":",
              " ",
              '"',
              "read",
              '"',
              "}",
            ];

            for (let i = 0; i < chunks.length; i++) {
              yield {
                choices: [
                  {
                    delta: {
                      tool_calls: [
                        i === 0
                          ? {
                              id: "call_accumulate",
                              index: 0,
                              type: "function",
                              function: {
                                name: "file_operation",
                                arguments: chunks[i],
                              },
                            }
                          : {
                              index: 0,
                              function: {
                                arguments: chunks[i],
                              },
                            },
                      ],
                    },
                  },
                ],
              };
            }
          })();

          mockCreate.mockResolvedValueOnce(mockStream);

          const toolUpdates: Array<{
            id: string;
            name: string;
            parameters: string;
          }> = [];

          await callAgent({
            gatewayConfig: TEST_GATEWAY_CONFIG,
            modelConfig: TEST_MODEL_CONFIG,
            messages: [{ role: "user", content: "Test message" }],
            workdir: "/test/workdir",
            tools: [
              {
                type: "function",
                function: {
                  name: "file_operation",
                  description: "File operation tool",
                  parameters: {},
                },
              },
            ],
            onToolUpdate: (toolCall) => {
              toolUpdates.push(toolCall);
            },
          });

          // Should accumulate all small chunks correctly
          expect(toolUpdates.length).toBe(24); // One update per chunk
          expect(toolUpdates[0]).toEqual({
            id: "call_accumulate",
            name: "file_operation",
            parameters: "{",
          });
          expect(toolUpdates[toolUpdates.length - 1]).toEqual({
            id: "call_accumulate",
            name: "file_operation",
            parameters: '{"filename": "my-document.txt", "mode": "read"}',
            extractedParams: { filename: "my-document.txt", mode: "read" },
          });
        });

        it("should handle escaped characters in streamed JSON parameters", async () => {
          // Mock streaming response with escaped characters
          const mockStream = (async function* () {
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        id: "call_escape",
                        index: 0,
                        type: "function",
                        function: {
                          name: "text_tool",
                          arguments: '{"message": "Hello',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: '\\nWorld!",',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ' "quote": "He said \\"Hi\\""}',
                        },
                      },
                    ],
                  },
                },
              ],
            };
          })();

          mockCreate.mockResolvedValueOnce(mockStream);

          const toolUpdates: Array<{
            id: string;
            name: string;
            parameters: string;
          }> = [];

          await callAgent({
            gatewayConfig: TEST_GATEWAY_CONFIG,
            modelConfig: TEST_MODEL_CONFIG,
            messages: [{ role: "user", content: "Test message" }],
            workdir: "/test/workdir",
            tools: [
              {
                type: "function",
                function: {
                  name: "text_tool",
                  description: "Text processing tool",
                  parameters: {},
                },
              },
            ],
            onToolUpdate: (toolCall) => {
              toolUpdates.push(toolCall);
            },
          });

          // Should preserve escaped characters in parameter strings
          expect(toolUpdates).toEqual([
            {
              id: "call_escape",
              name: "text_tool",
              parameters: '{"message": "Hello',
              extractedParams: { message: "Hello" },
            },
            {
              id: "call_escape",
              name: "text_tool",
              parameters: '{"message": "Hello\\nWorld!",',
              extractedParams: { message: "Hello\nWorld!" },
            },
            {
              id: "call_escape",
              name: "text_tool",
              parameters:
                '{"message": "Hello\\nWorld!", "quote": "He said \\"Hi\\""}',
              extractedParams: {
                message: "Hello\nWorld!",
                quote: 'He said "Hi"',
              },
            },
          ]);
        });

        it("should handle malformed JSON chunks gracefully", async () => {
          // Mock streaming response with some malformed chunks
          const mockStream = (async function* () {
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        id: "call_malformed",
                        index: 0,
                        type: "function",
                        function: {
                          name: "test_tool",
                          arguments: '{"valid": "start"',
                        },
                      },
                    ],
                  },
                },
              ],
            };
            // This chunk creates temporarily invalid JSON
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ', "incomplete": "val',
                        },
                      },
                    ],
                  },
                },
              ],
            };
            // This completes the parameter
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: 'ue"}',
                        },
                      },
                    ],
                  },
                },
              ],
            };
          })();

          mockCreate.mockResolvedValueOnce(mockStream);

          const toolUpdates: Array<{
            id: string;
            name: string;
            parameters: string;
          }> = [];

          await callAgent({
            gatewayConfig: TEST_GATEWAY_CONFIG,
            modelConfig: TEST_MODEL_CONFIG,
            messages: [{ role: "user", content: "Test message" }],
            workdir: "/test/workdir",
            tools: [
              {
                type: "function",
                function: {
                  name: "test_tool",
                  description: "Test tool",
                  parameters: {},
                },
              },
            ],
            onToolUpdate: (toolCall) => {
              toolUpdates.push(toolCall);
            },
          });

          // Should handle malformed intermediate states gracefully
          expect(toolUpdates).toEqual([
            {
              id: "call_malformed",
              name: "test_tool",
              parameters: '{"valid": "start"',
              extractedParams: { valid: "start" },
            },
            {
              id: "call_malformed",
              name: "test_tool",
              parameters: '{"valid": "start", "incomplete": "val',
              extractedParams: {
                valid: "start",
                incomplete: "val",
              },
            },
            {
              id: "call_malformed",
              name: "test_tool",
              parameters: '{"valid": "start", "incomplete": "value"}',
              extractedParams: { valid: "start", incomplete: "value" },
            },
          ]);
        });

        it("should handle decimal numbers and scientific notation in parameters", async () => {
          // Mock streaming response with various number formats
          const mockStream = (async function* () {
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        id: "call_numbers",
                        index: 0,
                        type: "function",
                        function: {
                          name: "math_tool",
                          arguments: '{"pi": 3.14159,',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ' "temp": -273.15,',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ' "large": 1.5e10}',
                        },
                      },
                    ],
                  },
                },
              ],
            };
          })();

          mockCreate.mockResolvedValueOnce(mockStream);

          const toolUpdates: Array<{
            id: string;
            name: string;
            parameters: string;
          }> = [];

          await callAgent({
            gatewayConfig: TEST_GATEWAY_CONFIG,
            modelConfig: TEST_MODEL_CONFIG,
            messages: [{ role: "user", content: "Test message" }],
            workdir: "/test/workdir",
            tools: [
              {
                type: "function",
                function: {
                  name: "math_tool",
                  description: "Math tool with numbers",
                  parameters: {},
                },
              },
            ],
            onToolUpdate: (toolCall) => {
              toolUpdates.push(toolCall);
            },
          });

          // Should handle various number formats correctly
          expect(toolUpdates).toEqual([
            {
              id: "call_numbers",
              name: "math_tool",
              parameters: '{"pi": 3.14159,',
              extractedParams: { pi: 3.14159 },
            },
            {
              id: "call_numbers",
              name: "math_tool",
              parameters: '{"pi": 3.14159, "temp": -273.15,',
              extractedParams: { pi: 3.14159, temp: -273.15 },
            },
            {
              id: "call_numbers",
              name: "math_tool",
              parameters: '{"pi": 3.14159, "temp": -273.15, "large": 1.5e10}',
              extractedParams: { pi: 3.14159, temp: -273.15, large: 1.5e10 },
            },
          ]);
        });

        it("should handle nested object and array parameters", async () => {
          // Mock streaming response with nested structures
          const mockStream = (async function* () {
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        id: "call_nested",
                        index: 0,
                        type: "function",
                        function: {
                          name: "data_tool",
                          arguments: '{"config": {',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: '"host": "localhost",',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ' "port": 8080},',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ' "tags": ["dev", "test"]}',
                        },
                      },
                    ],
                  },
                },
              ],
            };
          })();

          mockCreate.mockResolvedValueOnce(mockStream);

          const toolUpdates: Array<{
            id: string;
            name: string;
            parameters: string;
          }> = [];

          await callAgent({
            gatewayConfig: TEST_GATEWAY_CONFIG,
            modelConfig: TEST_MODEL_CONFIG,
            messages: [{ role: "user", content: "Test message" }],
            workdir: "/test/workdir",
            tools: [
              {
                type: "function",
                function: {
                  name: "data_tool",
                  description: "Tool with nested data",
                  parameters: {},
                },
              },
            ],
            onToolUpdate: (toolCall) => {
              toolUpdates.push(toolCall);
            },
          });

          // Should accumulate nested structures correctly
          expect(toolUpdates).toEqual([
            {
              id: "call_nested",
              name: "data_tool",
              parameters: '{"config": {',
            },
            {
              id: "call_nested",
              name: "data_tool",
              parameters: '{"config": {"host": "localhost",',
              extractedParams: { host: "localhost" },
            },
            {
              id: "call_nested",
              name: "data_tool",
              parameters: '{"config": {"host": "localhost", "port": 8080},',
              extractedParams: { host: "localhost", port: 8080 },
            },
            {
              id: "call_nested",
              name: "data_tool",
              parameters:
                '{"config": {"host": "localhost", "port": 8080}, "tags": ["dev", "test"]}',
              extractedParams: { host: "localhost", port: 8080 },
            },
          ]);
        });

        it("should demonstrate extractCompleteParams working with streaming parameters", async () => {
          // Import the helper function to demonstrate integration
          const { extractCompleteParams } = await import(
            "@/utils/streamingHelpers.js"
          );

          // Mock streaming response that builds parameters incrementally
          const mockStream = (async function* () {
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        id: "call_extract",
                        index: 0,
                        type: "function",
                        function: {
                          name: "extract_tool",
                          arguments: '{"name": "John",',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ' "age": 30, "active": true',
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
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ', "score": null}',
                        },
                      },
                    ],
                  },
                },
              ],
            };
          })();

          mockCreate.mockResolvedValueOnce(mockStream);

          const toolUpdates: Array<{
            id: string;
            name: string;
            parameters: string;
          }> = [];

          await callAgent({
            gatewayConfig: TEST_GATEWAY_CONFIG,
            modelConfig: TEST_MODEL_CONFIG,
            messages: [{ role: "user", content: "Test message" }],
            workdir: "/test/workdir",
            tools: [
              {
                type: "function",
                function: {
                  name: "extract_tool",
                  description: "Tool for testing parameter extraction",
                  parameters: {},
                },
              },
            ],
            onToolUpdate: (toolCall) => {
              toolUpdates.push(toolCall);

              // Demonstrate that extractCompleteParams can parse the partial JSON
              const completedParams = extractCompleteParams(
                toolCall.parameters,
              );
              console.log(
                `Completed params for ${toolCall.id}:`,
                completedParams,
              );
            },
          });

          // Verify that parameters build up correctly and can be parsed by extractCompleteParams
          expect(toolUpdates).toHaveLength(3);

          // Test extractCompleteParams on each partial state
          const firstParams = extractCompleteParams(toolUpdates[0].parameters);
          expect(firstParams).toEqual({
            name: "John",
          });

          const secondParams = extractCompleteParams(toolUpdates[1].parameters);
          expect(secondParams).toEqual({
            name: "John",
            age: 30,
            active: true,
          });

          const finalParams = extractCompleteParams(toolUpdates[2].parameters);
          expect(finalParams).toEqual({
            name: "John",
            age: 30,
            active: true,
            score: null,
          });

          // Verify final accumulated parameters
          expect(toolUpdates[2].parameters).toBe(
            '{"name": "John", "age": 30, "active": true, "score": null}',
          );
        });
      });
    });
  });

  describe("compressMessages", () => {
    // Import the function after mocking
    let compressMessages: (
      options: CompressMessagesOptions,
    ) => Promise<import("@/services/aiService.js").CompressMessagesResult>;

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

      expect(result.content).toBe(expectedContent);
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

      expect(result.content).toBe("Failed to compress conversation history");
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

      expect(result.content).toBe("Failed to compress conversation history");
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
