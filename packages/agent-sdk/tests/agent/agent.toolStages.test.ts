import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { Agent } from "@/agent.js";
import type { AgentCallbacks } from "@/agent.js";
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

describe("Agent Tool Stage Tests", () => {
  let agent: Agent;
  let onToolBlockUpdated: Mock<
    NonNullable<AgentCallbacks["onToolBlockUpdated"]>
  >;
  let mockCallAgent: ReturnType<typeof vi.fn>;

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

  beforeEach(async () => {
    // Create mock callbacks
    onToolBlockUpdated =
      vi.fn<NonNullable<AgentCallbacks["onToolBlockUpdated"]>>();

    const mockCallbacks = {
      onMessagesChange:
        vi.fn<NonNullable<AgentCallbacks["onMessagesChange"]>>(),
      onToolBlockUpdated,
    };

    // Create Agent instance with required parameters
    agent = await Agent.create({
      callbacks: mockCallbacks,
    });

    // Setup aiService mock
    mockCallAgent = vi.mocked(aiService.callAgent);

    vi.clearAllMocks();
  });

  it("should handle tool stage emissions during execution", async () => {
    // Mock aiService to return tool calls and simulate streaming stages
    let callCount = 0;
    mockCallAgent.mockImplementation(async ({ onToolUpdate }) => {
      callCount++;

      if (callCount === 1) {
        // Simulate streaming tool call with stage emissions
        if (onToolUpdate) {
          // Emit start stage
          onToolUpdate({
            id: "call_123",
            name: "test_tool",
            parameters: "",
            parametersChunk: "",
            stage: "start",
          });

          // Emit streaming stage with parameters
          onToolUpdate({
            id: "call_123",
            name: "test_tool",
            parameters: JSON.stringify({ param: "value" }),
            parametersChunk: JSON.stringify({ param: "value" }),
            stage: "streaming",
          });
        }

        return {
          content: "",
          tool_calls: [
            {
              id: "call_123",
              type: "function" as const,
              function: {
                name: "test_tool",
                arguments: JSON.stringify({ param: "value" }),
              },
            },
          ],
          usage: FIRST_CALL_USAGE,
        };
      }

      return {
        content: "Tool execution completed successfully",
        tool_calls: [],
        usage: SECOND_CALL_USAGE,
      };
    });

    // Mock tool execution to simulate success
    mockToolExecute.mockResolvedValue({
      success: true,
      content: "Tool executed successfully",
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
    // Mock aiService to return tool calls and simulate streaming stages
    let callCount = 0;
    mockCallAgent.mockImplementation(async ({ onToolUpdate }) => {
      callCount++;

      if (callCount === 1) {
        // Simulate streaming tool call with stage emissions
        if (onToolUpdate) {
          // Emit start stage
          onToolUpdate({
            id: "call_456",
            name: "calculator_tool",
            parameters: "",
            parametersChunk: "",
            stage: "start",
          });

          // Emit streaming stage with parameters
          onToolUpdate({
            id: "call_456",
            name: "calculator_tool",
            parameters: JSON.stringify({ a: 5, b: 3 }),
            parametersChunk: JSON.stringify({ a: 5, b: 3 }),
            stage: "streaming",
          });
        }

        return {
          content: "",
          tool_calls: [
            {
              id: "call_456",
              type: "function" as const,
              function: {
                name: "calculator_tool",
                arguments: JSON.stringify({ a: 5, b: 3 }),
              },
            },
          ],
          usage: FIRST_CALL_USAGE,
        };
      }

      return {
        content: "Calculation completed",
        tool_calls: [],
        usage: SECOND_CALL_USAGE,
      };
    });

    // Mock tool execution to simulate success
    mockToolExecute.mockResolvedValue({
      success: true,
      content: "8",
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
    // Mock aiService to return tool calls without streaming
    let callCount = 0;
    mockCallAgent.mockImplementation(async () => {
      callCount++;

      if (callCount === 1) {
        return {
          content: "",
          tool_calls: [
            {
              id: "call_789",
              type: "function" as const,
              function: {
                name: "file_tool",
                arguments: JSON.stringify({ path: "test.txt" }),
              },
            },
          ],
          usage: FIRST_CALL_USAGE,
        };
      }

      return {
        content: "File operation completed",
        tool_calls: [],
        usage: SECOND_CALL_USAGE,
      };
    });

    // Mock tool execution to simulate success
    mockToolExecute.mockResolvedValue({
      success: true,
      content: "File processed successfully",
    });

    // Send a message to trigger tool execution
    await agent.sendMessage("Process file");

    // Get all calls to onToolBlockUpdated
    const toolCalls = onToolBlockUpdated.mock.calls.map((call) => call[0]);

    // Should have at least 3 calls: running (from aiManager), end (from aiManager)
    expect(toolCalls.length).toBeGreaterThanOrEqual(2);

    // Find running and end stage calls
    const runningCall = toolCalls.find((call) => call.stage === "running");
    const endCall = toolCalls.find((call) => call.stage === "end");

    // Verify running and end calls exist
    expect(runningCall).toBeDefined();
    expect(endCall).toBeDefined();

    // Verify running stage comes before end stage
    const runningIndex = toolCalls.findIndex(
      (call) => call.stage === "running",
    );
    const endIndex = toolCalls.findIndex((call) => call.stage === "end");
    expect(runningIndex).toBeLessThan(endIndex);
  });

  it("should emit start stage before any other stages", async () => {
    // Mock aiService to return tool calls with streaming
    let callCount = 0;
    mockCallAgent.mockImplementation(async ({ onToolUpdate }) => {
      callCount++;

      if (callCount === 1) {
        // Simulate streaming tool call with stage emissions
        if (onToolUpdate) {
          // Emit start stage first
          onToolUpdate({
            id: "call_order",
            name: "order_tool",
            parameters: "",
            parametersChunk: "",
            stage: "start",
          });

          // Emit streaming stage after
          onToolUpdate({
            id: "call_order",
            name: "order_tool",
            parameters: JSON.stringify({ data: "test" }),
            parametersChunk: JSON.stringify({ data: "test" }),
            stage: "streaming",
          });
        }

        return {
          content: "",
          tool_calls: [
            {
              id: "call_order",
              type: "function" as const,
              function: {
                name: "order_tool",
                arguments: JSON.stringify({ data: "test" }),
              },
            },
          ],
          usage: FIRST_CALL_USAGE,
        };
      }

      return {
        content: "Order processed",
        tool_calls: [],
        usage: SECOND_CALL_USAGE,
      };
    });

    // Mock tool execution to simulate success
    mockToolExecute.mockResolvedValue({
      success: true,
      content: "Order completed",
    });

    // Send a message to trigger tool execution
    await agent.sendMessage("Process order");

    // Get all calls to onToolBlockUpdated
    const toolCalls = onToolBlockUpdated.mock.calls.map((call) => call[0]);

    // Find start and end stage calls
    const startCall = toolCalls.find((call) => call.stage === "start");
    const endCall = toolCalls.find((call) => call.stage === "end");

    // Verify start call exists and comes before end call
    expect(startCall).toBeDefined();
    expect(endCall).toBeDefined();

    // Verify start stage comes first
    const startIndex = toolCalls.findIndex((call) => call.stage === "start");
    const endIndex = toolCalls.findIndex((call) => call.stage === "end");
    expect(startIndex).toBeLessThan(endIndex);
  });

  it("should handle multiple streaming chunks with proper stage emission", async () => {
    // Mock aiService to return tool calls with multiple streaming chunks
    let callCount = 0;
    mockCallAgent.mockImplementation(async ({ onToolUpdate }) => {
      callCount++;

      if (callCount === 1) {
        // Simulate streaming tool call with multiple chunks
        if (onToolUpdate) {
          // Emit start stage first
          onToolUpdate({
            id: "call_multi",
            name: "multi_tool",
            parameters: "",
            parametersChunk: "",
            stage: "start",
          });

          // Emit first streaming chunk
          onToolUpdate({
            id: "call_multi",
            name: "multi_tool",
            parameters: '{"step":',
            parametersChunk: '{"step":',
            stage: "streaming",
          });

          // Emit second streaming chunk
          onToolUpdate({
            id: "call_multi",
            name: "multi_tool",
            parameters: '{"step": 1}',
            parametersChunk: " 1}",
            stage: "streaming",
          });
        }

        return {
          content: "",
          tool_calls: [
            {
              id: "call_multi",
              type: "function" as const,
              function: {
                name: "multi_tool",
                arguments: JSON.stringify({ step: 1 }),
              },
            },
          ],
          usage: FIRST_CALL_USAGE,
        };
      }

      return {
        content: "Multi-step completed",
        tool_calls: [],
        usage: SECOND_CALL_USAGE,
      };
    });

    // Mock tool execution to simulate success
    mockToolExecute.mockResolvedValue({
      success: true,
      content: "Step completed",
    });

    // Send a message to trigger tool execution
    await agent.sendMessage("Execute multi-step");

    // Verify that start stage was emitted first with empty parameters
    expect(onToolBlockUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "start",
        name: "multi_tool",
        id: "call_multi",
        parameters: "",
        parametersChunk: "",
      }),
    );

    // Verify that streaming stages were emitted with incremental content
    expect(onToolBlockUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "streaming",
        name: "multi_tool",
        id: "call_multi",
        parameters: '{"step":',
        parametersChunk: '{"step":',
      }),
    );

    expect(onToolBlockUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "streaming",
        name: "multi_tool",
        id: "call_multi",
        parameters: '{"step": 1}',
        parametersChunk: " 1}",
      }),
    );
  });
});
