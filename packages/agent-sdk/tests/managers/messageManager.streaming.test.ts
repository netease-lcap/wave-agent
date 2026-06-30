import { describe, it, expect, vi } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import type { MessageManagerCallbacks } from "../../src/managers/messageManager.js";
import { Container } from "../../src/utils/container.js";

describe("MessageManager - Streaming Functionality", () => {
  const container = new Container();

  describe("updateCurrentMessageContent with FR-001 compliance", () => {
    it("should call onAssistantContentUpdated with chunk and accumulated content", () => {
      const mockOnAssistantContentUpdated = vi.fn();
      const mockOnMessagesChange = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockOnAssistantContentUpdated,
        onMessagesChange: mockOnMessagesChange,
      };

      const messageManager = new MessageManager(container, {
        callbacks,
        workdir: "/test",
      });

      // Add an assistant message first
      messageManager.addAssistantMessage();
      const messageId = messageManager.getMessages().slice(-1)[0].id;

      // First update
      messageManager.updateCurrentMessageContent("Hello");

      expect(mockOnAssistantContentUpdated).toHaveBeenCalledWith({
        messageId,
        chunk: "Hello",
        accumulated: "Hello",
        stage: "streaming",
      });

      // Second update (should calculate chunk correctly)
      messageManager.updateCurrentMessageContent("Hello, world!");

      expect(mockOnAssistantContentUpdated).toHaveBeenCalledWith({
        messageId,
        chunk: ", world!",
        accumulated: "Hello, world!",
        stage: "streaming",
      });

      // Third update (adding more content)
      messageManager.updateCurrentMessageContent("Hello, world! How are you?");

      expect(mockOnAssistantContentUpdated).toHaveBeenCalledWith({
        messageId,
        chunk: " How are you?",
        accumulated: "Hello, world! How are you?",
        stage: "streaming",
      });

      // Verify total calls
      expect(mockOnAssistantContentUpdated).toHaveBeenCalledTimes(3);
      expect(mockOnMessagesChange).toHaveBeenCalledTimes(4); // 1 for addAssistantMessage + 3 for updates
    });

    it("should handle empty content correctly", () => {
      const mockOnAssistantContentUpdated = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockOnAssistantContentUpdated,
      };

      const messageManager = new MessageManager(container, {
        callbacks,
        workdir: "/test",
      });

      // Add an assistant message first
      messageManager.addAssistantMessage();
      const messageId = messageManager.getMessages().slice(-1)[0].id;

      // Update with empty content
      messageManager.updateCurrentMessageContent("");

      expect(mockOnAssistantContentUpdated).toHaveBeenCalledWith({
        messageId,
        chunk: "",
        accumulated: "",
        stage: "streaming",
      });
    });

    it("should create new text block when none exists", () => {
      const mockOnAssistantContentUpdated = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockOnAssistantContentUpdated,
      };

      const messageManager = new MessageManager(container, {
        callbacks,
        workdir: "/test",
      });

      // Add an assistant message first
      messageManager.addAssistantMessage();
      const messageId = messageManager.getMessages().slice(-1)[0].id;

      // Update content (should create new text block)
      messageManager.updateCurrentMessageContent("New content");

      expect(mockOnAssistantContentUpdated).toHaveBeenCalledWith({
        messageId,
        chunk: "New content",
        accumulated: "New content",
        stage: "streaming",
      });

      // Verify the message has the content
      const messages = messageManager.getMessages();
      const lastMessage = messages[messages.length - 1];
      expect(lastMessage.role).toBe("assistant");
      expect(lastMessage.blocks[0]).toEqual({
        type: "text",
        content: "New content",
        stage: "streaming",
      });
    });

    it("should do nothing if no messages exist", () => {
      const mockOnAssistantContentUpdated = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockOnAssistantContentUpdated,
      };

      const messageManager = new MessageManager(container, {
        callbacks,
        workdir: "/test",
      });

      // Try to update content without any messages
      messageManager.updateCurrentMessageContent("Should not work");

      expect(mockOnAssistantContentUpdated).not.toHaveBeenCalled();
    });

    it("should do nothing if last message is not assistant", () => {
      const mockOnAssistantContentUpdated = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockOnAssistantContentUpdated,
      };

      const messageManager = new MessageManager(container, {
        callbacks,
        workdir: "/test",
      });

      // Add a user message
      messageManager.addUserMessage({ content: "User message" });

      // Try to update content (should not work since last message is user)
      messageManager.updateCurrentMessageContent("Should not work");

      expect(mockOnAssistantContentUpdated).not.toHaveBeenCalled();
    });
  });

  describe("stage='end' callback on block finalization", () => {
    it("updateCurrentMessageContent fires onAssistantReasoningUpdated with stage='end' when finalizing streaming reasoning", () => {
      const mockContentUpdated = vi.fn();
      const mockReasoningUpdated = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockContentUpdated,
        onAssistantReasoningUpdated: mockReasoningUpdated,
      };

      const messageManager = new MessageManager(container, {
        callbacks,
        workdir: "/test",
      });

      messageManager.addAssistantMessage();
      const messageId = messageManager.getMessages().slice(-1)[0].id;

      // First, create a streaming reasoning block
      messageManager.updateCurrentMessageReasoning("Let me think...");

      // Now update content — should finalize the reasoning block
      messageManager.updateCurrentMessageContent("Hello");

      // Reasoning should have been finalized with stage="end"
      const reasoningCalls = mockReasoningUpdated.mock.calls;
      const finalizeCall = reasoningCalls[reasoningCalls.length - 1];
      expect(finalizeCall).toEqual([
        {
          messageId,
          chunk: "",
          accumulated: "Let me think...",
          stage: "end",
        },
      ]);

      // Content should fire with stage="streaming"
      expect(mockContentUpdated).toHaveBeenCalledWith({
        messageId,
        chunk: "Hello",
        accumulated: "Hello",
        stage: "streaming",
      });
    });

    it("updateCurrentMessageReasoning fires onAssistantContentUpdated with stage='end' when finalizing streaming text", () => {
      const mockContentUpdated = vi.fn();
      const mockReasoningUpdated = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockContentUpdated,
        onAssistantReasoningUpdated: mockReasoningUpdated,
      };

      const messageManager = new MessageManager(container, {
        callbacks,
        workdir: "/test",
      });

      messageManager.addAssistantMessage();
      const messageId = messageManager.getMessages().slice(-1)[0].id;

      // First, create a streaming text block
      messageManager.updateCurrentMessageContent("Hello world");

      // Now update reasoning — should finalize the text block
      messageManager.updateCurrentMessageReasoning("Thinking...");

      // Content should have been finalized with stage="end"
      const contentCalls = mockContentUpdated.mock.calls;
      const finalizeCall = contentCalls[contentCalls.length - 1];
      expect(finalizeCall).toEqual([
        {
          messageId,
          chunk: "",
          accumulated: "Hello world",
          stage: "end",
        },
      ]);

      // Reasoning should fire with stage="streaming"
      expect(mockReasoningUpdated).toHaveBeenCalledWith({
        messageId,
        chunk: "Thinking...",
        accumulated: "Thinking...",
        stage: "streaming",
      });
    });

    it("finalizeStreamingBlocks fires callback with stage='end' for remaining streaming block", () => {
      const mockContentUpdated = vi.fn();
      const mockReasoningUpdated = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockContentUpdated,
        onAssistantReasoningUpdated: mockReasoningUpdated,
      };

      const messageManager = new MessageManager(container, {
        callbacks,
        workdir: "/test",
      });

      messageManager.addAssistantMessage();
      const messageId = messageManager.getMessages().slice(-1)[0].id;

      // Create streaming text block, then reasoning (which finalizes text)
      messageManager.updateCurrentMessageContent("Some text");
      messageManager.updateCurrentMessageReasoning("Some reasoning");

      mockContentUpdated.mockClear();
      mockReasoningUpdated.mockClear();

      // Finalize remaining streaming blocks (only reasoning is still streaming)
      messageManager.finalizeStreamingBlocks();

      // Text was already finalized by updateCurrentMessageReasoning, so no callback
      expect(mockContentUpdated).not.toHaveBeenCalled();
      // Reasoning is finalized by finalizeStreamingBlocks
      expect(mockReasoningUpdated).toHaveBeenCalledWith({
        messageId,
        chunk: "",
        accumulated: "Some reasoning",
        stage: "end",
      });
    });

    it("normal streaming fires callbacks with stage='streaming'", () => {
      const mockContentUpdated = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockContentUpdated,
      };

      const messageManager = new MessageManager(container, {
        callbacks,
        workdir: "/test",
      });

      messageManager.addAssistantMessage();
      const messageId = messageManager.getMessages().slice(-1)[0].id;

      messageManager.updateCurrentMessageContent("Hello");

      expect(mockContentUpdated).toHaveBeenCalledWith({
        messageId,
        chunk: "Hello",
        accumulated: "Hello",
        stage: "streaming",
      });
    });
  });
});
