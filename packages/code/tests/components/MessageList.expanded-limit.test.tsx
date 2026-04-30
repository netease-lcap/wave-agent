import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageList } from "../../src/components/MessageList.js";
import { useTasks } from "../../src/hooks/useTasks.js";
import { ChatContextType, useChat } from "../../src/contexts/useChat.js";
import type { Message } from "wave-agent-sdk";

// Mock useInput to prevent key handling during tests
vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useInput: vi.fn(),
  };
});

vi.mock("../../src/hooks/useTasks.js", () => ({
  useTasks: vi.fn(),
}));

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

describe("MessageList Component - Expanded Mode Limit", () => {
  const createMessage = (
    role: "user" | "assistant",
    content: string,
    id: number,
  ): Message => ({
    id: `msg-${id}`,
    role,
    blocks: [
      {
        type: "text",
        content: `${content} - Message ${id}`,
      },
    ],
    timestamp: new Date().toISOString(),
  });

  beforeEach(() => {
    // Clear any potential state
    vi.mocked(useTasks).mockReturnValue([]);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: true,
    } as unknown as ChatContextType);
  });

  describe("Message limiting in both modes", () => {
    it("should not limit messages when count is <= 10", () => {
      const messages = Array.from({ length: 8 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={true} />,
      );

      const output = lastFrame();

      // Should show all 8 messages
      expect(output).toContain("Test 1 - Message 1");
      expect(output).toContain("Test 8 - Message 8");
    });

    it("should limit messages to 10 when count > 10 and expanded", () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={true} />,
      );

      const output = lastFrame();

      // Should show only the latest 10 messages (messages 16-25)
      expect(output).not.toContain("Test 1 - Message 1");
      expect(output).not.toContain("Test 15 - Message 15");
      expect(output).toContain("Test 16 - Message 16");
      expect(output).toContain("Test 25 - Message 25");
    });

    it("should limit messages to 10 when count > 10 and collapsed", () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={false} />,
      );

      const output = lastFrame();

      // Should show only the latest 10 messages (messages 16-25)
      expect(output).not.toContain("Test 1 - Message 1");
      expect(output).not.toContain("Test 15 - Message 15");
      expect(output).toContain("Test 16 - Message 16");
      expect(output).toContain("Test 25 - Message 25");
    });

    it("should handle exact limit boundary (10 messages)", () => {
      const messages = Array.from({ length: 10 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={true} />,
      );

      const output = lastFrame();

      // Should show all 10 messages without limiting
      expect(output).toContain("Test 1 - Message 1");
      expect(output).toContain("Test 10 - Message 10");
    });

    it("should handle exact limit boundary + 1 (11 messages)", () => {
      const messages = Array.from({ length: 11 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={true} />,
      );

      const output = lastFrame();

      // Should limit to 10 messages
      // Should not show the first message
      expect(output).not.toContain("Test 1 - Message 1");
      expect(output).toContain("Test 2 - Message 2");
      expect(output).toContain("Test 11 - Message 11");
    });
  });

  describe("Integration with other features", () => {
    it("should work with message limiting", () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={true} />,
      );

      const output = lastFrame();

      // Should show only the latest 10 messages
      expect(output).not.toContain("Test 1 - Message 1");
      expect(output).toContain("Test 16 - Message 16");
      expect(output).toContain("Test 25 - Message 25");
    });

    it("should work with loading state and message limiting (moved to ChatInterface)", () => {
      const messages = Array.from({ length: 25 }, (_, i) =>
        createMessage(
          i % 2 === 0 ? "user" : "assistant",
          `Test ${i + 1}`,
          i + 1,
        ),
      );

      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={true} />,
      );

      const output = lastFrame();

      // Should NOT show loading indicator
      expect(output).not.toContain("💭 AI is thinking...");

      // Should show only the latest 10 messages
      expect(output).not.toContain("Test 1 - Message 1");
      expect(output).toContain("Test 16 - Message 16");
      expect(output).toContain("Test 25 - Message 25");
    });
  });
});
