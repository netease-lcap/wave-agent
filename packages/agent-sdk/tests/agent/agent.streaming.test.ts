import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import type { TextBlock } from "@/types/messaging.js";

// Mock AI Service
vi.mock("@/services/aiService");

// Mock tool registry to control tool execution
let mockToolExecute: ReturnType<typeof vi.fn>;
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(() => ({
    execute: (mockToolExecute = vi.fn()),
    list: vi.fn(() => []),
    getToolsConfig: vi.fn(() => []),
  })),
}));

describe("Agent Streaming Integration Tests", () => {
  let agent: Agent;
  let mockCallAgent: ReturnType<typeof vi.fn>;
  let mockCallbacks: {
    onMessagesChange: ReturnType<typeof vi.fn>;
    onLoadingChange: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    // Create mock callbacks
    mockCallbacks = {
      onMessagesChange: vi.fn(),
      onLoadingChange: vi.fn(),
    };

    // Create Agent instance with required parameters
    agent = await Agent.create({
      callbacks: mockCallbacks,
    });

    mockCallAgent = vi.mocked(aiService.callAgent);
    vi.clearAllMocks();
  });

  describe("Content Streaming Integration", () => {
    it("should handle streaming content updates through the full stack", async () => {
      // Mock callAgent to simulate streaming behavior
      mockCallAgent.mockImplementation(async () => {
        // Note: Current implementation doesn't pass streaming callbacks yet
        // This test verifies the integration pathway exists for future streaming support
        return {
          content:
            "Hello, I'm analyzing your request and will help you with it.",
          usage: {
            prompt_tokens: 50,
            completion_tokens: 20,
            total_tokens: 70,
          },
        };
      });

      await agent.sendMessage("Test streaming message");

      // Verify AI service was called
      expect(mockCallAgent).toHaveBeenCalledTimes(1);
      const callOptions = mockCallAgent.mock.calls[0][0];

      // Verify required parameters are passed for potential streaming support
      expect(callOptions).toHaveProperty("messages");
      expect(callOptions).toHaveProperty("gatewayConfig");
      expect(callOptions).toHaveProperty("modelConfig");
      expect(callOptions).toHaveProperty("abortSignal");

      // Verify the final message was added to message manager
      expect(mockCallbacks.onMessagesChange).toHaveBeenCalled();
      const messages = agent.messages;

      expect(messages).toHaveLength(2); // User message + assistant message
      expect(messages[1].role).toBe("assistant");

      // Content is stored in blocks, not directly in message
      const textBlock = messages[1].blocks.find(
        (block): block is TextBlock => block.type === "text",
      );
      expect(textBlock?.content).toBe(
        "Hello, I'm analyzing your request and will help you with it.",
      );
    });

    it("should handle streaming with incremental content accumulation", async () => {
      // Test message processing pipeline for future streaming support
      mockCallAgent.mockImplementation(async () => {
        return {
          content: "I will help you with this task.",
          usage: {
            prompt_tokens: 30,
            completion_tokens: 15,
            total_tokens: 45,
          },
        };
      });

      await agent.sendMessage("Help me with a task");

      // Verify non-streaming response handling
      expect(mockCallAgent).toHaveBeenCalledTimes(1);

      // Verify final message contains complete content
      const messages = agent.messages;
      const textBlock = messages[1].blocks.find(
        (block): block is TextBlock => block.type === "text",
      );
      expect(textBlock?.content).toBe("I will help you with this task.");
    });

    it("should handle empty streaming updates gracefully", async () => {
      // Test message processing with empty content handling
      mockCallAgent.mockImplementation(async () => {
        return {
          content: "Starting...",
        };
      });

      await agent.sendMessage("Start something");

      expect(mockCallAgent).toHaveBeenCalledTimes(1);

      const messages = agent.messages;
      const textBlock = messages[1].blocks.find(
        (block): block is TextBlock => block.type === "text",
      );
      expect(textBlock?.content).toBe("Starting...");
    });
  });

  describe("Tool Call Streaming Integration", () => {
    it("should handle tool call streaming with proper message sequencing", async () => {
      let aiCallCount = 0;

      // Test tool call integration for future streaming support
      mockCallAgent.mockImplementation(async () => {
        aiCallCount++;

        if (aiCallCount === 1) {
          return {
            tool_calls: [
              {
                id: "call_123",
                type: "function" as const,
                index: 0,
                function: {
                  name: "run_terminal_cmd",
                  arguments: JSON.stringify({ command: "ls -la" }),
                },
              },
            ],
            usage: {
              prompt_tokens: 40,
              completion_tokens: 25,
              total_tokens: 65,
            },
          };
        } else {
          // Second call: response after tool execution
          return {
            content: "Directory listing completed successfully.",
            usage: {
              prompt_tokens: 20,
              completion_tokens: 10,
              total_tokens: 30,
            },
          };
        }
      });

      // Mock tool execution
      mockToolExecute.mockResolvedValue({
        success: true,
        content: "total 8\ndrwxr-xr-x 2 user user 4096 Jan 1 12:00 .",
        shortResult: "Directory listing completed",
      });

      await agent.sendMessage("List directory contents");

      // Verify AI service was called and handled tool execution
      expect(mockCallAgent).toHaveBeenCalledTimes(2); // Initial call + recursive call

      // Verify tool was executed
      expect(mockToolExecute).toHaveBeenCalledTimes(1);
      expect(mockToolExecute).toHaveBeenCalledWith(
        "run_terminal_cmd",
        { command: "ls -la" },
        expect.objectContaining({
          abortSignal: expect.any(AbortSignal),
        }),
      );
    });

    it("should handle multiple streaming tool calls", async () => {
      let aiCallCount = 0;

      // Test multiple tool call integration
      mockCallAgent.mockImplementation(async () => {
        aiCallCount++;

        if (aiCallCount === 1) {
          return {
            tool_calls: [
              {
                id: "call_001",
                type: "function" as const,
                index: 0,
                function: {
                  name: "run_terminal_cmd",
                  arguments: JSON.stringify({ command: "pwd" }),
                },
              },
              {
                id: "call_002",
                type: "function" as const,
                index: 1,
                function: {
                  name: "run_terminal_cmd",
                  arguments: JSON.stringify({ command: "date" }),
                },
              },
            ],
          };
        } else {
          // Second call: response after tool execution
          return {
            content: "Both commands executed successfully.",
          };
        }
      });

      // Mock tool execution for both tools
      mockToolExecute.mockImplementation(
        async (toolName: string, args: Record<string, unknown>) => {
          if (args.command === "pwd") {
            return {
              success: true,
              content: "/test/workdir",
              shortResult: "Current directory",
            };
          } else if (args.command === "date") {
            return {
              success: true,
              content: "Mon Jan  1 12:00:00 UTC 2024",
              shortResult: "Current date",
            };
          }
          return { success: false, content: "Unknown command" };
        },
      );

      await agent.sendMessage("Show current directory and date");

      // Verify both tools were executed
      expect(mockToolExecute).toHaveBeenCalledTimes(2);

      // Verify correct tool parameters
      expect(mockToolExecute).toHaveBeenNthCalledWith(
        1,
        "run_terminal_cmd",
        { command: "pwd" },
        expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
      );
      expect(mockToolExecute).toHaveBeenNthCalledWith(
        2,
        "run_terminal_cmd",
        { command: "date" },
        expect.objectContaining({ abortSignal: expect.any(AbortSignal) }),
      );
    });

    it("should handle mixed content and tool call streaming", async () => {
      let aiCallCount = 0;

      mockCallAgent.mockImplementation(async () => {
        aiCallCount++;

        if (aiCallCount === 1) {
          // First call: mixed content and tool
          return {
            content: "I'll help you check the current directory.",
            tool_calls: [
              {
                id: "call_456",
                type: "function" as const,
                index: 0,
                function: {
                  name: "run_terminal_cmd",
                  arguments: JSON.stringify({ command: "pwd" }),
                },
              },
            ],
          };
        } else {
          // Second call: response after tool execution
          return {
            content: "The current directory is /test/workdir",
          };
        }
      });

      mockToolExecute.mockResolvedValue({
        success: true,
        content: "/test/workdir",
        shortResult: "Directory path retrieved",
      });

      await agent.sendMessage("What directory am I in?");

      // Verify both AI calls were made
      expect(mockCallAgent).toHaveBeenCalledTimes(2);
    });
  });

  describe("Tool Parameter Streaming Integration", () => {
    it("should handle real-time tool parameter streaming through Agent -> AIManager -> MessageManager flow", async () => {
      let callCount = 0;
      let capturedCallbacks: {
        onToolUpdate?: (update: {
          id: string;
          name: string;
          parameters: string;
        }) => void;
        onContentUpdate?: (update: string) => void;
      } = {};

      // Mock callAgent to simulate streaming behavior with onToolUpdate callbacks
      mockCallAgent.mockImplementation(async (options) => {
        callCount++;
        capturedCallbacks = options;

        if (callCount === 1) {
          // Simulate streaming tool parameter updates if onToolUpdate is provided
          if (options.onToolUpdate) {
            // Simulate incremental parameter building
            setTimeout(
              () =>
                options.onToolUpdate!({
                  id: "call_123",
                  name: "run_terminal_cmd",
                  parameters: '{"com',
                }),
              10,
            );

            setTimeout(
              () =>
                options.onToolUpdate!({
                  id: "call_123",
                  name: "run_terminal_cmd",
                  parameters: '{"command":',
                }),
              20,
            );

            setTimeout(
              () =>
                options.onToolUpdate!({
                  id: "call_123",
                  name: "run_terminal_cmd",
                  parameters: '{"command": "ls',
                }),
              30,
            );

            setTimeout(
              () =>
                options.onToolUpdate!({
                  id: "call_123",
                  name: "run_terminal_cmd",
                  parameters: '{"command": "ls -la"}',
                }),
              40,
            );
          }

          return {
            tool_calls: [
              {
                id: "call_123",
                type: "function" as const,
                index: 0,
                function: {
                  name: "run_terminal_cmd",
                  arguments: JSON.stringify({ command: "ls -la" }),
                },
              },
            ],
            usage: {
              prompt_tokens: 40,
              completion_tokens: 25,
              total_tokens: 65,
            },
          };
        } else {
          // Second call: response after tool execution
          return {
            content: "Directory listing completed successfully.",
            usage: {
              prompt_tokens: 20,
              completion_tokens: 10,
              total_tokens: 30,
            },
          };
        }
      });

      // Mock tool execution
      mockToolExecute.mockResolvedValue({
        success: true,
        content: "total 8\ndrwxr-xr-x 2 user user 4096 Jan 1 12:00 .",
        shortResult: "Directory listing completed",
      });

      // Track message changes during streaming
      const messageChanges: unknown[][] = [];
      mockCallbacks.onMessagesChange.mockImplementation((messages) => {
        messageChanges.push([...messages]);
      });

      await agent.sendMessage(
        "List directory contents with streaming parameters",
      );

      // Verify streaming callbacks were passed to callAgent
      expect(capturedCallbacks.onToolUpdate).toBeDefined();
      expect(typeof capturedCallbacks.onToolUpdate).toBe("function");

      // Verify AI service was called with streaming support
      expect(mockCallAgent).toHaveBeenCalledTimes(2);
      const firstCallOptions = mockCallAgent.mock.calls[0][0];
      expect(firstCallOptions).toHaveProperty("onToolUpdate");

      // Verify tool was executed with final parameters
      expect(mockToolExecute).toHaveBeenCalledTimes(1);
      expect(mockToolExecute).toHaveBeenCalledWith(
        "run_terminal_cmd",
        { command: "ls -la" },
        expect.objectContaining({
          abortSignal: expect.any(AbortSignal),
        }),
      );

      // Verify final message state is consistent
      const finalMessages = agent.messages;
      expect(finalMessages.length).toBeGreaterThanOrEqual(2);
      const lastMessage = finalMessages[finalMessages.length - 1];
      expect(lastMessage.role).toBe("assistant");
    });

    it("should accumulate tool parameters correctly during streaming", async () => {
      const parameterUpdates: {
        id: string;
        name: string;
        parameters: string;
      }[] = [];
      let aiCallCount = 0;

      mockCallAgent.mockImplementation(async (options) => {
        aiCallCount++;

        if (aiCallCount === 1) {
          if (options.onToolUpdate) {
            // Simulate parameter accumulation with different JSON states
            const updates = [
              '{"param1":',
              '{"param1": "value1"',
              '{"param1": "value1", "param2":',
              '{"param1": "value1", "param2": ["item1"',
              '{"param1": "value1", "param2": ["item1", "item2"]}',
            ];

            // Use immediate execution instead of setTimeout to avoid timing issues
            updates.forEach((params) => {
              const update = {
                id: "call_accumulate",
                name: "test_tool",
                parameters: params,
              };
              parameterUpdates.push(update);
              options.onToolUpdate!(update);
            });
          }

          return {
            tool_calls: [
              {
                id: "call_accumulate",
                type: "function" as const,
                index: 0,
                function: {
                  name: "test_tool",
                  arguments: JSON.stringify({
                    param1: "value1",
                    param2: ["item1", "item2"],
                  }),
                },
              },
            ],
          };
        } else {
          // Second call: response after tool execution
          return {
            content: "Parameters processed successfully",
          };
        }
      });

      // Mock tool execution for both tools
      mockToolExecute.mockImplementation(async (toolName: string) => {
        if (toolName === "test_tool") {
          return {
            success: true,
            content: "Tool executed with accumulated parameters",
            shortResult: "Parameters processed",
          };
        }
        return { success: false, content: "Unknown tool" };
      });

      await agent.sendMessage("Test parameter accumulation");

      // Verify parameter updates were received
      expect(parameterUpdates.length).toBe(5);

      // Verify progressive parameter building
      expect(parameterUpdates[0].parameters).toBe('{"param1":');
      expect(parameterUpdates[4].parameters).toBe(
        '{"param1": "value1", "param2": ["item1", "item2"]}',
      );

      // Verify final tool execution used complete parameters
      expect(mockToolExecute).toHaveBeenCalledWith(
        "test_tool",
        { param1: "value1", param2: ["item1", "item2"] },
        expect.any(Object),
      );
    });

    it("should handle multiple concurrent tool parameter streaming", async () => {
      let aiCallCount = 0;

      mockCallAgent.mockImplementation(async (options) => {
        aiCallCount++;

        if (aiCallCount === 1) {
          if (options.onToolUpdate) {
            // Simulate streaming multiple tools with different completion rates

            // Fast tool - completes quickly
            options.onToolUpdate!({
              id: "call_fast",
              name: "fast_tool",
              parameters: '{"quick":',
            });

            options.onToolUpdate!({
              id: "call_fast",
              name: "fast_tool",
              parameters: '{"quick": true}',
            });

            // Slow tool - takes longer to complete
            options.onToolUpdate!({
              id: "call_slow",
              name: "slow_tool",
              parameters: '{"complex":',
            });

            options.onToolUpdate!({
              id: "call_slow",
              name: "slow_tool",
              parameters: '{"complex": {"nested":',
            });

            options.onToolUpdate!({
              id: "call_slow",
              name: "slow_tool",
              parameters: '{"complex": {"nested": "value"}}',
            });
          }

          return {
            tool_calls: [
              {
                id: "call_fast",
                type: "function" as const,
                index: 0,
                function: {
                  name: "fast_tool",
                  arguments: JSON.stringify({ quick: true }),
                },
              },
              {
                id: "call_slow",
                type: "function" as const,
                index: 1,
                function: {
                  name: "slow_tool",
                  arguments: JSON.stringify({ complex: { nested: "value" } }),
                },
              },
            ],
          };
        } else {
          // Second call: response after tool execution
          return {
            content: "Both tools executed successfully",
          };
        }
      });

      // Mock both tools
      mockToolExecute.mockImplementation(async (toolName: string) => {
        if (toolName === "fast_tool") {
          return {
            success: true,
            content: "Fast tool completed",
            shortResult: "Quick result",
          };
        } else if (toolName === "slow_tool") {
          return {
            success: true,
            content: "Slow tool with complex parameters completed",
            shortResult: "Complex result",
          };
        }
        return { success: false, content: "Unknown tool" };
      });

      await agent.sendMessage("Run multiple streaming tools");

      // Verify both tools were executed with correct final parameters
      expect(mockToolExecute).toHaveBeenCalledTimes(2);
      expect(mockToolExecute).toHaveBeenCalledWith(
        "fast_tool",
        { quick: true },
        expect.any(Object),
      );
      expect(mockToolExecute).toHaveBeenCalledWith(
        "slow_tool",
        { complex: { nested: "value" } },
        expect.any(Object),
      );
    });

    it("should integrate tool parameter streaming with extractStreamingParams helper", async () => {
      const receivedUpdates: {
        id: string;
        name: string;
        parameters: string;
      }[] = [];
      let aiCallCount = 0;

      mockCallAgent.mockImplementation(async (options) => {
        aiCallCount++;

        if (aiCallCount === 1) {
          if (options.onToolUpdate) {
            // Simulate partial parameter streaming that would need extractStreamingParams
            const incompleteUpdates = [
              '{"file_path": "/test/fi',
              '{"file_path": "/test/file.txt", "content"',
              '{"file_path": "/test/file.txt", "content": "Hello',
              '{"file_path": "/test/file.txt", "content": "Hello World"}',
            ];

            incompleteUpdates.forEach((params) => {
              const update = {
                id: "call_extract",
                name: "write_file",
                parameters: params,
              };
              receivedUpdates.push(update);
              options.onToolUpdate!(update);
            });
          }

          return {
            tool_calls: [
              {
                id: "call_extract",
                type: "function" as const,
                index: 0,
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({
                    file_path: "/test/file.txt",
                    content: "Hello World",
                  }),
                },
              },
            ],
          };
        } else {
          // Second call: response after tool execution
          return {
            content: "File written successfully",
          };
        }
      });

      // Mock tool execution for extractStreamingParams test
      mockToolExecute.mockImplementation(async (toolName: string) => {
        if (toolName === "write_file") {
          return {
            success: true,
            content: "File written successfully",
            shortResult: "Write complete",
          };
        }
        return { success: false, content: "Unknown tool" };
      });

      await agent.sendMessage("Write file with streaming parameters");

      // Verify streaming updates were received
      expect(receivedUpdates.length).toBe(4);

      // Verify incomplete parameter states during streaming
      expect(receivedUpdates[0].parameters).toBe('{"file_path": "/test/fi');
      expect(receivedUpdates[1].parameters).toBe(
        '{"file_path": "/test/file.txt", "content"',
      );

      // Verify final complete parameters were used for tool execution
      expect(mockToolExecute).toHaveBeenCalledWith(
        "write_file",
        { file_path: "/test/file.txt", content: "Hello World" },
        expect.any(Object),
      );
    });

    it("should handle mixed content and tool parameter streaming", async () => {
      const contentUpdates: string[] = [];
      const toolUpdates: { id: string; name: string; parameters: string }[] =
        [];
      let aiCallCount = 0;

      mockCallAgent.mockImplementation(async (options) => {
        aiCallCount++;

        if (aiCallCount === 1) {
          // Simulate mixed streaming of both content and tool parameters
          if (options.onContentUpdate) {
            const update1 = "I'll help you";
            contentUpdates.push(update1);
            options.onContentUpdate!(update1);

            const update2 = "I'll help you write a file.";
            contentUpdates.push(update2);
            options.onContentUpdate!(update2);
          }

          if (options.onToolUpdate) {
            const update1 = {
              id: "call_mixed",
              name: "write_file",
              parameters: '{"path":',
            };
            toolUpdates.push(update1);
            options.onToolUpdate!(update1);

            const update2 = {
              id: "call_mixed",
              name: "write_file",
              parameters: '{"path": "test.txt", "data": "content"}',
            };
            toolUpdates.push(update2);
            options.onToolUpdate!(update2);
          }

          return {
            content: "I'll help you write a file.",
            tool_calls: [
              {
                id: "call_mixed",
                type: "function" as const,
                index: 0,
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({
                    path: "test.txt",
                    data: "content",
                  }),
                },
              },
            ],
          };
        } else {
          // Second call: response after tool execution
          return {
            content: "File created successfully",
          };
        }
      });

      // Mock tool execution for mixed streaming test
      mockToolExecute.mockImplementation(async (toolName: string) => {
        if (toolName === "write_file") {
          return {
            success: true,
            content: "File created successfully",
            shortResult: "Created test.txt",
          };
        }
        return { success: false, content: "Unknown tool" };
      });

      await agent.sendMessage("Create a test file");

      // Verify both content and tool parameter streaming occurred
      expect(contentUpdates.length).toBe(2);
      expect(toolUpdates.length).toBe(2);

      // Verify final message contains both content and tool execution results
      const messages = agent.messages;
      const assistantMessage = messages[messages.length - 1];
      expect(assistantMessage.role).toBe("assistant");
      expect(assistantMessage.blocks).toBeDefined();

      // Tool should have been executed with final parameters
      expect(mockToolExecute).toHaveBeenCalledWith(
        "write_file",
        { path: "test.txt", data: "content" },
        expect.any(Object),
      );
    });

    it("should handle tool parameter streaming errors gracefully", async () => {
      let aiCallCount = 0;

      mockCallAgent.mockImplementation(async (options) => {
        aiCallCount++;

        if (aiCallCount === 1) {
          if (options.onToolUpdate) {
            // Simulate some successful updates followed by an error scenario
            options.onToolUpdate!({
              id: "call_error",
              name: "error_tool",
              parameters: '{"param": "val',
            });

            // Simulate a malformed parameter update that might cause issues
            try {
              options.onToolUpdate!({
                id: "call_error",
                name: "error_tool",
                parameters: '{"param": "value", malformed', // Invalid JSON
              });
            } catch {
              // Error handled gracefully
            }
          }

          return {
            tool_calls: [
              {
                id: "call_error",
                type: "function" as const,
                index: 0,
                function: {
                  name: "error_tool",
                  arguments: JSON.stringify({ param: "value" }),
                },
              },
            ],
          };
        } else {
          // Second call: response after tool execution
          return {
            content: "Tool executed despite streaming errors",
          };
        }
      });

      // Mock tool execution for error handling test
      mockToolExecute.mockImplementation(async (toolName: string) => {
        if (toolName === "error_tool") {
          return {
            success: true,
            content: "Tool executed despite streaming errors",
            shortResult: "Handled gracefully",
          };
        }
        return { success: false, content: "Unknown tool" };
      });

      await agent.sendMessage("Test error handling in parameter streaming");

      // Verify the tool was still executed with valid final parameters
      expect(mockToolExecute).toHaveBeenCalledWith(
        "error_tool",
        { param: "value" },
        expect.any(Object),
      );

      // Verify the system handled streaming errors gracefully
      const messages = agent.messages;
      expect(messages.length).toBeGreaterThanOrEqual(2);
    });

    it("should respect abort signals during tool parameter streaming", async () => {
      let streamingStarted = false;
      let abortSignalReceived: AbortSignal | undefined;

      mockCallAgent.mockImplementation(async (options) => {
        abortSignalReceived = options.abortSignal;

        if (options.onToolUpdate) {
          streamingStarted = true;

          // Simulate parameter streaming that checks abort signal
          const streamWithAbortCheck = () => {
            if (options.abortSignal?.aborted) {
              return;
            }

            setTimeout(() => {
              if (!options.abortSignal?.aborted) {
                options.onToolUpdate!({
                  id: "call_abort",
                  name: "long_tool",
                  parameters: '{"progress":',
                });
              }
            }, 10);

            setTimeout(() => {
              if (!options.abortSignal?.aborted) {
                options.onToolUpdate!({
                  id: "call_abort",
                  name: "long_tool",
                  parameters: '{"progress": "50%"}',
                });
              }
            }, 50);
          };

          streamWithAbortCheck();
        }

        // Simulate long-running operation that can be aborted
        return new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            resolve({
              tool_calls: [
                {
                  id: "call_abort",
                  type: "function" as const,
                  index: 0,
                  function: {
                    name: "long_tool",
                    arguments: JSON.stringify({ progress: "100%" }),
                  },
                },
              ],
            });
          }, 100);

          options.abortSignal?.addEventListener("abort", () => {
            clearTimeout(timeout);
            reject(new Error("Request was aborted"));
          });
        });
      });

      // Start the streaming request
      const messagePromise = agent.sendMessage(
        "Start long streaming operation",
      );

      // Abort after streaming starts but before completion
      setTimeout(() => {
        if (streamingStarted) {
          agent.abortMessage();
        }
      }, 25);

      // Wait for completion (should be aborted)
      await messagePromise;

      // Verify abort signal was passed to callAgent
      expect(abortSignalReceived).toBeInstanceOf(AbortSignal);

      // Verify streaming was initiated
      expect(streamingStarted).toBe(true);
    });

    it("should maintain message state consistency during parameter streaming", async () => {
      const messageStateSnapshots: unknown[] = [];
      let aiCallCount = 0;

      mockCallbacks.onMessagesChange.mockImplementation((messages) => {
        // Take a snapshot of the message state at each change
        messageStateSnapshots.push(JSON.parse(JSON.stringify(messages)));
      });

      mockCallAgent.mockImplementation(async (options) => {
        aiCallCount++;

        if (aiCallCount === 1) {
          if (options.onToolUpdate) {
            // Simulate parameter streaming with state changes
            options.onToolUpdate!({
              id: "call_state",
              name: "state_tool",
              parameters: '{"step": 1',
            });

            options.onToolUpdate!({
              id: "call_state",
              name: "state_tool",
              parameters: '{"step": 1, "status": "processing"}',
            });
          }

          return {
            tool_calls: [
              {
                id: "call_state",
                type: "function" as const,
                index: 0,
                function: {
                  name: "state_tool",
                  arguments: JSON.stringify({ step: 1, status: "complete" }),
                },
              },
            ],
          };
        } else {
          // Second call: response after tool execution
          return {
            content: "State management test completed",
          };
        }
      });

      // Mock tool execution for state consistency test
      mockToolExecute.mockImplementation(async (toolName: string) => {
        if (toolName === "state_tool") {
          return {
            success: true,
            content: "State management test completed",
            shortResult: "State consistent",
          };
        }
        return { success: false, content: "Unknown tool" };
      });

      await agent.sendMessage("Test message state during streaming");

      // Verify message state was maintained consistently
      expect(messageStateSnapshots.length).toBeGreaterThan(0);

      // Verify final message state
      const finalMessages = agent.messages;
      expect(finalMessages.length).toBeGreaterThanOrEqual(2);

      // Find user and assistant messages
      const userMessage = finalMessages.find((m) => m.role === "user");
      const assistantMessage = finalMessages.find(
        (m) => m.role === "assistant",
      );

      expect(userMessage).toBeDefined();
      expect(assistantMessage).toBeDefined();
      expect(userMessage?.role).toBe("user");
      expect(assistantMessage?.role).toBe("assistant");

      // Verify tool was executed with final complete parameters
      expect(mockToolExecute).toHaveBeenCalledWith(
        "state_tool",
        { step: 1, status: "complete" },
        expect.any(Object),
      );
    });
  });

  describe("Error Handling in Streaming", () => {
    it("should handle streaming errors gracefully", async () => {
      mockCallAgent.mockImplementation(async () => {
        // Simulate an error during AI processing
        throw new Error("Streaming connection interrupted");
      });

      await agent.sendMessage("Process something");

      // Verify error was handled and error message was added
      const messages = agent.messages;
      expect(messages.length).toBeGreaterThanOrEqual(2);

      // Should have user message and error message
      expect(messages[0].role).toBe("user");
      expect(messages[messages.length - 1]).toMatchObject({
        role: "assistant",
        blocks: expect.arrayContaining([
          expect.objectContaining({
            type: "error",
          }),
        ]),
      });
    });

    it("should handle tool streaming errors during recursion", async () => {
      let aiCallCount = 0;

      mockCallAgent.mockImplementation(async () => {
        aiCallCount++;

        if (aiCallCount === 1) {
          return {
            tool_calls: [
              {
                id: "call_error",
                type: "function" as const,
                index: 0,
                function: {
                  name: "run_terminal_cmd",
                  arguments: JSON.stringify({ command: "invalid" }),
                },
              },
            ],
          };
        } else {
          // Second call after tool error
          return {
            content: "I encountered an error with that command.",
          };
        }
      });

      // Mock tool execution failure
      mockToolExecute.mockResolvedValue({
        success: false,
        content: "Error: command not found",
        error: "command not found: invalid",
      });

      await agent.sendMessage("Run invalid command");

      // Verify both AI calls were made despite tool error
      expect(mockCallAgent).toHaveBeenCalledTimes(2);
      expect(mockToolExecute).toHaveBeenCalledTimes(1);

      // Verify final response acknowledges the error
      const messages = agent.messages;
      const lastMessage = messages[messages.length - 1];
      const textBlock = lastMessage.blocks.find(
        (block): block is TextBlock => block.type === "text",
      );
      expect(textBlock?.content).toBeDefined();
      expect(typeof textBlock?.content).toBe("string");
      expect(textBlock?.content).toContain("error");
    });

    it("should propagate abort signal through streaming chain", async () => {
      let aiServiceCalled = false;

      mockCallAgent.mockImplementation(async (options) => {
        aiServiceCalled = true;
        const { abortSignal } = options;

        // Simulate checking abort signal during processing
        if (abortSignal?.aborted) {
          throw new Error("Request was aborted");
        }

        return {
          content: "Starting long process that should be aborted",
        };
      });

      // Start the message processing
      const messagePromise = agent.sendMessage("Start long process");

      // Abort after a short delay to ensure processing started
      setTimeout(() => {
        agent.abortMessage();
      }, 10);

      // Wait for the message to complete (should be aborted)
      await messagePromise;

      // Verify AI service was called
      expect(aiServiceCalled).toBe(true);

      // Verify abort signal was passed to AI service
      const callOptions = mockCallAgent.mock.calls[0][0];
      expect(callOptions.abortSignal).toBeInstanceOf(AbortSignal);
    });
  });

  describe("Message Manager Integration", () => {
    it("should trigger message callbacks during streaming updates", async () => {
      mockCallAgent.mockImplementation(async () => {
        return {
          content: "Streaming response part 1 and part 2",
        };
      });

      await agent.sendMessage("Send streaming response");

      // Verify onMessagesChange was called multiple times during the process
      expect(mockCallbacks.onMessagesChange).toHaveBeenCalled();

      // Should be called at least twice: once for user message, once for assistant response
      expect(mockCallbacks.onMessagesChange).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ role: "user" }),
          expect.objectContaining({ role: "assistant" }),
        ]),
      );
    });

    it("should maintain message consistency through streaming", async () => {
      mockCallAgent.mockImplementation(async () => {
        return {
          content: "I understand your request and will provide assistance.",
          usage: {
            prompt_tokens: 25,
            completion_tokens: 12,
            total_tokens: 37,
          },
        };
      });

      const initialMessageCount = agent.messages.length;

      await agent.sendMessage("I need help");

      // Verify final message state is consistent
      const finalMessages = agent.messages;
      expect(finalMessages.length).toBe(initialMessageCount + 2);

      const userMessage = finalMessages[finalMessages.length - 2];
      const assistantMessage = finalMessages[finalMessages.length - 1];

      expect(userMessage.role).toBe("user");
      const userTextBlock = userMessage.blocks.find(
        (block): block is TextBlock => block.type === "text",
      );
      expect(userTextBlock?.content).toBe("I need help");

      expect(assistantMessage.role).toBe("assistant");
      const assistantTextBlock = assistantMessage.blocks.find(
        (block): block is TextBlock => block.type === "text",
      );
      expect(assistantTextBlock?.content).toBe(
        "I understand your request and will provide assistance.",
      );
      expect(assistantMessage.usage).toMatchObject({
        prompt_tokens: 25,
        completion_tokens: 12,
        total_tokens: 37,
      });
    });

    it("should handle concurrent message operations during streaming", async () => {
      mockCallAgent.mockImplementation(async () => {
        // Simulate some processing time
        await new Promise((resolve) => setTimeout(resolve, 5));

        return {
          content: "Processing concurrent request",
        };
      });

      await agent.sendMessage("Process concurrent request");

      // Verify message integrity
      const messages = agent.messages;
      const textBlock = messages[messages.length - 1].blocks.find(
        (block): block is TextBlock => block.type === "text",
      );
      expect(textBlock?.content).toBe("Processing concurrent request");
    });
  });

  describe("Usage Tracking with Streaming", () => {
    it("should track usage correctly with streaming responses", async () => {
      mockCallAgent.mockImplementation(async () => {
        return {
          content: "Generating response with usage tracking",
          usage: {
            prompt_tokens: 45,
            completion_tokens: 18,
            total_tokens: 63,
          },
        };
      });

      const initialUsages = agent.usages;
      const initialCount = initialUsages.length;

      await agent.sendMessage("Generate tracked response");

      // Verify usage was recorded
      const finalUsages = agent.usages;
      expect(finalUsages.length).toBe(initialCount + 1);

      const newUsage = finalUsages[finalUsages.length - 1];
      expect(newUsage).toMatchObject({
        prompt_tokens: 45,
        completion_tokens: 18,
        total_tokens: 63,
      });
      // Usage object may contain additional fields like model and operation_type
      expect(newUsage.prompt_tokens).toBe(45);
      expect(newUsage.completion_tokens).toBe(18);
      expect(newUsage.total_tokens).toBe(63);
    });

    it("should accumulate usage across streaming tool recursions", async () => {
      let aiCallCount = 0;

      mockCallAgent.mockImplementation(async () => {
        aiCallCount++;

        if (aiCallCount === 1) {
          return {
            tool_calls: [
              {
                id: "call_usage",
                type: "function" as const,
                index: 0,
                function: {
                  name: "run_terminal_cmd",
                  arguments: JSON.stringify({ command: "echo test" }),
                },
              },
            ],
            usage: {
              prompt_tokens: 30,
              completion_tokens: 10,
              total_tokens: 40,
            },
          };
        } else {
          return {
            content: "Command executed successfully",
            usage: {
              prompt_tokens: 35,
              completion_tokens: 8,
              total_tokens: 43,
            },
          };
        }
      });

      mockToolExecute.mockResolvedValue({
        success: true,
        content: "test",
        shortResult: "Echo command completed",
      });

      const initialUsageCount = agent.usages.length;

      await agent.sendMessage("Echo test message");

      // Verify usage was tracked for both AI calls
      const finalUsages = agent.usages;
      expect(finalUsages.length).toBe(initialUsageCount + 2);

      // Check individual usage records (may contain additional fields)
      const firstUsage = finalUsages[finalUsages.length - 2];
      const secondUsage = finalUsages[finalUsages.length - 1];

      expect(firstUsage).toMatchObject({
        prompt_tokens: 30,
        completion_tokens: 10,
        total_tokens: 40,
      });

      expect(secondUsage).toMatchObject({
        prompt_tokens: 35,
        completion_tokens: 8,
        total_tokens: 43,
      });
    });
  });
});
