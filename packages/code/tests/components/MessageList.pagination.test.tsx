import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageList } from "../../src/components/MessageList.js";
import type { Message } from "wave-agent-sdk";

// Mock the constants module BEFORE any imports - override MESSAGES_PER_PAGE
vi.mock("../../src/utils/constants", () => ({
  MESSAGES_PER_PAGE: 10, // Override for testing
}));

// Mock useInput to prevent key handling during tests
vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

// Use the mocked value in tests
const MESSAGES_PER_PAGE = 10;

describe("MessageList Pagination", () => {
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

  describe("Pagination scenarios", () => {
    it("should handle 23 messages with last page display and correct numbering", () => {
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

      // With 10 per page: 23 messages = Page 1 (3 msgs), Page 2 (10 msgs), Page 3 (10 msgs)
      // Default shows last page (page 3) with messages 14-23
      expect(lastFrame()).toContain("Message 14 - Message 14");
      expect(lastFrame()).toContain("Message 23 - Message 23");
      expect(lastFrame()).not.toContain("Message 3 - Message 3"); // Not from page 1
      expect(lastFrame()).not.toContain("Message 13 - Message 13"); // Not from page 2

      // Should show correct page info and message numbers
      expect(lastFrame()).toContain("Messages 23 Page 3/3");
      // For same-role consecutive messages, only the very first message (index 0) shows numbering
      // Messages 14-23 are all 'user' role and consecutive, so no numbering should be visible
      expect(lastFrame()).not.toContain("#14");
      expect(lastFrame()).not.toContain("#20");
      expect(lastFrame()).not.toContain("#23");
      expect(lastFrame()).not.toContain("#3"); // Not from page 1
      expect(lastFrame()).not.toContain("#13"); // Not from page 2
      expect(lastFrame()).not.toContain("#24"); // Doesn't exist
    });

    it("should handle 15 messages with page boundary crossing", () => {
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

      // With 10 per page: 15 messages = Page 1 (5 msgs), Page 2 (10 msgs)
      // Default shows last page (page 2) with messages 6-15
      expect(lastFrame()).toContain("Msg 6 - Message 6");
      expect(lastFrame()).toContain("Msg 15 - Message 15");
      expect(lastFrame()).not.toContain("Msg 1 - Message 1"); // Not from page 1
      expect(lastFrame()).not.toContain("Msg 5 - Message 5"); // Not from page 1

      // Should show correct page info and numbering
      expect(lastFrame()).toContain("Messages 15 Page 2/2");
      // For same-role consecutive messages, only the very first message (index 0) shows numbering
      // Messages 6-15 are all 'user' role and consecutive, so no numbering should be visible
      expect(lastFrame()).not.toContain("#6");
      expect(lastFrame()).not.toContain("#10");
      expect(lastFrame()).not.toContain("#15");
      expect(lastFrame()).not.toMatch(/#1\b/); // Not from page 1
      expect(lastFrame()).not.toMatch(/#5\b/); // Not from page 1
      expect(lastFrame()).not.toContain("#16"); // Doesn't exist
    });

    it("should handle exact page multiple (20 messages = 2 full pages)", () => {
      const messages = Array.from({ length: MESSAGES_PER_PAGE * 2 }, (_, i) =>
        createMessage("user", `Test ${i + 1}`, i + 1),
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

      // With 10 per page: 20 messages = Page 1 (10 msgs), Page 2 (10 msgs)
      // Default shows last page (page 2) with messages 11-20
      expect(lastFrame()).toContain(
        `Test ${MESSAGES_PER_PAGE + 1} - Message ${MESSAGES_PER_PAGE + 1}`,
      );
      expect(lastFrame()).toContain(
        `Test ${MESSAGES_PER_PAGE * 2} - Message ${MESSAGES_PER_PAGE * 2}`,
      );
      expect(lastFrame()).not.toContain(
        `Test 1 - Message 1`, // Not from page 1
      );
      expect(lastFrame()).not.toContain(
        `Test ${MESSAGES_PER_PAGE} - Message ${MESSAGES_PER_PAGE}`, // Not from page 1
      );

      expect(lastFrame()).toContain(
        `Messages ${MESSAGES_PER_PAGE * 2} Page 2/2`,
      );
    });

    it("should handle large number of messages (47 messages = 5 pages)", () => {
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

      // With 10 per page: 47 messages = Page 1 (7 msgs), Page 2-5 (10 msgs each)
      // Default shows last page (page 5) with messages 38-47
      expect(lastFrame()).toContain("Bulk 38 - Message 38");
      expect(lastFrame()).toContain("Bulk 47 - Message 47");
      expect(lastFrame()).not.toContain("Bulk 7 - Message 7"); // Not from page 1
      expect(lastFrame()).not.toContain("Bulk 37 - Message 37"); // Not from page 4

      expect(lastFrame()).toContain("Messages 47 Page 5/5");
    });
  });

  describe("Single page scenarios", () => {
    it("should handle messages that fit in one page (3 messages)", () => {
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

      // Should show all messages on page 1 with correct numbering
      expect(lastFrame()).toContain("Short 1 - Message 1");
      expect(lastFrame()).toContain("Short 3 - Message 3");
      expect(lastFrame()).toContain("Messages 3 Page 1/1");
      expect(lastFrame()).toContain("#1");
      // For same-role consecutive messages, only the first one shows numbering
      expect(lastFrame()).not.toContain("#2");
      expect(lastFrame()).not.toContain("#3");
    });

    it("should handle exactly one page worth of messages (10 messages)", () => {
      const messages = Array.from({ length: MESSAGES_PER_PAGE }, (_, i) =>
        createMessage("user", `Full ${i + 1}`, i + 1),
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

      // Should show all messages on page 1
      expect(lastFrame()).toContain("Full 1 - Message 1");
      expect(lastFrame()).toContain(
        `Full ${MESSAGES_PER_PAGE} - Message ${MESSAGES_PER_PAGE}`,
      );
      expect(lastFrame()).toContain(`Messages ${MESSAGES_PER_PAGE} Page 1/1`);
      expect(lastFrame()).toContain("#1");
      // For same-role consecutive messages, only the first one shows numbering
      expect(lastFrame()).not.toContain(`#${MESSAGES_PER_PAGE}`);
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
      expect(lastFrame()).toContain("Messages 1 Page 1/1");
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
    it("should show navigation hints and pagination info for multiple pages", () => {
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

      // Should show total messages, current page info, and navigation hints
      expect(lastFrame()).toContain("Messages 30 Page");
      expect(lastFrame()).toMatch(/Page \d+\/\d+/);
      expect(lastFrame()).toContain("Ctrl+U/D");
      expect(lastFrame()).toContain("Navigate");
    });

    it("should show navigation hints even for single page", () => {
      const messages = Array.from({ length: 3 }, (_, i) =>
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

      // Navigation hints are always shown when there are messages
      expect(lastFrame()).toContain("Ctrl+U/D");
      expect(lastFrame()).toContain("Navigate");
      expect(lastFrame()).toContain("Messages 3 Page 1/1");
    });
  });

  describe("Message content and types", () => {
    it("should render only messages for current page", () => {
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

      // With 10 per page: 22 messages = Page 1 (2 msgs), Page 2 (10 msgs), Page 3 (10 msgs)
      // Default shows last page (Page 3) with messages 13-22
      expect(lastFrame()).toContain("Unique content 12"); // Message 13
      expect(lastFrame()).toContain("Unique content 21"); // Message 22

      // Should NOT contain content from other pages
      expect(lastFrame()).not.toContain("Unique content 0"); // Message 1 (page 1)
      expect(lastFrame()).not.toMatch(/\bUnique content 1\b/); // Message 2 (page 1) - use word boundary
      expect(lastFrame()).not.toMatch(/\bUnique content 2\b/); // Message 3 (page 2) - use word boundary
      expect(lastFrame()).not.toContain("Unique content 11"); // Message 12 (page 2)
    });

    it("should handle different message types and preserve structure", () => {
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

      // With 12 messages: Page 1 (2 msgs), Page 2 (10 msgs)
      // Default shows page 2 with messages 3-12
      expect(lastFrame()).toContain("👤 You"); // User messages
      expect(lastFrame()).toContain("🤖 Assistant"); // Assistant messages

      // Should have proper message numbering for page 2 (messages 3-12)
      expect(lastFrame()).toContain("#3");
      expect(lastFrame()).toContain("#12");

      // Should NOT contain messages from page 1 (messages 1-2)
      expect(lastFrame()).not.toMatch(/#1\b/);
      expect(lastFrame()).not.toMatch(/#2\b/);
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

      // Should show pagination and complex content on current page
      expect(lastFrame()).toContain("Messages 20 Page");
      expect(lastFrame()).toMatch(/Page \d+\/\d+/);
      expect(lastFrame()).toContain("Solution");
      expect(lastFrame()).toContain("More content here");
      expect(lastFrame()).toContain("❌ Error:");
    });
  });
});
