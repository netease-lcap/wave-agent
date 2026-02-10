/**
 * @file Tests for onSubagentMessagesChange callback functionality
 * Tests that the callback is properly invoked when subagent messages are updated
 */

import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { Agent } from "@/agent.js";
import type { AgentCallbacks } from "@/agent.js";
import type { SubagentConfiguration } from "@/utils/subagentParser.js";

// Mock subagent configurations
const mockSubagentConfig: SubagentConfiguration = {
  name: "test-subagent",
  description: "A test subagent",
  systemPrompt: "You are a test subagent",
  tools: ["Read", "Write"],
  model: "inherit",
  filePath: "/tmp/test-subagent.md",
  scope: "project",
  priority: 1,
};

// Mock AI Service - we'll mock this to control subagent responses
vi.mock("@/services/aiService", () => ({
  callAgent: vi.fn().mockResolvedValue({
    content: "Mock subagent response",
    toolCalls: [],
    usage: { totalTokens: 10 },
  }),
}));

// Mock subagent parser
vi.mock("@/utils/subagentParser", () => ({
  loadSubagentConfigurations: vi.fn().mockResolvedValue([mockSubagentConfig]),
  findSubagentByName: vi.fn().mockResolvedValue(mockSubagentConfig),
}));

describe("Agent - onSubagentMessagesChange Callback Tests", () => {
  let agent: Agent;
  let mockOnSubagentMessagesChange: Mock<
    NonNullable<AgentCallbacks["onSubagentMessagesChange"]>
  >;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockOnSubagentMessagesChange =
      vi.fn<NonNullable<AgentCallbacks["onSubagentMessagesChange"]>>();

    // Create Agent instance with the callback
    agent = await Agent.create({
      workdir: "/tmp/test",
      callbacks: {
        onSubagentMessagesChange: mockOnSubagentMessagesChange,
      },
    });
  });

  describe("Direct SubagentManager Integration Tests", () => {
    it("should invoke onSubagentMessagesChange when subagent messages are added", async () => {
      // Access the subagentManager using type assertion (for testing purposes)
      const subagentManager = (
        agent as unknown as {
          subagentManager: (typeof agent)["subagentManager"];
        }
      ).subagentManager;
      expect(subagentManager).toBeDefined();

      // Create a subagent instance
      const subagentInstance = await subagentManager.createInstance(
        mockSubagentConfig,
        {
          description: "Test subagent creation",
          prompt: "Test prompt",
          subagent_type: "test-subagent",
        },
      );

      // Clear any calls from initialization
      vi.clearAllMocks();

      // Add a user message to the subagent to trigger the callback
      subagentInstance.messageManager.addUserMessage({
        content: "Test user message in subagent",
      });

      // Verify the callback was called
      expect(mockOnSubagentMessagesChange).toHaveBeenCalledWith(
        subagentInstance.subagentId,
        expect.any(Array),
      );
    });

    it("should provide correct message array when callback is invoked", async () => {
      const subagentManager = (
        agent as unknown as {
          subagentManager: (typeof agent)["subagentManager"];
        }
      ).subagentManager;
      const subagentInstance = await subagentManager.createInstance(
        mockSubagentConfig,
        {
          description: "Test message structure",
          prompt: "Test prompt",
          subagent_type: "test-subagent",
        },
      );

      vi.clearAllMocks();

      // Add multiple messages
      subagentInstance.messageManager.addUserMessage({
        content: "First message",
      });
      subagentInstance.messageManager.addAssistantMessage("Assistant response");

      // Should have been called twice (once for each message)
      expect(mockOnSubagentMessagesChange).toHaveBeenCalledTimes(2);

      // Verify the callback was called with the subagent ID and messages array
      const calls = vi.mocked(mockOnSubagentMessagesChange).mock.calls;
      expect(calls[0]![0]).toBe(subagentInstance.subagentId);
      expect(Array.isArray(calls[0]![1])).toBe(true);
      expect(calls[1]![0]).toBe(subagentInstance.subagentId);
      expect(Array.isArray(calls[1]![1])).toBe(true);
    });

    it("should work with multiple subagents independently", async () => {
      const subagentManager = (
        agent as unknown as {
          subagentManager: (typeof agent)["subagentManager"];
        }
      ).subagentManager;

      // Create two different subagent instances
      const subagent1 = await subagentManager.createInstance(
        mockSubagentConfig,
        {
          description: "First subagent",
          prompt: "First prompt",
          subagent_type: "test-subagent",
        },
      );

      const subagent2 = await subagentManager.createInstance(
        mockSubagentConfig,
        {
          description: "Second subagent",
          prompt: "Second prompt",
          subagent_type: "test-subagent",
        },
      );

      vi.clearAllMocks();

      // Add messages to both subagents
      subagent1.messageManager.addUserMessage({
        content: "Message to subagent 1",
      });
      subagent2.messageManager.addUserMessage({
        content: "Message to subagent 2",
      });

      // Should have been called twice with different subagent IDs
      expect(mockOnSubagentMessagesChange).toHaveBeenCalledTimes(2);

      const calls = vi.mocked(mockOnSubagentMessagesChange).mock.calls;
      expect(calls[0]![0]).toBe(subagent1.subagentId);
      expect(calls[1]![0]).toBe(subagent2.subagentId);
    });

    it("should handle content streaming updates", async () => {
      const subagentManager = (
        agent as unknown as {
          subagentManager: (typeof agent)["subagentManager"];
        }
      ).subagentManager;
      const subagentInstance = await subagentManager.createInstance(
        mockSubagentConfig,
        {
          description: "Test streaming",
          prompt: "Test prompt",
          subagent_type: "test-subagent",
        },
      );

      // Add initial message
      subagentInstance.messageManager.addAssistantMessage("Initial");
      vi.clearAllMocks();

      // Update content to simulate streaming
      subagentInstance.messageManager.updateCurrentMessageContent(
        "Initial content",
      );
      subagentInstance.messageManager.updateCurrentMessageContent(
        "Initial content updated",
      );

      // Should have been called for each content update
      expect(mockOnSubagentMessagesChange).toHaveBeenCalledTimes(2);
    });

    it("should handle tool block updates", async () => {
      const subagentManager = (
        agent as unknown as {
          subagentManager: (typeof agent)["subagentManager"];
        }
      ).subagentManager;
      const subagentInstance = await subagentManager.createInstance(
        mockSubagentConfig,
        {
          description: "Test tool blocks",
          prompt: "Test prompt",
          subagent_type: "test-subagent",
        },
      );

      // Add a message with tool calls
      subagentInstance.messageManager.addAssistantMessage("I'll read a file", [
        {
          id: "tool-1",
          type: "function",
          function: {
            name: "Read",
            arguments: '{"file_path": "/test/file.txt"}',
          },
        },
      ]);

      vi.clearAllMocks();

      // Update the tool block
      subagentInstance.messageManager.updateToolBlock({
        id: "tool-1",
        stage: "end",
        parameters: '{"file_path": "/test/file.txt"}',
        result: "File content",
      });

      // Should trigger the callback
      expect(mockOnSubagentMessagesChange).toHaveBeenCalledWith(
        subagentInstance.subagentId,
        expect.any(Array),
      );
    });

    it("should not fail when callback is not provided", async () => {
      // Create agent without the callback
      const agentWithoutCallback = await Agent.create({
        workdir: "/tmp/test",
        callbacks: {
          // No onSubagentMessagesChange callback
        },
      });

      const subagentManager = (
        agentWithoutCallback as unknown as {
          subagentManager: (typeof agent)["subagentManager"];
        }
      ).subagentManager;

      // Should not throw when creating subagent and adding messages
      await expect(async () => {
        const subagentInstance = await subagentManager.createInstance(
          mockSubagentConfig,
          {
            description: "Test without callback",
            prompt: "Test prompt",
            subagent_type: "test-subagent",
          },
        );

        subagentInstance.messageManager.addUserMessage({
          content: "Test message without callback",
        });
      }).not.toThrow();
    });

    it("should handle errors in callback gracefully", async () => {
      const errorCallback = vi.fn().mockImplementation(() => {
        throw new Error("Callback error");
      });

      const agentWithErrorCallback = await Agent.create({
        workdir: "/tmp/test",
        callbacks: {
          onSubagentMessagesChange: errorCallback,
        },
      });

      const subagentManager = (
        agentWithErrorCallback as unknown as {
          subagentManager: (typeof agent)["subagentManager"];
        }
      ).subagentManager;
      const subagentInstance = await subagentManager.createInstance(
        mockSubagentConfig,
        {
          description: "Test error handling",
          prompt: "Test prompt",
          subagent_type: "test-subagent",
        },
      );

      vi.clearAllMocks();

      // Adding a message should trigger the callback error
      expect(() => {
        subagentInstance.messageManager.addUserMessage({
          content: "This will trigger callback error",
        });
      }).toThrow("Callback error");

      // Verify the callback was called despite the error
      expect(errorCallback).toHaveBeenCalledWith(
        subagentInstance.subagentId,
        expect.any(Array),
      );
    });
  });
});
