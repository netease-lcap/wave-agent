import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageList } from "../../src/components/MessageList.js";
import type { Message } from "wave-agent-sdk";

// Mock usePagination hook using vi.hoisted
const mockUsePagination = vi.hoisted(() => vi.fn());

vi.mock("../../src/hooks/usePagination", () => ({
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
      const { lastFrame } = render(
        <MessageList
          messages={[]}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      expect(lastFrame()).toContain("Welcome to WAVE Code Assistant!");
    });
  });

  describe("Basic message rendering", () => {
    it("should render a single message", () => {
      const messages = [createMessage("user", "Hello", 1)];
      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

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
      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      expect(lastFrame()).toContain("👤 You");
      expect(lastFrame()).toContain("🤖 Assistant");
      expect(lastFrame()).toContain("Hello - Message 1");
      expect(lastFrame()).toContain("Hi there - Message 2");
    });

    it("should render error blocks", () => {
      const messages: Message[] = [
        {
          role: "assistant",
          blocks: [{ type: "error", content: "Something went wrong" }],
        },
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

      expect(lastFrame()).toContain("❌ Error: Something went wrong");
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
      const { lastFrame } = render(
        <MessageList
          messages={messages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      expect(lastFrame()).toContain("👤 You #1");
      expect(lastFrame()).toContain("🤖 Assistant #2");
      expect(lastFrame()).toContain("First - Message 1");
      expect(lastFrame()).toContain("Second - Message 2");
    });
  });

  describe("Image display", () => {
    it("should display '📷 Image (1)' for message with single image", () => {
      // Create a message with single image block
      const messagesWithImage: Message[] = [
        {
          role: "user",
          blocks: [
            { type: "text", content: "Look at this image" },
            {
              type: "image",
              attributes: {
                imageUrls: ["/tmp/test-image.png"],
              },
            },
          ],
        },
      ];

      const { lastFrame } = render(
        <MessageList
          messages={messagesWithImage}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      const output = lastFrame();

      // Should display the image indicator with count
      expect(output).toContain("📷 Image (1)");
      expect(output).toContain("Look at this image");
    });

    it("should display '📷 Image (2)' for message with multiple images", () => {
      // Create a message with multiple image blocks
      const messagesWithImages: Message[] = [
        {
          role: "user",
          blocks: [
            {
              type: "image",
              attributes: {
                imageUrls: ["/tmp/test-image1.png", "/tmp/test-image2.jpg"],
              },
            },
          ],
        },
      ];

      const { lastFrame } = render(
        <MessageList
          messages={messagesWithImages}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      const output = lastFrame();

      // Should display the image indicator with count of 2
      expect(output).toContain("📷 Image (2)");
    });

    it("should display '📷 Image' without count for empty image block", () => {
      // Create a message with image block but no imageUrls
      const messagesWithEmptyImage: Message[] = [
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

      const { lastFrame } = render(
        <MessageList
          messages={messagesWithEmptyImage}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      const output = lastFrame();

      // Should display just the image indicator without count
      expect(output).toContain("📷 Image");
      expect(output).not.toContain("📷 Image (");
    });

    it("should display image-only message correctly", () => {
      // Create a message with only image, no text
      const imageOnlyMessage: Message[] = [
        {
          role: "user",
          blocks: [
            {
              type: "image",
              attributes: {
                imageUrls: ["/tmp/test-image.png"],
              },
            },
          ],
        },
      ];

      const { lastFrame } = render(
        <MessageList
          messages={imageOnlyMessage}
          isLoading={false}
          isCommandRunning={false}
          latestTotalTokens={1000}
          isExpanded={false}
        />,
      );

      const output = lastFrame();

      // Should display the image indicator
      expect(output).toContain("📷 Image (1)");
      // Should show user header
      expect(output).toContain("👤 You");
    });
  });
});
