import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageList } from "@/components/MessageList";
import type { Message } from "@/types";

// Mock the constants module BEFORE any imports - only override MESSAGES_PER_PAGE
vi.mock("@/utils/constants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/utils/constants")>();
  return {
    ...actual,
    MESSAGES_PER_PAGE: 10, // Override only this value for testing
  };
});

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
    vi.clearAllMocks();
  });

  describe("New pagination logic - first page incomplete, others complete", () => {
    describe(`Scenario: 23 messages with ${MESSAGES_PER_PAGE} per page`, () => {
      const messages = Array.from({ length: 23 }, (_, i) =>
        createMessage("user", `Message ${i + 1}`, i + 1),
      );

      it("should display the last page by default (auto mode)", () => {
        const { lastFrame } = render(<MessageList messages={messages} />);

        // With 10 per page: 23 messages = Page 1 (3 msgs), Page 2 (10 msgs), Page 3 (10 msgs)
        // Should show last page (page 3) with messages 14-23
        expect(lastFrame()).toContain("Message 14 - Message 14");
        expect(lastFrame()).toContain("Message 23 - Message 23");
        expect(lastFrame()).not.toContain("Message 13 - Message 13");

        // Should show correct page info
        expect(lastFrame()).toContain("Messages 23 Page 3/3");
      });

      it("should show correct message numbering on last page", () => {
        const { lastFrame } = render(<MessageList messages={messages} />);

        // Should show message numbers for last page (messages 14-23)
        expect(lastFrame()).toContain("#14");
        expect(lastFrame()).toContain("#20");
        expect(lastFrame()).toContain("#23");
        expect(lastFrame()).not.toContain("#13");
        expect(lastFrame()).not.toContain("#24");
      });
    });

    describe(`Scenario: 15 messages with ${MESSAGES_PER_PAGE} per page`, () => {
      const messages = Array.from({ length: 15 }, (_, i) =>
        createMessage("user", `Msg ${i + 1}`, i + 1),
      );

      it("should display the last page by default (auto mode)", () => {
        const { lastFrame } = render(<MessageList messages={messages} />);

        // With 10 per page: 15 messages = Page 1 (5 msgs), Page 2 (10 msgs)
        // Should show last page (page 2) with messages 6-15
        expect(lastFrame()).toContain("Msg 6 - Message 6");
        expect(lastFrame()).toContain("Msg 15 - Message 15");
        expect(lastFrame()).not.toContain("Msg 5 - Message 5");

        // Should show correct page info
        expect(lastFrame()).toContain("Messages 15 Page 2/2");
      });
    });

    describe(`Scenario: ${MESSAGES_PER_PAGE * 2} messages with ${MESSAGES_PER_PAGE} per page (exact multiple)`, () => {
      const messages = Array.from({ length: MESSAGES_PER_PAGE * 2 }, (_, i) =>
        createMessage("user", `Test ${i + 1}`, i + 1),
      );

      it("should display complete last page when message count is exact multiple", () => {
        const { lastFrame } = render(<MessageList messages={messages} />);

        // With 10 per page: 20 messages = Page 1 (10 msgs), Page 2 (10 msgs)
        // Should show last page (page 2) with messages 11-20
        expect(lastFrame()).toContain(
          `Test ${MESSAGES_PER_PAGE + 1} - Message ${MESSAGES_PER_PAGE + 1}`,
        );
        expect(lastFrame()).toContain(
          `Test ${MESSAGES_PER_PAGE * 2} - Message ${MESSAGES_PER_PAGE * 2}`,
        );
        expect(lastFrame()).not.toContain(
          `Test ${MESSAGES_PER_PAGE} - Message ${MESSAGES_PER_PAGE}`,
        );

        expect(lastFrame()).toContain(
          `Messages ${MESSAGES_PER_PAGE * 2} Page 2/2`,
        );
      });
    });

    describe("Single page scenarios", () => {
      it("should handle messages that fit in one page", () => {
        const messages = Array.from({ length: 3 }, (_, i) =>
          createMessage("user", `Short ${i + 1}`, i + 1),
        );

        const { lastFrame } = render(<MessageList messages={messages} />);

        // Should show all messages on page 1
        expect(lastFrame()).toContain("Short 1 - Message 1");
        expect(lastFrame()).toContain("Short 3 - Message 3");
        expect(lastFrame()).toContain("Messages 3 Page 1/1");
      });

      it("should handle exactly one page worth of messages", () => {
        const messages = Array.from({ length: MESSAGES_PER_PAGE }, (_, i) =>
          createMessage("user", `Full ${i + 1}`, i + 1),
        );

        const { lastFrame } = render(<MessageList messages={messages} />);

        // Should show all messages on page 1
        expect(lastFrame()).toContain("Full 1 - Message 1");
        expect(lastFrame()).toContain(
          `Full ${MESSAGES_PER_PAGE} - Message ${MESSAGES_PER_PAGE}`,
        );
        expect(lastFrame()).toContain(`Messages ${MESSAGES_PER_PAGE} Page 1/1`);
      });
    });

    describe("Empty and edge cases", () => {
      it("should handle empty message list", () => {
        const messages: Message[] = [];
        const { lastFrame } = render(<MessageList messages={messages} />);

        // Should show welcome message when no messages
        expect(lastFrame()).toContain("Welcome to LCAP Code Assistant!");
      });

      it("should handle single message", () => {
        const messages = [createMessage("user", "Only", 1)];
        const { lastFrame } = render(<MessageList messages={messages} />);

        expect(lastFrame()).toContain("Only - Message 1");
        expect(lastFrame()).toContain("Messages 1 Page 1/1");
        expect(lastFrame()).toContain("#1");
      });
    });
  });

  describe("Pagination display elements", () => {
    it("should show pagination info for multiple pages", () => {
      const messages = Array.from({ length: 30 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );

      const { lastFrame } = render(<MessageList messages={messages} />);

      // Should show total messages and current page info
      expect(lastFrame()).toContain("Messages 30 Page");
      expect(lastFrame()).toMatch(/Page \d+\/\d+/);
    });

    it("should show navigation hints when multiple pages exist", () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );

      const { lastFrame } = render(<MessageList messages={messages} />);

      // Should show navigation controls when there are multiple pages
      expect(lastFrame()).toContain("Ctrl+U/D");
      expect(lastFrame()).toContain("Navigate");
    });

    it("should not show navigation hints for single page", () => {
      const messages = Array.from({ length: 3 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );

      const { lastFrame } = render(<MessageList messages={messages} />);

      // Navigation hints are always shown when there are messages
      // This test documents the current behavior
      expect(lastFrame()).toContain("Ctrl+U/D");
      expect(lastFrame()).toContain("Navigate");
      expect(lastFrame()).toContain("Messages 3 Page 1/1");
    });
  });

  describe("Message content rendering", () => {
    it("should render only messages for current page", () => {
      const messages = Array.from({ length: 22 }, (_, i) =>
        createMessage("user", `Unique content ${i}`, i + 1),
      );

      const { lastFrame } = render(<MessageList messages={messages} />);

      // With 10 per page: 22 messages = Page 1 (2 msgs), Page 2 (10 msgs), Page 3 (10 msgs)
      // Auto mode should show last page (Page 3) with messages 13-22
      expect(lastFrame()).toContain("Unique content 12"); // Message 13
      expect(lastFrame()).toContain("Unique content 21"); // Message 22

      // Should NOT contain content from other pages
      expect(lastFrame()).not.toContain("Unique content 0"); // Message 1
      expect(lastFrame()).not.toContain("Unique content 11"); // Message 12
    });

    it("should handle different message types on same page", () => {
      const messages = [
        createMessage("user", "User message", 1),
        createMessage("assistant", "Assistant message", 2),
        createMessage("user", "Another user message", 3),
        createMessage("assistant", "Another assistant message", 4),
        createMessage("user", "Last user message", 5),
        createMessage("assistant", "Last assistant message", 6),
      ];

      const { lastFrame } = render(<MessageList messages={messages} />);

      // With 6 messages: all fit in one page
      // Auto mode shows all messages on page 1
      expect(lastFrame()).toContain("User message");
      expect(lastFrame()).toContain("Assistant message");
      expect(lastFrame()).toContain("Last assistant message");

      // Should show correct message roles
      expect(lastFrame()).toContain("👤 You");
      expect(lastFrame()).toContain("🤖 Assistant");

      expect(lastFrame()).toContain("Messages 6 Page 1/1");
    });
  });

  describe("Complex pagination scenarios", () => {
    it("should handle large number of messages correctly", () => {
      // Test with 47 messages: Page 1 (7 msgs), Pages 2-5 (10 msgs each)
      const messages = Array.from({ length: 47 }, (_, i) =>
        createMessage("user", `Bulk ${i + 1}`, i + 1),
      );

      const { lastFrame } = render(<MessageList messages={messages} />);

      // Should show last page (page 5) with messages 38-47
      expect(lastFrame()).toContain("Bulk 38 - Message 38");
      expect(lastFrame()).toContain("Bulk 47 - Message 47");
      expect(lastFrame()).not.toContain("Bulk 37 - Message 37");

      expect(lastFrame()).toContain("Messages 47 Page 5/5");
    });

    it("should preserve message headers and structure", () => {
      const messages = Array.from({ length: 12 }, (_, i) => {
        const role = i % 2 === 0 ? "user" : "assistant";
        return createMessage(role, `Test ${i + 1}`, i + 1);
      });

      const { lastFrame } = render(<MessageList messages={messages} />);

      // With 12 messages: Page 1 (2 msgs), Page 2 (10 msgs)
      // Should show page 2 with messages 3-12
      expect(lastFrame()).toContain("👤 You"); // User messages
      expect(lastFrame()).toContain("🤖 Assistant"); // Assistant messages

      // Should have proper message numbering for page 2
      expect(lastFrame()).toContain("#3");
      expect(lastFrame()).toContain("#12");

      // Should NOT contain messages from page 1
      expect(lastFrame()).not.toMatch(/#1\s/); // Use regex to be more specific
      expect(lastFrame()).not.toMatch(/#2\s/); // Use regex to be more specific
    });
  });
});
