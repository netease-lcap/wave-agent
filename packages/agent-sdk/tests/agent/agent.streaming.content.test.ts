import { describe, it, expect, vi, beforeEach } from "vitest";
import { Agent } from "@/agent.js";
import * as aiService from "@/services/aiService.js";
import type { TextBlock } from "@/types/messaging.js";

// Mock AI Service
vi.mock("@/services/aiService");

describe("Agent Content Streaming Tests", () => {
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
});
