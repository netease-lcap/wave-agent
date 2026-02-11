import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageList } from "../../src/components/MessageList.js";
import { ChatProvider } from "../../src/contexts/useChat.js";
import { AppProvider } from "../../src/contexts/useAppConfig.js";
import type { Message } from "wave-agent-sdk";

// Mock useInput to prevent key handling during tests
vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

describe("MessageList Component - Expanded Mode Limit", () => {
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

  describe("Message limiting in expanded mode", () => {
    it("should not limit messages when count is <= 20", () => {
      const messages = Array.from({ length: 15 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} isExpanded={true} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should show all 15 messages
      expect(output).toContain("Messages 15");
      expect(output).toContain("Test 1 - Message 1");
      expect(output).toContain("Test 15 - Message 15");

      // Should not show omitted message indicator
      expect(output).not.toContain("earlier messages omitted");
    });

    it("should limit messages to 20 when count > 20 and expanded", () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} isExpanded={true} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should show total message count (25)
      expect(output).toContain("Messages 25");

      // Should show omitted message indicator
      expect(output).toContain("5 earlier messages omitted");
      expect(output).toContain("showing latest 20");

      // Should show only the latest 20 messages (messages 6-25)
      expect(output).not.toContain("Test 1 - Message 1");
      expect(output).not.toContain("Test 5 - Message 5");
      expect(output).toContain("Test 6 - Message 6");
      expect(output).toContain("Test 25 - Message 25");
    });

    it("should not limit messages when not in expanded mode", () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} isExpanded={false} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should show all messages in collapsed mode
      expect(output).toContain("Messages 25");
      expect(output).toContain("Test 1 - Message 1");
      expect(output).toContain("Test 25 - Message 25");

      // Should not show omitted message indicator
      expect(output).not.toContain("earlier messages omitted");
    });

    it("should handle exact limit boundary (20 messages)", () => {
      const messages = Array.from({ length: 20 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} isExpanded={true} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should show all 20 messages without limiting
      expect(output).toContain("Messages 20");
      expect(output).toContain("Test 1 - Message 1");
      expect(output).toContain("Test 20 - Message 20");

      // Should not show omitted message indicator
      expect(output).not.toContain("earlier messages omitted");
    });

    it("should handle exact limit boundary + 1 (21 messages)", () => {
      const messages = Array.from({ length: 21 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} isExpanded={true} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should limit to 20 messages
      expect(output).toContain("Messages 21");
      expect(output).toContain("1 earlier message omitted");
      expect(output).toContain("showing latest 20");

      // Should not show the first message
      expect(output).not.toContain("Test 1 - Message 1");
      expect(output).toContain("Test 2 - Message 2");
      expect(output).toContain("Test 21 - Message 21");
    });

    it("should handle singular vs plural in omitted message text", () => {
      // Test singular
      const messages21 = Array.from({ length: 21 }, (_, i) =>
        createMessage("user", `Test ${i + 1}`, i + 1),
      );

      const { lastFrame: frame21 } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages21} isExpanded={true} />
          </ChatProvider>
        </AppProvider>,
      );

      expect(frame21()).toContain("1 earlier message omitted");

      // Test plural
      const messages25 = Array.from({ length: 25 }, (_, i) =>
        createMessage("user", `Test ${i + 1}`, i + 1),
      );

      const { lastFrame: frame25 } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages25} isExpanded={true} />
          </ChatProvider>
        </AppProvider>,
      );

      expect(frame25()).toContain("5 earlier messages omitted");
    });
  });

  describe("Integration with other features", () => {
    it("should work with token display and message limiting", () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList
              messages={messages}
              isExpanded={true}
              latestTotalTokens={5000}
            />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should show token count
      expect(output).toContain("5,000 tokens");

      // Should show message limiting
      expect(output).toContain("5 earlier messages omitted");
      expect(output).toContain("Messages 25");
    });

    it("should work with loading state and message limiting", () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList
              messages={messages}
              isExpanded={true}
              isLoading={true}
            />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should show loading indicator
      expect(output).toContain("💭 AI is thinking...");

      // Should show message limiting
      expect(output).toContain("5 earlier messages omitted");
      expect(output).toContain("Messages 25");
    });
  });
});
