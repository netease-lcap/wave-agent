import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageList } from "../../src/components/MessageList.js";
import type { Message } from "wave-agent-sdk";

// Mock useInput to prevent key handling during tests
vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

describe("MessageList Static Rendering", () => {
  const createMessage = (
    role: "user" | "assistant",
    content: string,
    id: number,
  ): Message => ({
    role,
    blocks: [
      {
        type: "text",
        content: `${content} - Message ${id}`,
      },
    ],
  });

  beforeEach(() => {
    // Clear any potential state
  });

  describe("Static rendering scenarios", () => {
    it("should render all messages with correct numbering (23 messages)", () => {
      const messages = Array.from({ length: 23 }, (_, i) =>
        createMessage("user", `Message ${i + 1}`, i + 1),
      );

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // All messages should be visible (no pagination)
      expect(lastFrame()).toContain("Message 1 - Message 1");
      expect(lastFrame()).toContain("Message 14 - Message 14");
      expect(lastFrame()).toContain("Message 23 - Message 23");

      // Should show correct message count without page info
      expect(lastFrame()).toContain("Messages 23");
      expect(lastFrame()).not.toContain("Page");

      // For same-role consecutive messages, only the very first message (index 0) shows numbering
      expect(lastFrame()).toContain("#1");
      expect(lastFrame()).not.toContain("#14");
      expect(lastFrame()).not.toContain("#20");
      expect(lastFrame()).not.toContain("#23");
    });

    it("should render all messages without pagination (15 messages)", () => {
      const messages = Array.from({ length: 15 }, (_, i) =>
        createMessage("user", `Msg ${i + 1}`, i + 1),
      );

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // All messages should be visible
      expect(lastFrame()).toContain("Msg 1 - Message 1");
      expect(lastFrame()).toContain("Msg 6 - Message 6");
      expect(lastFrame()).toContain("Msg 15 - Message 15");

      // Should show correct message count without page info
      expect(lastFrame()).toContain("Messages 15");
      expect(lastFrame()).not.toContain("Page");

      // For same-role consecutive messages, only the first one shows numbering
      expect(lastFrame()).toContain("#1");
      expect(lastFrame()).not.toContain("#6");
      expect(lastFrame()).not.toContain("#15");
    });

    it("should handle large number of messages and show all (47 messages)", () => {
      const messages = Array.from({ length: 47 }, (_, i) =>
        createMessage("user", `Bulk ${i + 1}`, i + 1),
      );

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // All messages should be visible (no pagination limits)
      expect(lastFrame()).toContain("Bulk 1 - Message 1");
      expect(lastFrame()).toContain("Bulk 7 - Message 7");
      expect(lastFrame()).toContain("Bulk 38 - Message 38");
      expect(lastFrame()).toContain("Bulk 47 - Message 47");

      expect(lastFrame()).toContain("Messages 47");
      expect(lastFrame()).not.toContain("Page");
    });
  });

  describe("Small message collections", () => {
    it("should handle messages that fit in one screen (3 messages)", () => {
      const messages = Array.from({ length: 3 }, (_, i) =>
        createMessage("user", `Short ${i + 1}`, i + 1),
      );

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // Should show all messages with correct numbering
      expect(lastFrame()).toContain("Short 1 - Message 1");
      expect(lastFrame()).toContain("Short 3 - Message 3");
      expect(lastFrame()).toContain("Messages 3");
      expect(lastFrame()).not.toContain("Page");
      expect(lastFrame()).toContain("#1");
      // For same-role consecutive messages, only the first one shows numbering
      expect(lastFrame()).not.toContain("#2");
      expect(lastFrame()).not.toContain("#3");
    });

    it("should handle single message", () => {
      const messages = [createMessage("user", "Only", 1)];
      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      expect(lastFrame()).toContain("Only - Message 1");
      expect(lastFrame()).toContain("Messages 1");
      expect(lastFrame()).not.toContain("Page");
      expect(lastFrame()).toContain("#1");
    });

    it("should handle empty message list", () => {
      const messages: Message[] = [];
      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // Should show welcome message when no messages
      expect(lastFrame()).toContain("Welcome to WAVE Code Assistant!");
    });
  });

  describe("Navigation and display elements", () => {
    it("should show only toggle expand controls (no pagination navigation)", () => {
      const messages = Array.from({ length: 30 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // Should show total messages without pagination info
      expect(lastFrame()).toContain("Messages 30");
      expect(lastFrame()).not.toContain("Page");

      // Should NOT show pagination navigation
      expect(lastFrame()).not.toContain("Ctrl+U/D");
      expect(lastFrame()).not.toContain("Navigate");

      // Should show expand toggle
      expect(lastFrame()).toContain("Ctrl+O");
      expect(lastFrame()).toContain("Toggle Expand");
    });

    it("should show expand controls for single message", () => {
      const messages = Array.from({ length: 1 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // Should NOT show pagination navigation
      expect(lastFrame()).not.toContain("Ctrl+U/D");
      expect(lastFrame()).not.toContain("Navigate");

      // Should show expand toggle
      expect(lastFrame()).toContain("Ctrl+O");
      expect(lastFrame()).toContain("Messages 1");
      expect(lastFrame()).not.toContain("Page");
    });

    it("should show correct expand state in controls", () => {
      const messages = [createMessage("user", "Test", 1)];

      // Test collapsed state
      const { lastFrame: collapsedFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      expect(collapsedFrame()).toContain("Toggle Expand");

      // Test expanded state
      const { lastFrame: expandedFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={true}
        />,
      );

      expect(expandedFrame()).toContain("Toggle Collapse");
    });
  });

  describe("Message content and types", () => {
    it("should render all messages content (no pagination filtering)", () => {
      const messages = Array.from({ length: 22 }, (_, i) =>
        createMessage("user", `Unique content ${i}`, i + 1),
      );

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // ALL messages should be visible (no pagination)
      expect(lastFrame()).toContain("Unique content 0"); // Message 1
      expect(lastFrame()).toContain("Unique content 1"); // Message 2
      expect(lastFrame()).toContain("Unique content 11"); // Message 12
      expect(lastFrame()).toContain("Unique content 12"); // Message 13
      expect(lastFrame()).toContain("Unique content 21"); // Message 22
    });

    it("should handle different message types and preserve structure for all messages", () => {
      const messages = Array.from({ length: 12 }, (_, i) => {
        const role = i % 2 === 0 ? "user" : "assistant";
        return createMessage(role, `Test ${i + 1}`, i + 1);
      });

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // All messages should be visible
      expect(lastFrame()).toContain("👤 You"); // User messages
      expect(lastFrame()).toContain("🤖 Assistant"); // Assistant messages

      // Should have proper message numbering for ALL messages
      expect(lastFrame()).toContain("#1");
      expect(lastFrame()).toContain("#2");
      expect(lastFrame()).toContain("#3");
      expect(lastFrame()).toContain("#12");
    });

    it("should handle complex message types with mixed blocks", () => {
      const createComplexMessage = (id: number): Message => ({
        role: "assistant",
        blocks: [
          { type: "text", content: `Solution ${id}` },
          { type: "text", content: "More content here" },
          { type: "error", content: `Error ${id}` },
        ],
      });

      const messages = Array.from({ length: 20 }, (_, i) =>
        createComplexMessage(i + 1),
      );
      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // Should show message count without pagination and complex content
      expect(lastFrame()).toContain("Messages 20");
      expect(lastFrame()).not.toContain("Page");
      expect(lastFrame()).toContain("Solution");
      expect(lastFrame()).toContain("More content here");
      expect(lastFrame()).toContain("❌ Error:");
    });

    it("should correctly show headers for alternating message roles", () => {
      const messages = [
        createMessage("user", "Question 1", 1),
        createMessage("assistant", "Answer 1", 2),
        createMessage("user", "Question 2", 3),
        createMessage("assistant", "Answer 2", 4),
      ];

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // All role headers should be visible with numbering
      expect(lastFrame()).toContain("👤 You #1");
      expect(lastFrame()).toContain("🤖 Assistant #2");
      expect(lastFrame()).toContain("👤 You #3");
      expect(lastFrame()).toContain("🤖 Assistant #4");

      // All message content should be visible
      expect(lastFrame()).toContain("Question 1 - Message 1");
      expect(lastFrame()).toContain("Answer 1 - Message 2");
      expect(lastFrame()).toContain("Question 2 - Message 3");
      expect(lastFrame()).toContain("Answer 2 - Message 4");
    });

    it("should handle consecutive messages of same role correctly", () => {
      const messages = [
        createMessage("user", "First user message", 1),
        createMessage("user", "Second user message", 2),
        createMessage("user", "Third user message", 3),
      ];

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // Only the first message should have a header with numbering
      expect(lastFrame()).toContain("👤 You #1");
      expect(lastFrame()).not.toContain("#2");
      expect(lastFrame()).not.toContain("#3");

      // All message content should still be visible
      expect(lastFrame()).toContain("First user message - Message 1");
      expect(lastFrame()).toContain("Second user message - Message 2");
      expect(lastFrame()).toContain("Third user message - Message 3");
    });
  });

  describe("Static vs Dynamic message rendering", () => {
    it("should render all messages including the last one", () => {
      const messages = [
        createMessage("user", "Static message 1", 1),
        createMessage("assistant", "Static message 2", 2),
        createMessage("user", "Dynamic last message", 3),
      ];

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      // All messages should be visible
      expect(lastFrame()).toContain("Static message 1 - Message 1");
      expect(lastFrame()).toContain("Static message 2 - Message 2");
      expect(lastFrame()).toContain("Dynamic last message - Message 3");

      // Proper numbering for role changes
      expect(lastFrame()).toContain("👤 You #1");
      expect(lastFrame()).toContain("🤖 Assistant #2");
      expect(lastFrame()).toContain("👤 You #3");
    });

    it("should handle single message (all dynamic, no static)", () => {
      const messages = [createMessage("user", "Only message", 1)];

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      expect(lastFrame()).toContain("Only message - Message 1");
      expect(lastFrame()).toContain("👤 You #1");
      expect(lastFrame()).toContain("Messages 1");
    });
  });
});
