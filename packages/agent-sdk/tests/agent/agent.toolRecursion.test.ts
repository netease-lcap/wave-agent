import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import { createMockToolManager } from "../helpers/mockFactories.js";

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

describe("Agent Tool Recursion Tests", () => {
  let agent: Agent;
  let aiServiceCallCount: number;

  beforeEach(async () => {
    // Create mock callbacks
    const mockCallbacks = {
      onMessagesChange: vi.fn(),
      onLoadingChange: vi.fn(),
    };

    // Create Agent instance with required parameters
    agent = await Agent.create({
      callbacks: mockCallbacks,
    });

    // Reset counters
    aiServiceCallCount = 0;

    vi.clearAllMocks();
  });

  it("should trigger recursive AI call after tool execution and verify message structure", async () => {
    // Mock AI service returns tool calls, then returns simple response on second call
    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // First AI call: return tool call
        return {
          tool_calls: [
            {
              id: "call_123",
              type: "function" as const,
              index: 0,
              function: {
                name: "run_terminal_cmd",
                arguments: JSON.stringify({ command: "ls -la ." }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 2) {
        // Second AI call: return response based on tool results
        return {
          content:
            "Great! I have successfully executed the `ls -la` command. From the output, I can see that the current directory contains the test.txt file along with other content.",
        };
      }

      return {};
    });

    // Mock tool execution
    mockToolExecute.mockResolvedValue({
      success: true,
      content:
        "total 8\ndrwxr-xr-x 2 user user 4096 Jan 1 12:00 .\ndrwxr-xr-x 3 user user 4096 Jan 1 12:00 ..\n-rw-r--r-- 1 user user   12 Jan 1 12:00 test.txt",
      shortResult: "Listed directory contents",
    });

    // Call sendMessage to trigger tool recursion
    await agent.sendMessage("Test message");

    // Verify AI service was called twice (tool call + recursive call)
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(aiServiceCallCount).toBe(2);

    // Verify tool was executed once
    expect(mockToolExecute).toHaveBeenCalledTimes(1);
    expect(mockToolExecute).toHaveBeenCalledWith(
      "run_terminal_cmd",
      { command: "ls -la ." },
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    );

    // Verify first AI call parameters (should contain user message and newly added assistant message)
    const firstCall = mockCallAgent.mock.calls[0][0];
    expect(firstCall.messages).toHaveLength(1); // Only user message
    expect(firstCall.messages[0].role).toBe("user");

    // Verify second AI call parameters (should contain tool execution results)
    const secondCall = mockCallAgent.mock.calls[1][0];
    expect(secondCall.messages.length).toBeGreaterThan(2);

    // Should contain original user message
    const userMessage = secondCall.messages.find((msg) => msg.role === "user");
    expect(userMessage).toBeDefined();

    // Should contain assistant's tool call message
    const assistantMessage = secondCall.messages.find(
      (msg) => msg.role === "assistant",
    );
    expect(assistantMessage).toBeDefined();

    // Should contain tool execution result message
    const toolMessage = secondCall.messages.find((msg) => msg.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call_123");
    expect(toolMessage?.content).toContain("total 8"); // Verify tool execution has output
  });

  it("should handle multiple tool calls in sequence", async () => {
    // Re-initialize counter to ensure test isolation
    aiServiceCallCount = 0;

    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // First: execute first tool
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
          ],
        };
      } else if (aiServiceCallCount === 2) {
        // Second: execute second tool
        return {
          tool_calls: [
            {
              id: "call_002",
              type: "function" as const,
              index: 0,
              function: {
                name: "run_terminal_cmd",
                arguments: JSON.stringify({ command: "date" }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 3) {
        // Third: return final answer
        return {
          content:
            "I have executed all necessary commands and obtained the current path and time information.",
        };
      }

      return {};
    });

    // Mock tool execution - return different results based on tool name
    mockToolExecute.mockImplementation(
      async (toolName: string, args: Record<string, unknown>) => {
        if (args.command === "pwd") {
          return {
            success: true,
            content: "/test/workdir",
            shortResult: "Current directory: /test/workdir",
          };
        } else if (args.command === "date") {
          return {
            success: true,
            content: "Mon Jan  1 12:00:00 UTC 2024",
            shortResult: "Current date and time",
          };
        }
        return {
          success: false,
          content: "Unknown command",
          error: "Command not recognized",
        };
      },
    );

    // Call sendMessage to trigger tool recursion
    await agent.sendMessage("Test message");

    // Verify AI service was called 3 times
    expect(mockCallAgent).toHaveBeenCalledTimes(3);
    expect(aiServiceCallCount).toBe(3);

    // Verify tools were executed 2 times
    expect(mockToolExecute).toHaveBeenCalledTimes(2);

    // Verify first tool call
    expect(mockToolExecute).toHaveBeenNthCalledWith(
      1,
      "run_terminal_cmd",
      { command: "pwd" },
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    );

    // Verify second tool call
    expect(mockToolExecute).toHaveBeenNthCalledWith(
      2,
      "run_terminal_cmd",
      { command: "date" },
      expect.objectContaining({
        abortSignal: expect.any(AbortSignal),
      }),
    );

    // Verify last AI call contains all tool execution results
    const finalCall = mockCallAgent.mock.calls[2][0];
    const toolMessages = finalCall.messages.filter(
      (msg) => msg.role === "tool",
    );
    expect(toolMessages).toHaveLength(2);

    // Verify tool message content
    const pwdToolMessage = toolMessages.find(
      (msg) => msg.tool_call_id === "call_001",
    );
    expect(pwdToolMessage?.content).toBe("/test/workdir");

    const dateToolMessage = toolMessages.find(
      (msg) => msg.tool_call_id === "call_002",
    );
    expect(dateToolMessage?.content).toBe("Mon Jan  1 12:00:00 UTC 2024");
  });

  it("should handle tool execution errors gracefully", async () => {
    aiServiceCallCount = 0;

    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // First: return tool call
        return {
          tool_calls: [
            {
              id: "call_error",
              type: "function" as const,
              index: 0,
              function: {
                name: "run_terminal_cmd",
                arguments: JSON.stringify({ command: "invalid-command" }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 2) {
        // Second: return response based on error result
        return {
          content:
            "It seems the command execution failed. Let me provide other assistance for you.",
        };
      }

      return {};
    });

    // Mock tool execution failure
    mockToolExecute.mockResolvedValue({
      success: false,
      content: "Error: command not found: invalid-command",
      error: "command not found: invalid-command",
      shortResult: "Command failed",
    });

    // Call sendMessage to trigger tool recursion
    await agent.sendMessage("Test message");

    // Verify AI service was called twice (even tool failure triggers recursion)
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(aiServiceCallCount).toBe(2);

    // Verify tool was executed once
    expect(mockToolExecute).toHaveBeenCalledTimes(1);

    // Verify second AI call contains error information
    const secondCall = mockCallAgent.mock.calls[1][0];
    const toolMessage = secondCall.messages.find((msg) => msg.role === "tool");
    expect(toolMessage).toBeDefined();
    expect(toolMessage?.tool_call_id).toBe("call_error");
    expect(toolMessage?.content).toContain("Error: command not found");
  });

  it("should stop recursion when no more tool calls are returned", async () => {
    aiServiceCallCount = 0;

    const mockCallAgent = vi.mocked(aiService.callAgent);

    mockCallAgent.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // First: return tool call
        return {
          tool_calls: [
            {
              id: "call_final",
              type: "function" as const,
              index: 0,
              function: {
                name: "run_terminal_cmd",
                arguments: JSON.stringify({ command: "echo 'task completed'" }),
              },
            },
          ],
        };
      } else if (aiServiceCallCount === 2) {
        // Second: only return content, no tool calls - should stop recursion
        return {
          content: "Task completed! I executed the command and got the result.",
        };
      }

      // Should not reach here
      return {
        content: "Unexpected third call",
      };
    });

    // Mock tool execution
    mockToolExecute.mockResolvedValue({
      success: true,
      content: "task completed",
      shortResult: "Echo command executed",
    });

    // Call sendMessage to trigger tool recursion
    await agent.sendMessage("Test message");

    // Verify AI service was only called twice (recursion stops when no more tool calls)
    expect(mockCallAgent).toHaveBeenCalledTimes(2);
    expect(aiServiceCallCount).toBe(2);

    // Verify tool was only executed once
    expect(mockToolExecute).toHaveBeenCalledTimes(1);
  });
});
