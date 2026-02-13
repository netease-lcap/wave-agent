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
    // Clear any potential state
    vi.mocked(useTasks).mockReturnValue([]);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: true,
    } as unknown as ChatContextType);
  });

  describe("Component rendering", () => {
    it("should render correctly with basic props", () => {
      const messages = [
        createMessage("user", "Hello", 1),
        createMessage("assistant", "Hi there", 2),
      ];

      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={false} />,
      );

      const output = lastFrame();

      // Should render messages normally
      expect(output).toContain("👤 You");
      expect(output).toContain("🤖 Assistant");
      expect(output).toContain("Hello - Message 1");
      expect(output).toContain("Hi there - Message 2");
    });

    it("should render correctly without optional props", () => {
      const messages = [
        createMessage("user", "Hello", 1),
        createMessage("assistant", "Hi there", 2),
      ];

      const { lastFrame } = render(<MessageList messages={messages} />);

      const output = lastFrame();

      // Should render messages normally
      expect(output).toContain("👤 You");
      expect(output).toContain("🤖 Assistant");
      expect(output).toContain("Hello - Message 1");
      expect(output).toContain("Hi there - Message 2");
    });
  });

  describe("Component states and UI elements", () => {
    it("should maintain consistent formatting with toggle controls", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={false} />,
      );

      const output = lastFrame();

      // Should contain toggle hint
      expect(output).not.toContain("Ctrl+O");
      expect(output).not.toContain("Ctrl+T");
    });

    it("should display correctly when component is in expanded state", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <MessageList messages={messages} isExpanded={true} />,
      );

      const output = lastFrame();

      // Should contain collapse toggle hint
      expect(output).not.toContain("Ctrl+O");
      expect(output).not.toContain("Ctrl+T");
    });
  });

  describe("Component behavior with various states", () => {
    it("should work correctly when component is loading (moved to ChatInterface)", () => {
      const messages = [createMessage("user", "Loading test", 1)];

      const { lastFrame } = render(<MessageList messages={messages} />);

      const output = lastFrame();

      // Should NOT show loading state
      expect(output).not.toContain("💭 AI is thinking...");
    });

    it("should NOT show command running message (moved to ChatInterface)", () => {
      const messages = [createMessage("user", "Command test", 1)];

      const { lastFrame } = render(<MessageList messages={messages} />);

      const output = lastFrame();

      // Should NOT show command running state
      expect(output).not.toContain("🚀 Command is running...");
    });

    it("should NOT show compressing message (moved to ChatInterface)", () => {
      const messages = [createMessage("user", "Compress test", 1)];

      const { lastFrame } = render(<MessageList messages={messages} />);

      const output = lastFrame();

      // Should NOT show compressing state
      expect(output).not.toContain("🗜️ Compressing message history...");
    });

    it("should show welcome message in empty state", () => {
      const { lastFrame } = render(<MessageList messages={[]} />);

      const output = lastFrame();

      // Should show welcome message
      expect(output).toContain("Welcome to WAVE Code Assistant!");

      // Should not show message count section
      expect(output).not.toContain("Messages");
    });
  });

  describe("Multiple messages", () => {
    it("should display correct message count with multiple messages", () => {
      const messages = [
        createMessage("user", "First", 1),
        createMessage("assistant", "Second", 2),
        createMessage("user", "Third", 3),
      ];

      const { lastFrame } = render(<MessageList messages={messages} />);

      const output = lastFrame();

      // Should show all messages
      expect(output).toContain("First - Message 1");
      expect(output).toContain("Second - Message 2");
      expect(output).toContain("Third - Message 3");
    });
  });
});
