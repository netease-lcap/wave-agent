import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { Agent } from "@/agent.js";
import type { AgentCallbacks } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { createMockToolManager } from "../helpers/mockFactories.js";
import { Message } from "@/index.js";

// Mock AI Service
vi.mock("@/services/aiService");

// Mock tool registry to control tool execution
const { instance: mockToolManagerInstance, execute: mockToolExecute } =
  createMockToolManager();
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(function () {
    return mockToolManagerInstance;
  }),
}));

describe("Agent Tool Streaming Tests", () => {
  let agent: Agent;
  let mockCallAgent: ReturnType<typeof vi.fn>;
  let mockCallbacks: {
    onMessagesChange: Mock<NonNullable<AgentCallbacks["onMessagesChange"]>>;
  };

  beforeEach(async () => {
    // Create mock callbacks
    mockCallbacks = {
      onMessagesChange:
        vi.fn<NonNullable<AgentCallbacks["onMessagesChange"]>>(),
    };

    // Create Agent instance with required parameters
    agent = await Agent.create({
      callbacks: mockCallbacks,
    });

    mockCallAgent = vi.mocked(aiService.callAgent);
    vi.clearAllMocks();
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

    it("should add tool calls to agent.messages during streaming before execution completion", async () => {
      const messageStateSnapshots: Message[][] = [];
      let streamingCallbackExecuted = false;
      let aiCallCount = 0;

      mockCallbacks.onMessagesChange.mockImplementation((messages) => {
        // Take a snapshot of the message state at each change
        messageStateSnapshots.push(JSON.parse(JSON.stringify(messages)));
      });

      mockCallAgent.mockImplementation(async (options) => {
        aiCallCount++;

        if (aiCallCount === 1) {
          if (options.onToolUpdate) {
            // Simulate streaming tool parameter updates
            options.onToolUpdate!({
              id: "call_streaming",
              name: "write_file",
              parameters: '{"file_path":',
            });

            streamingCallbackExecuted = true;

            // Complete the parameters during streaming
            options.onToolUpdate!({
              id: "call_streaming",
              name: "write_file",
              parameters: '{"file_path": "/test.txt", "content": "hello"}',
            });

            // CRITICAL: Verify tool call is added to messages DURING streaming (before execution)
            const messagesAfterStreaming = agent.messages;
            const assistantMessage = messagesAfterStreaming.find(
              (m) => m.role === "assistant",
            );
            expect(assistantMessage).toBeDefined();

            const toolBlocks = assistantMessage!.blocks.filter(
              (b) => b.type === "tool",
            );
            const streamingToolBlock = toolBlocks.find(
              (block) => "id" in block && block.id === "call_streaming",
            );
            // This assertion confirms tool call exists in messages during streaming
            expect(streamingToolBlock).toBeDefined();
            expect(streamingToolBlock).toMatchObject({
              type: "tool",
              id: "call_streaming",
              name: "write_file",
              parameters: '{"file_path": "/test.txt", "content": "hello"}',
            });
          }

          return {
            tool_calls: [
              {
                id: "call_streaming",
                type: "function" as const,
                index: 0,
                function: {
                  name: "write_file",
                  arguments: JSON.stringify({
                    file_path: "/test.txt",
                    content: "hello",
                  }),
                },
              },
            ],
          };
        } else {
          // Second call: response after tool execution
          return {
            content: "File written successfully with streaming parameters",
          };
        }
      });

      // Mock tool execution
      mockToolExecute.mockImplementation(async (toolName: string) => {
        if (toolName === "write_file") {
          return {
            success: true,
            content: "File written successfully",
            shortResult: "File created",
          };
        }
        return { success: false, content: "Unknown tool" };
      });

      await agent.sendMessage("Write a test file with streaming");

      // Verify streaming callback was executed
      expect(streamingCallbackExecuted).toBe(true);

      // Verify AI service was called twice (initial + recursive)
      expect(mockCallAgent).toHaveBeenCalledTimes(2);

      // Verify tool was executed - proving the streaming verification didn't break the flow
      expect(mockToolExecute).toHaveBeenCalledTimes(1);
    });

    it("should maintain tool calls in messages throughout the streaming lifecycle", async () => {
      let aiCallCount = 0;

      mockCallAgent.mockImplementation(async (options) => {
        aiCallCount++;

        if (aiCallCount === 1) {
          if (options.onToolUpdate) {
            // Simulate progressive tool parameter streaming
            options.onToolUpdate({
              id: "call_lifecycle",
              name: "test_tool",
              parameters: '{"param": "value"}',
              parametersChunk: '{"param": "value"}',
            });
          }

          return {
            tool_calls: [
              {
                id: "call_lifecycle",
                type: "function" as const,
                index: 0,
                function: {
                  name: "test_tool",
                  arguments: JSON.stringify({ param: "value" }),
                },
              },
            ],
          };
        } else {
          return {
            content: "Task completed successfully.",
          };
        }
      });

      mockToolExecute.mockResolvedValue({
        success: true,
        content: "Tool executed successfully",
        shortResult: "Success",
      });

      await agent.sendMessage("Execute test tool");

      // Verify final message state contains completed tool call
      const messages = agent.messages;
      const assistantMessage = messages.find((msg) => msg.role === "assistant");
      expect(assistantMessage).toBeDefined();

      const toolBlock = assistantMessage!.blocks.find(
        (block) => block.type === "tool",
      );
      expect(toolBlock).toBeDefined();
      expect(toolBlock!.id).toBe("call_lifecycle");
      expect(toolBlock!.name).toBe("test_tool");
      expect(toolBlock!.success).toBe(true);
    });
  });

  describe("Tool Parameter Streaming Integration", () => {
    it("should handle real-time tool parameter streaming", async () => {
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
          // Simulate streaming tool parameter updates
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
                  parameters: '{"command": "ls -la"}',
                }),
              20,
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
          };
        } else {
          return {
            content: "Directory listing completed successfully.",
          };
        }
      });

      // Mock tool execution
      mockToolExecute.mockResolvedValue({
        success: true,
        content: "total 8\ndrwxr-xr-x 2 user user 4096 Jan 1 12:00 .",
        shortResult: "Directory listing completed",
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
              '{"param1": "value1", "param2": ["item1", "item2"]}',
            ];

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
          return {
            content: "Parameters processed successfully",
          };
        }
      });

      mockToolExecute.mockResolvedValue({
        success: true,
        content: "Tool executed with accumulated parameters",
        shortResult: "Parameters processed",
      });

      await agent.sendMessage("Test parameter accumulation");

      // Verify parameter updates were received
      expect(parameterUpdates.length).toBe(4);

      // Verify progressive parameter building
      expect(parameterUpdates[0].parameters).toBe('{"param1":');
      expect(parameterUpdates[3].parameters).toBe(
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
            options.onToolUpdate!({
              id: "call_fast",
              name: "fast_tool",
              parameters: '{"quick": true}',
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
  });
});
