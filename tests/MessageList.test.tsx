import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageList } from "../src/components/MessageList";
import type { Message } from "../src/types";

// Mock usePagination hook using vi.hoisted
const mockUsePagination = vi.hoisted(() => vi.fn());

vi.mock("../src/hooks/usePagination", () => ({
  usePagination: mockUsePagination,
}));

describe("MessageList Component", () => {
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

  const createFileMessage = (
    path: string,
    action: "create" | "update" | "delete",
    content: string = "",
  ): Message => ({
    role: "assistant",
    blocks: [
      {
        type: "file",
        path,
        action,
        content,
      },
    ],
  });

  const createLargeMessage = (id: number): Message => ({
    role: "assistant",
    blocks: [
      { type: "text", content: `Large message ${id}` },
      {
        type: "file",
        path: `src/file${id}.ts`,
        action: "create",
        content: 'logger.info("large content");'.repeat(100),
      },
      { type: "text", content: "More content here" },
      { type: "error", content: "Some error occurred" },
    ],
  });

  const createImageMessage = (imageCount: number = 1): Message => ({
    role: "user",
    blocks: [
      {
        type: "image",
        attributes: {
          imageUrls: Array.from(
            { length: imageCount },
            (_, i) => `image${i + 1}.png`,
          ),
        },
      },
    ],
  });

  beforeEach(() => {
    // Reset mock pagination hook with default values
    mockUsePagination.mockReturnValue({
      displayInfo: {
        currentPage: 1,
        totalPages: 1,
        startIndex: 0,
        endIndex: 1,
        messagesPerPage: 5,
      },
      manualPage: null,
      setManualPage: vi.fn(),
      goToPage: vi.fn(),
      goToPrevPage: vi.fn(),
      goToNextPage: vi.fn(),
      goToFirstPage: vi.fn(),
      goToLastPage: vi.fn(),
    });
    vi.clearAllMocks();
  });

  describe("Empty state", () => {
    it("should display welcome message when no messages", () => {
      const { lastFrame } = render(<MessageList messages={[]} />);

      expect(lastFrame()).toContain("Welcome to LCAP Code Assistant!");
    });
  });

  describe("Basic message rendering", () => {
    it("should render a single message", () => {
      const messages = [createMessage("user", "Hello", 1)];
      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain("👤 You");
      expect(lastFrame()).toContain("Hello - Message 1");
      expect(lastFrame()).toContain("#1");
    });

    it("should render multiple messages", () => {
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 1,
          totalPages: 1,
          startIndex: 0,
          endIndex: 2,
          messagesPerPage: 5,
        },
        manualPage: null,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      const messages = [
        createMessage("user", "Hello", 1),
        createMessage("assistant", "Hi there", 2),
      ];
      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain("👤 You");
      expect(lastFrame()).toContain("🤖 Assistant");
      expect(lastFrame()).toContain("Hello - Message 1");
      expect(lastFrame()).toContain("Hi there - Message 2");
    });

    it("should render file operations", () => {
      const messages = [
        createFileMessage("src/test.ts", "create", 'logger.info("test");'),
      ];
      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain("📄 Create: src/test.ts");
      // File content is no longer displayed
      expect(lastFrame()).not.toContain('logger.info("test");');
    });

    it("should render delete operations without content", () => {
      const messages = [createFileMessage("src/test.ts", "delete")];
      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain("📄 Delete: src/test.ts");
      expect(lastFrame()).not.toContain("```");
    });

    it("should render message numbers correctly", () => {
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 1,
          totalPages: 1,
          startIndex: 0,
          endIndex: 2,
          messagesPerPage: 5,
        },
        manualPage: null,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      const messages = [
        createMessage("user", "First", 1),
        createMessage("assistant", "Second", 2),
      ];
      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain("👤 You #1");
      expect(lastFrame()).toContain("🤖 Assistant #2");
      expect(lastFrame()).toContain("First - Message 1");
      expect(lastFrame()).toContain("Second - Message 2");
    });

    it("should render image blocks", () => {
      const messages = [createImageMessage(1)];
      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain("📷 Image");
      expect(lastFrame()).toContain("(1)");
    });

    it("should render multiple images", () => {
      const messages = [createImageMessage(3)];
      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain("📷 Image");
      expect(lastFrame()).toContain("(3)");
    });

    it("should render image block without count when no imageUrls", () => {
      const messages: Message[] = [
        {
          role: "user",
          blocks: [
            {
              type: "image",
              attributes: {},
            },
          ],
        },
      ];
      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain("📷 Image");
      expect(lastFrame()).not.toContain("(");
    });
  });

  describe("Pagination display", () => {
    it("should show pagination info for multiple pages", () => {
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 4,
          totalPages: 4,
          startIndex: 15,
          endIndex: 20,
          messagesPerPage: 5,
        },
        manualPage: null,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      const messages = Array.from({ length: 20 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );
      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain("Messages 20 Page");
      expect(lastFrame()).toContain("4/4");
    });

    it("should show auto mode indicator when manualPage is null", () => {
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 2,
          totalPages: 2,
          startIndex: 5,
          endIndex: 10,
          messagesPerPage: 5,
        },
        manualPage: null,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      const messages = Array.from({ length: 10 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );
      const { lastFrame } = render(<MessageList messages={messages} />);

      // Auto mode indicator is no longer shown in the new design
      expect(lastFrame()).toContain("Messages 10 Page 2/2");
    });

    it("should not show auto mode indicator when in manual page mode", () => {
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 1,
          totalPages: 2,
          startIndex: 0,
          endIndex: 5,
          messagesPerPage: 5,
        },
        manualPage: 1,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      const messages = Array.from({ length: 10 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );
      const { lastFrame } = render(<MessageList messages={messages} />);

      // Auto mode indicator is no longer shown in the new design
      expect(lastFrame()).toContain("Messages 10 Page 1/2");
    });
  });

  describe("Message numbering", () => {
    it("should show correct message numbers based on displayInfo", () => {
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 1,
          totalPages: 1,
          startIndex: 0,
          endIndex: 3,
          messagesPerPage: 5,
        },
        manualPage: null,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      const messages = Array.from({ length: 3 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );
      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain("#1");
      expect(lastFrame()).toContain("#2");
      expect(lastFrame()).toContain("#3");
    });

    it("should show correct message numbers for middle page", () => {
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 2,
          totalPages: 3,
          startIndex: 5,
          endIndex: 10,
          messagesPerPage: 5,
        },
        manualPage: null,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      const messages = Array.from({ length: 15 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );
      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain("#6");
      expect(lastFrame()).toContain("#7");
      expect(lastFrame()).toContain("#8");
      expect(lastFrame()).toContain("#9");
      expect(lastFrame()).toContain("#10");
    });
  });

  describe("Navigation hints", () => {
    it("should show navigation hints when multiple pages exist", () => {
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 2,
          totalPages: 3,
          startIndex: 5,
          endIndex: 10,
          messagesPerPage: 5,
        },
        manualPage: null,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      const messages = Array.from({ length: 15 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );
      const { lastFrame } = render(<MessageList messages={messages} />);

      expect(lastFrame()).toContain("Ctrl+U/D");
      expect(lastFrame()).toContain("Navigate");
    });
  });

  describe("Message display based on pagination", () => {
    it("should display messages according to displayInfo from hook", () => {
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 1,
          totalPages: 2,
          startIndex: 0,
          endIndex: 3,
          messagesPerPage: 3,
        },
        manualPage: null,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      const messages = Array.from({ length: 6 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );
      const { lastFrame } = render(<MessageList messages={messages} />);

      // Should only show first 3 messages based on displayInfo
      expect(lastFrame()).toContain("Test - Message 1");
      expect(lastFrame()).toContain("Test - Message 2");
      expect(lastFrame()).toContain("Test - Message 3");
      expect(lastFrame()).not.toContain("Test - Message 4");
    });

    it("should display different page when displayInfo changes", () => {
      const messages = Array.from({ length: 6 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );

      // First render - page 1
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 1,
          totalPages: 2,
          startIndex: 0,
          endIndex: 3,
          messagesPerPage: 3,
        },
        manualPage: null,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      const { rerender, lastFrame } = render(
        <MessageList messages={messages} />,
      );
      expect(lastFrame()).toContain("Test - Message 1");
      expect(lastFrame()).not.toContain("Test - Message 4");

      // Update to page 2
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 2,
          totalPages: 2,
          startIndex: 3,
          endIndex: 6,
          messagesPerPage: 3,
        },
        manualPage: null,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      rerender(<MessageList messages={messages} />);
      expect(lastFrame()).not.toContain("Test - Message 1");
      expect(lastFrame()).toContain("Test - Message 4");
      expect(lastFrame()).toContain("Test - Message 6");
    });
  });

  describe("Complex message types", () => {
    it("should handle mixed block types in a single message", () => {
      const complexMessage: Message = {
        role: "assistant",
        blocks: [
          { type: "text", content: "Here is the solution:" },
          {
            type: "file",
            path: "src/test.ts",
            action: "create",
            content: "const test = 1;",
          },
          { type: "text", content: "And here is an error:" },
          { type: "error", content: "Something went wrong" },
        ],
      };

      const { lastFrame } = render(<MessageList messages={[complexMessage]} />);

      expect(lastFrame()).toContain("Here is the solution:");
      expect(lastFrame()).toContain("📄 Create: src/test.ts");
      // File content is no longer displayed
      expect(lastFrame()).not.toContain("const test = 1;");
      expect(lastFrame()).toContain("And here is an error:");
      expect(lastFrame()).toContain("❌ Error: Something went wrong");
    });

    it("should handle messages with large content blocks", () => {
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 4,
          totalPages: 4,
          startIndex: 15,
          endIndex: 20,
          messagesPerPage: 5,
        },
        manualPage: null,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      const messages = Array.from({ length: 20 }, (_, i) =>
        createLargeMessage(i + 1),
      );
      const { lastFrame } = render(<MessageList messages={messages} />);

      // Should show pagination
      expect(lastFrame()).toContain("Messages 20 Page");
      expect(lastFrame()).toContain("4/4");
    });
  });

  describe("Performance considerations", () => {
    it("should only render visible messages based on displayInfo", () => {
      mockUsePagination.mockReturnValue({
        displayInfo: {
          currentPage: 2,
          totalPages: 3,
          startIndex: 5,
          endIndex: 10,
          messagesPerPage: 5,
        },
        manualPage: null,
        setManualPage: vi.fn(),
        goToPage: vi.fn(),
        goToPrevPage: vi.fn(),
        goToNextPage: vi.fn(),
        goToFirstPage: vi.fn(),
        goToLastPage: vi.fn(),
      });

      const messages = Array.from({ length: 15 }, (_, i) =>
        createMessage("user", `Unique content ${i}`, i + 1),
      );
      const { lastFrame } = render(<MessageList messages={messages} />);

      // Should only contain content from current page (messages 6-10)
      expect(lastFrame()).toContain("Unique content 5"); // Message 6
      expect(lastFrame()).toContain("Unique content 9"); // Message 10

      // Should NOT contain content from other pages
      expect(lastFrame()).not.toContain("Unique content 0"); // Message 1
      expect(lastFrame()).not.toContain("Unique content 10"); // Message 11
    });

    it("should handle pagination hook updates efficiently", () => {
      const messages = Array.from({ length: 15 }, (_, i) =>
        createMessage("user", "Test", i + 1),
      );
      const { rerender } = render(<MessageList messages={messages} />);

      // Simulate multiple displayInfo updates
      for (let page = 1; page <= 3; page++) {
        mockUsePagination.mockReturnValue({
          displayInfo: {
            currentPage: page,
            totalPages: 3,
            startIndex: (page - 1) * 5,
            endIndex: page * 5,
            messagesPerPage: 5,
          },
          manualPage: null,
          setManualPage: vi.fn(),
          goToPage: vi.fn(),
          goToPrevPage: vi.fn(),
          goToNextPage: vi.fn(),
          goToFirstPage: vi.fn(),
          goToLastPage: vi.fn(),
        });
        rerender(<MessageList messages={messages} />);
      }

      // Should complete without errors
      expect(messages.length).toBe(15);
    });
  });
});
