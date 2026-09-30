import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from "vitest";
import { Agent } from "@/agent.js";
import type { AgentCallbacks } from "@/types/index.js";
import * as aiService from "@/services/aiService.js";
import type { TextBlock } from "@/types/messaging.js";

// Mock AI Service
vi.mock("@/services/aiService.js");

/**
 * The assistant reply under test.
 *
 * Read by role rather than by index: a session's first turn also appends the host's
 * own meta notice (the on-demand tool list), so `messages[1]` is not the reply.
 */
function assistantText(agent: Agent): string | undefined {
  const message = agent.messages.find((each) => each.role === "assistant");
  return message?.blocks.find(
    (block): block is TextBlock => block.type === "text",
  )?.content;
}

describe("Agent Content Streaming Tests", () => {
  let agent: Agent;
  let mockCallAgent: ReturnType<typeof vi.fn>;
  let mockCallbacks: {
    onAssistantMessageAdded: Mock<
      NonNullable<AgentCallbacks["onAssistantMessageAdded"]>
    >;
  };

  beforeEach(async () => {
    // Clear mock to remove any leaked calls from previous test
    mockCallAgent = vi.mocked(aiService.callAgent);
    mockCallAgent.mockClear();

    // Create mock callbacks
    mockCallbacks = {
      onAssistantMessageAdded:
        vi.fn<NonNullable<AgentCallbacks["onAssistantMessageAdded"]>>(),
    };

    // Create Agent instance with required parameters
    agent = await Agent.create({
      apiKey: "test-key",
      workdir: "/tmp/test-streaming-content",
      callbacks: mockCallbacks,
    });
  });

  afterEach(async () => {
    // Clean up Agent to stop timers, abort async operations, and release resources
    await agent.destroy();
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

      // Verify the incremental callback fired instead of a full-list callback
      expect(mockCallbacks.onAssistantMessageAdded).toHaveBeenCalled();
      const messages = agent.messages;

      expect(
        messages.filter((message) => message.isMeta !== true),
      ).toHaveLength(2); // user message + assistant message
      expect(
        messages.find((message) => message.role === "assistant")?.role,
      ).toBe("assistant");

      // Content is stored in blocks, not directly in message
      expect(assistantText(agent)).toBe(
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
      expect(assistantText(agent)).toBe("I will help you with this task.");
    });

    it("should handle empty streaming updates gracefully", async () => {
      // Test message processing with empty content handling
      mockCallAgent.mockImplementation(async () => {
        return {
          content: "Starting...",
        };
      });

      await agent.sendMessage("Start something");

      expect(mockCallAgent).toHaveBeenCalled();

      expect(assistantText(agent)).toBe("Starting...");
    });
  });
});
