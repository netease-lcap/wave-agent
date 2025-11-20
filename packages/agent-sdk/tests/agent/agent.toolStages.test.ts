import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@/agent.js";
import OpenAI from "openai";

// Mock OpenAI instead of aiService
vi.mock("openai");

// Mock tool registry to control tool execution
let mockToolExecute: ReturnType<typeof vi.fn>;
vi.mock("@/managers/toolManager", () => ({
  ToolManager: vi.fn().mockImplementation(() => ({
    execute: (mockToolExecute = vi.fn()),
    list: vi.fn(() => []),
    getToolsConfig: vi.fn(() => []),
  })),
}));

describe("Agent Tool Stage Tests", () => {
  let agent: Agent;
  let onToolBlockUpdated: ReturnType<typeof vi.fn>;
  let mockOpenAI: ReturnType<typeof vi.mocked<typeof OpenAI>>;
  let mockCreate: ReturnType<typeof vi.fn>;
  let aiServiceCallCount: number;

  // Common usage objects to avoid duplication
  const FIRST_CALL_USAGE = {
    prompt_tokens: 10,
    completion_tokens: 5,
    total_tokens: 15,
  };

  const SECOND_CALL_USAGE = {
    prompt_tokens: 15,
    completion_tokens: 10,
    total_tokens: 25,
  };

  // Helper function to create streaming response
  const createStreamingResponse = (
    chunks: Array<{
      toolCall?: { id: string; name: string; arguments: string };
      finish?: boolean;
    }>,
  ) => {
    return {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          if (chunk.toolCall) {
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: chunk.toolCall.id,
                        function: {
                          name: chunk.toolCall.name,
                          arguments: chunk.toolCall.arguments,
                        },
                      },
                    ],
                  },
                },
              ],
            };
          }
          if (chunk.finish) {
            yield {
              choices: [{ finish_reason: "tool_calls" }],
              usage: FIRST_CALL_USAGE,
            };
          }
        }
      },
    };
  };

  // Helper function to create second response
  const createSecondResponse = (content: string) => ({
    choices: [
      {
        message: { content },
      },
    ],
    usage: SECOND_CALL_USAGE,
  });

  beforeEach(async () => {
    // Create mock callbacks
    onToolBlockUpdated = vi.fn();

    const mockCallbacks = {
      onMessagesChange: vi.fn(),
      onLoadingChange: vi.fn(),
      onToolBlockUpdated,
    };

    // Setup OpenAI mock
    mockCreate = vi.fn();
    mockOpenAI = vi.mocked(OpenAI);
    mockOpenAI.mockImplementation(
      () =>
        ({
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        }) as unknown as OpenAI,
    );

    // Create Agent instance with required parameters
    agent = await Agent.create({
      callbacks: mockCallbacks,
    });

    // Reset counters
    aiServiceCallCount = 0;

    vi.clearAllMocks();
  });

  it("should handle tool stage emissions during execution", async () => {
    // Mock OpenAI streaming response
    mockCreate.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        return createStreamingResponse([
          {
            toolCall: {
              id: "call_123",
              name: "test_tool",
              arguments: JSON.stringify({ param: "value" }),
            },
          },
          { finish: true },
        ]);
      }

      return createSecondResponse("Tool execution completed successfully");
    });

    // Mock tool execution to simulate success
    mockToolExecute.mockResolvedValue({
      success: true,
      result: "Tool executed successfully",
    });

    // Send a message to trigger tool execution
    await agent.sendMessage("Test message");

    // Verify that onToolBlockUpdated was called with start stage (empty parameters)
    expect(onToolBlockUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "start",
        name: "test_tool",
        id: "call_123",
        parameters: "", // Start stage should have empty parameters
        parametersChunk: "", // Start stage should have empty parametersChunk
      }),
    );

    // Verify that onToolBlockUpdated was called with streaming stage (actual content)
    expect(onToolBlockUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "streaming",
        name: "test_tool",
        id: "call_123",
        parameters: JSON.stringify({ param: "value" }),
        parametersChunk: JSON.stringify({ param: "value" }), // Should match the chunk content
      }),
    );

    // Verify that isRunning field is not present
    const startCall = onToolBlockUpdated.mock.calls.find(
      (call: unknown[]) =>
        call[0] &&
        typeof call[0] === "object" &&
        "stage" in call[0] &&
        call[0].stage === "start",
    ) as [Record<string, unknown>] | undefined;
    expect(startCall).toBeDefined();
    expect(startCall![0]).not.toHaveProperty("isRunning");
  });

  it("should include proper tool metadata in start stage event during streaming", async () => {
    // Mock OpenAI streaming response
    mockCreate.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        return createStreamingResponse([
          {
            toolCall: {
              id: "call_456",
              name: "calculator_tool",
              arguments: JSON.stringify({ a: 5, b: 3 }),
            },
          },
          { finish: true },
        ]);
      }

      return createSecondResponse("Calculation completed");
    });

    // Mock tool execution to simulate success
    mockToolExecute.mockResolvedValue({
      success: true,
      result: "8",
    });

    // Send a message to trigger tool execution
    await agent.sendMessage("Calculate 5 + 3");

    // Verify that start event includes proper metadata
    expect(onToolBlockUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "start",
        name: "calculator_tool",
        id: "call_456",
        parameters: "", // Start stage should have empty parameters
        parametersChunk: "", // Start stage should have empty parametersChunk
      }),
    );
  });

  it("should emit running stage before tool execution and end stage after completion", async () => {
    // Mock OpenAI streaming response
    mockCreate.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        return createStreamingResponse([
          {
            toolCall: {
              id: "call_running",
              name: "long_tool",
              arguments: JSON.stringify({ duration: 1000 }),
            },
          },
          { finish: true },
        ]);
      }

      return createSecondResponse("Long running tool completed");
    });

    // Mock tool execution with a delay to simulate long-running operation
    mockToolExecute.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return {
        success: true,
        content: "Long operation completed",
      };
    });

    // Send a message to trigger tool execution
    await agent.sendMessage("Execute long running task");

    // Verify that onToolBlockUpdated was called in the correct order: start → running → end
    const allCalls = onToolBlockUpdated.mock.calls;

    // Find calls for our specific tool
    const toolCalls = allCalls
      .filter(
        (call: unknown[]) =>
          (call[0] as Record<string, unknown>)?.id === "call_running",
      )
      .map((call: unknown[]) => call[0] as Record<string, unknown>);

    // Should have at least 3 calls: start (from aiService), running (from aiManager), end (from aiManager)
    expect(toolCalls.length).toBeGreaterThanOrEqual(3);

    // First call should be start stage (from aiService streaming)
    expect(toolCalls[0]).toMatchObject({
      stage: "start",
      name: "long_tool",
      id: "call_running",
      parameters: "",
      parametersChunk: "",
    });

    // Find the running stage call (should be after start but before end)
    const runningCall = toolCalls.find((call) => call.stage === "running");
    expect(runningCall).toBeDefined();
    expect(runningCall).toMatchObject({
      stage: "running",
      name: "long_tool",
      id: "call_running",
    });

    // Last call should be end stage
    const endCall = toolCalls[toolCalls.length - 1];
    expect(endCall).toMatchObject({
      stage: "end",
      name: "long_tool",
      id: "call_running",
      success: true,
    });
    expect(endCall.result).toContain("Long operation completed");
  });

  it("should emit start stage before any other stages", async () => {
    // Mock OpenAI response
    mockCreate.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        return createStreamingResponse([
          {
            toolCall: {
              id: "call_789",
              name: "slow_tool",
              arguments: JSON.stringify({ delay: 100 }),
            },
          },
          { finish: true },
        ]);
      }

      return createSecondResponse("Slow tool completed");
    });

    // Mock tool execution with a delay to test ordering
    mockToolExecute.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return {
        success: true,
        result: "Delayed result",
      };
    });

    // Send a message to trigger tool execution
    await agent.sendMessage("Test delayed tool");

    // Get all tool block update calls
    const toolBlockCalls = onToolBlockUpdated.mock.calls
      .map((call: unknown[]) =>
        call[0] && typeof call[0] === "object"
          ? (call[0] as Record<string, unknown>)
          : null,
      )
      .filter((call): call is Record<string, unknown> => call !== null);

    // Find the start call
    const startCall = toolBlockCalls.find((call) => call.stage === "start");
    const endCall = toolBlockCalls.find((call) => call.stage === "end");

    // Verify start call exists and comes before end call
    expect(startCall).toBeDefined();
    expect(endCall).toBeDefined();

    // Verify start call index is before end call index
    const startIndex = toolBlockCalls.indexOf(startCall!);
    const endIndex = toolBlockCalls.indexOf(endCall!);
    expect(startIndex).toBeLessThan(endIndex);
  });

  it("should handle multiple streaming chunks with proper stage emission", async () => {
    // Mock OpenAI streaming response with multiple chunks
    mockCreate.mockImplementation(async () => {
      aiServiceCallCount++;

      if (aiServiceCallCount === 1) {
        // Create custom streaming response for multiple chunks (can't use helper for this complex case)
        return {
          async *[Symbol.asyncIterator]() {
            // First chunk: partial arguments
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "call_multi",
                        function: {
                          name: "complex_tool",
                          arguments: '{"param1":',
                        },
                      },
                    ],
                  },
                },
              ],
            };

            // Second chunk: continuing arguments
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: '"value1","param2"',
                        },
                      },
                    ],
                  },
                },
              ],
            };

            // Third chunk: completing arguments
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        function: {
                          arguments: ':"value2"}',
                        },
                      },
                    ],
                  },
                },
              ],
            };

            // End of stream
            yield {
              choices: [{ finish_reason: "tool_calls" }],
              usage: FIRST_CALL_USAGE,
            };
          },
        };
      }

      return createSecondResponse("Complex tool completed successfully");
    });

    // Mock tool execution to simulate success
    mockToolExecute.mockResolvedValue({
      success: true,
      result: "Complex tool executed with multiple parameters",
    });

    // Send a message to trigger tool execution
    await agent.sendMessage("Test complex tool with multiple chunks");

    // Verify that start stage was emitted first with empty parameters
    expect(onToolBlockUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "start",
        name: "complex_tool",
        id: "call_multi",
        parameters: "", // Start stage should have empty parameters
        parametersChunk: "", // Start stage should have empty parametersChunk
      }),
    );

    // Verify that streaming stages were emitted with incremental content
    const streamingCalls = onToolBlockUpdated.mock.calls.filter(
      (call: unknown[]) =>
        call[0] &&
        typeof call[0] === "object" &&
        "stage" in call[0] &&
        call[0].stage === "streaming",
    ) as [Record<string, unknown>][];

    expect(streamingCalls.length).toBeGreaterThan(0);

    // Verify progressive parameter building through streaming
    const firstStreamingCall = streamingCalls[0][0];
    expect(firstStreamingCall).toMatchObject({
      stage: "streaming",
      name: "complex_tool",
      id: "call_multi",
      parameters: expect.stringContaining('{"param1":'),
      parametersChunk: '{"param1":', // First chunk should be just the partial JSON
    });

    // Final streaming call should have complete parameters
    const lastStreamingCall = streamingCalls[streamingCalls.length - 1][0];
    expect(lastStreamingCall).toMatchObject({
      stage: "streaming",
      name: "complex_tool",
      id: "call_multi",
      parameters: '{"param1":"value1","param2":"value2"}',
      parametersChunk: ':"value2"}', // Last chunk should complete the JSON
    });
  });
});
