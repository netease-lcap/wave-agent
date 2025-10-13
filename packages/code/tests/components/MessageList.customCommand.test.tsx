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

describe("MessageList CustomCommandBlock", () => {
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

  it("should render custom command block with command name only", () => {
    const messages: Message[] = [
      {
        role: "user",
        blocks: [
          {
            type: "custom_command",
            commandName: "refactor",
            content:
              "Please refactor this very long function that should not be displayed in full in the UI but only show the command name...",
          },
        ],
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

    const output = lastFrame();

    // Should display command name with icon
    expect(output).toContain("⚡ refactor");
    expect(output).toContain("(Custom Command)");

    // Should NOT display the full content
    expect(output).not.toContain("Please refactor this very long function");
  });

  it("should render mixed message types correctly", () => {
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

    const messages: Message[] = [
      {
        role: "user",
        blocks: [
          {
            type: "custom_command",
            commandName: "analyze",
            content: "Analyze this code for potential issues...",
          },
        ],
      },
      {
        role: "user",
        blocks: [
          {
            type: "text",
            content: "Also, can you explain this concept?",
          },
        ],
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

    const output = lastFrame();

    // Should display custom command
    expect(output).toContain("⚡ analyze");
    expect(output).toContain("(Custom Command)");

    // Should display regular text message
    expect(output).toContain("Also, can you explain this concept?");

    // Should NOT display the custom command content
    expect(output).not.toContain("Analyze this code for potential issues");
  });
});
