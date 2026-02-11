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
  });

  describe("Component rendering", () => {
    it("should render correctly with basic props", () => {
      const messages = [
        createMessage("user", "Hello", 1),
        createMessage("assistant", "Hi there", 2),
      ];

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList
              messages={messages}
              isLoading={false}
              isCommandRunning={false}
              latestTotalTokens={1000}
              isExpanded={false}
            />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should render messages normally
      expect(output).toContain("👤 You");
      expect(output).toContain("🤖 Assistant");
      expect(output).toContain("Hello - Message 1");
      expect(output).toContain("Hi there - Message 2");

      // Should show message count
      expect(output).toContain("Messages 2");
    });

    it("should render correctly without optional props", () => {
      const messages = [
        createMessage("user", "Hello", 1),
        createMessage("assistant", "Hi there", 2),
      ];

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should render messages normally
      expect(output).toContain("👤 You");
      expect(output).toContain("🤖 Assistant");
      expect(output).toContain("Hello - Message 1");
      expect(output).toContain("Hi there - Message 2");

      // Should show message count
      expect(output).toContain("Messages 2");
    });
  });

  describe("Message count and token display", () => {
    it("should display message count in footer section", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should contain the Messages count section
      expect(output).toContain("Messages 1");
    });

    it("should display token count when provided", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} latestTotalTokens={2500} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should contain the Messages count section
      expect(output).toContain("Messages 1");

      // Should show token count
      expect(output).toContain("2,500 tokens");

      // Should contain the pipe separator
      expect(output).toContain(" | ");
    });

    it("should not display token count when not provided or zero", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} latestTotalTokens={0} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should contain the Messages count
      expect(output).toContain("Messages 1");

      // Should not contain token display
      expect(output).not.toContain("tokens");
    });
  });

  describe("Component states and UI elements", () => {
    it("should maintain consistent formatting with toggle controls", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} isExpanded={false} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should contain toggle hint
      expect(output).toContain("Ctrl+O");
      expect(output).toContain("Toggle Expand");

      // Should contain Messages count
      expect(output).toContain("Messages 1");
    });

    it("should display correctly when component is in expanded state", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} isExpanded={true} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should contain collapse toggle hint
      expect(output).toContain("Ctrl+O");
      expect(output).toContain("Toggle Collapse");
    });
  });

  describe("Component behavior with various states", () => {
    it("should work correctly when component is loading", () => {
      const messages = [createMessage("user", "Loading test", 1)];

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList
              messages={messages}
              isLoading={true}
              latestTotalTokens={2500}
            />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should show loading state
      expect(output).toContain("💭 AI is thinking...");
      expect(output).toContain("2,500 tokens");
    });

    it("should work correctly when command is running", () => {
      const messages = [createMessage("user", "Command test", 1)];

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} isCommandRunning={true} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should show command running state
      expect(output).toContain("🚀 Command is running...");
    });

    it("should work correctly when compressing", () => {
      const messages = [createMessage("user", "Compress test", 1)];

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} isCompressing={true} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should show compressing state
      expect(output).toContain("🗜️ Compressing message history...");
    });

    it("should show welcome message in empty state", () => {
      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={[]} />
          </ChatProvider>
        </AppProvider>,
      );

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

      const { lastFrame } = render(
        <AppProvider>
          <ChatProvider>
            <MessageList messages={messages} />
          </ChatProvider>
        </AppProvider>,
      );

      const output = lastFrame();

      // Should show correct message count
      expect(output).toContain("Messages 3");

      // Should show all messages
      expect(output).toContain("First - Message 1");
      expect(output).toContain("Second - Message 2");
      expect(output).toContain("Third - Message 3");
    });
  });
});
