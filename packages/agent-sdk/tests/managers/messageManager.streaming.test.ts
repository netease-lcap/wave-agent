import { describe, it, expect, vi } from "vitest";
import { MessageManager } from "../../src/managers/messageManager.js";
import type { MessageManagerCallbacks } from "../../src/managers/messageManager.js";

describe("MessageManager - Streaming Functionality", () => {
  describe("updateCurrentMessageContent with FR-001 compliance", () => {
    it("should call onAssistantContentUpdated with chunk and accumulated content", () => {
      const mockOnAssistantContentUpdated = vi.fn();
      const mockOnMessagesChange = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockOnAssistantContentUpdated,
        onMessagesChange: mockOnMessagesChange,
      };

      const messageManager = new MessageManager({
        callbacks,
        workdir: "/test",
      });

      // Add an assistant message first
      messageManager.addAssistantMessage();

      // First update
      messageManager.updateCurrentMessageContent("Hello");

      expect(mockOnAssistantContentUpdated).toHaveBeenCalledWith(
        "Hello",
        "Hello",
      );

      // Second update (should calculate chunk correctly)
      messageManager.updateCurrentMessageContent("Hello, world!");

      expect(mockOnAssistantContentUpdated).toHaveBeenCalledWith(
        ", world!",
        "Hello, world!",
      );

      // Third update (adding more content)
      messageManager.updateCurrentMessageContent("Hello, world! How are you?");

      expect(mockOnAssistantContentUpdated).toHaveBeenCalledWith(
        " How are you?",
        "Hello, world! How are you?",
      );

      // Verify total calls
      expect(mockOnAssistantContentUpdated).toHaveBeenCalledTimes(3);
      expect(mockOnMessagesChange).toHaveBeenCalledTimes(4); // 1 for addAssistantMessage + 3 for updates
    });

    it("should handle empty content correctly", () => {
      const mockOnAssistantContentUpdated = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockOnAssistantContentUpdated,
      };

      const messageManager = new MessageManager({
        callbacks,
        workdir: "/test",
      });

      // Add an assistant message first
      messageManager.addAssistantMessage();

      // Update with empty content
      messageManager.updateCurrentMessageContent("");

      expect(mockOnAssistantContentUpdated).toHaveBeenCalledWith("", "");
    });

    it("should create new text block when none exists", () => {
      const mockOnAssistantContentUpdated = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockOnAssistantContentUpdated,
      };

      const messageManager = new MessageManager({
        callbacks,
        workdir: "/test",
      });

      // Add an assistant message first
      messageManager.addAssistantMessage();

      // Update content (should create new text block)
      messageManager.updateCurrentMessageContent("New content");

      expect(mockOnAssistantContentUpdated).toHaveBeenCalledWith(
        "New content",
        "New content",
      );

      // Verify the message has the content
      const messages = messageManager.getMessages();
      const lastMessage = messages[messages.length - 1];
      expect(lastMessage.role).toBe("assistant");
      expect(lastMessage.blocks[0]).toEqual({
        type: "text",
        content: "New content",
      });
    });

    it("should do nothing if no messages exist", () => {
      const mockOnAssistantContentUpdated = vi.fn();

      const callbacks: MessageManagerCallbacks = {
        onAssistantContentUpdated: mockOnAssistantContentUpdated,
      };

      const messageManager = new MessageManager({
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

      const messageManager = new MessageManager({
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
});
