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

describe("MessageList SessionId Functionality", () => {
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

  describe("Component rendering with sessionId prop", () => {
    it("should render correctly with sessionId prop", () => {
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
          sessionId="abc123def456ghi789"
        />,
      );

      const output = lastFrame();

      // Should render messages normally
      expect(output).toContain("👤 You");
      expect(output).toContain("🤖 Assistant");
      expect(output).toContain("Hello - Message 1");
      expect(output).toContain("Hi there - Message 2");

      // Should show message count
      expect(output).toContain("Messages 2");

      // Should render sessionId in the footer
      expect(output).toContain("Session:");
      expect(output).toContain("abc123de...");
    });

    it("should render correctly without sessionId prop", () => {
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

      const output = lastFrame();

      // Should render messages normally
      expect(output).toContain("👤 You");
      expect(output).toContain("🤖 Assistant");
      expect(output).toContain("Hello - Message 1");
      expect(output).toContain("Hi there - Message 2");

      // Should show message count
      expect(output).toContain("Messages 2");

      // Should not render sessionId in the footer
      expect(output).not.toContain("Session:");
      expect(output).not.toContain("...");
    });
  });

  describe("Session ID display functionality", () => {
    it("should display session ID in Messages count section when provided", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <MessageList messages={messages} sessionId="test-session-123456789" />,
      );

      const output = lastFrame();

      // Should contain the Messages count section
      expect(output).toContain("Messages 1");

      // Should contain session ID display
      expect(output).toContain("Session:");
      expect(output).toContain("test-ses...");

      // Should contain the pipe separator
      expect(output).toContain(" | ");
    });

    it("should truncate session ID to 8 characters with '...' suffix", () => {
      const messages = [createMessage("user", "Test message", 1)];

      // Test with various session ID lengths
      const testCases = [
        { sessionId: "short", expected: "short..." },
        { sessionId: "exactly8", expected: "exactly8..." },
        { sessionId: "verylongsessionid123456789", expected: "verylong..." },
        { sessionId: "12345678901234567890", expected: "12345678..." },
        { sessionId: "abc-def-ghi-jkl-mno", expected: "abc-def-..." },
      ];

      testCases.forEach(({ sessionId, expected }) => {
        const { lastFrame } = render(
          <MessageList messages={messages} sessionId={sessionId} />,
        );

        const output = lastFrame();
        expect(output).toContain(expected);
      });
    });

    it("should not display session ID section when sessionId is undefined", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <MessageList messages={messages} sessionId={undefined} />,
      );

      const output = lastFrame();

      // Should contain the Messages count
      expect(output).toContain("Messages 1");

      // Should not contain session ID display
      expect(output).not.toContain("Session:");
      expect(output).not.toContain("...");
    });

    it("should not display session ID section when sessionId is empty string", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <MessageList messages={messages} sessionId="" />,
      );

      const output = lastFrame();

      // Should contain the Messages count
      expect(output).toContain("Messages 1");

      // Should not contain session ID display
      expect(output).not.toContain("Session:");
    });
  });

  describe("Session ID coloring and formatting", () => {
    it("should include proper coloring and formatting for session ID display", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <MessageList messages={messages} sessionId="colortest123456" />,
      );

      const output = lastFrame();

      // Should contain the session ID with proper truncation
      expect(output).toContain("colortes...");

      // Should contain the "Session:" label
      expect(output).toContain("Session:");

      // Should contain pipe separator for formatting
      expect(output).toContain(" | ");
    });

    it("should maintain consistent formatting with other UI elements", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          sessionId="formatting-test-123"
          isExpanded={false}
        />,
      );

      const output = lastFrame();

      // Should contain session ID
      expect(output).toContain("formatti...");

      // Should contain toggle hint
      expect(output).toContain("Ctrl+O");
      expect(output).toContain("Toggle Expand");

      // Should contain Messages count
      expect(output).toContain("Messages 1");
    });

    it("should display correctly when component is in expanded state", () => {
      const messages = [createMessage("user", "Test message", 1)];

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          sessionId="expanded-test-456"
          isExpanded={true}
        />,
      );

      const output = lastFrame();

      // Should contain session ID
      expect(output).toContain("expanded...");

      // Should contain collapse toggle hint
      expect(output).toContain("Ctrl+O");
      expect(output).toContain("Toggle Collapse");
    });
  });

  describe("Component behavior with various states", () => {
    it("should work correctly when sessionId is provided and component is loading", () => {
      const messages = [createMessage("user", "Loading test", 1)];

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          sessionId="loading-session-123"
          isLoading={true}
          latestTotalTokens={2500}
        />,
      );

      const output = lastFrame();

      // Should show loading state
      expect(output).toContain("💭 AI is thinking...");
      expect(output).toContain("2,500 tokens");

      // Should still show session ID
      expect(output).toContain("loading-...");
      expect(output).toContain("Session:");
    });

    it("should work correctly when sessionId is provided and command is running", () => {
      const messages = [createMessage("user", "Command test", 1)];

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          sessionId="command-session-789"
          isCommandRunning={true}
        />,
      );

      const output = lastFrame();

      // Should show command running state
      expect(output).toContain("🚀 Command is running...");

      // Should still show session ID
      expect(output).toContain("command-...");
      expect(output).toContain("Session:");
    });

    it("should work correctly when sessionId is provided and compressing", () => {
      const messages = [createMessage("user", "Compress test", 1)];

      const { lastFrame } = render(
        <MessageList
          messages={messages}
          sessionId="compress-session-456"
          isCompressing={true}
        />,
      );

      const output = lastFrame();

      // Should show compressing state
      expect(output).toContain("🗜️ Compressing message history...");

      // Should still show session ID
      expect(output).toContain("compress...");
      expect(output).toContain("Session:");
    });

    it("should not show session ID in empty message state", () => {
      const { lastFrame } = render(
        <MessageList messages={[]} sessionId="empty-session-123" />,
      );

      const output = lastFrame();

      // Should show welcome message
      expect(output).toContain("Welcome to WAVE Code Assistant!");

      // Should not show session ID (since no messages section is rendered)
      expect(output).not.toContain("Session:");
      expect(output).not.toContain("empty-se...");
    });
  });

  describe("Multiple messages with session ID", () => {
    it("should display correct message count with session ID", () => {
      const messages = [
        createMessage("user", "First", 1),
        createMessage("assistant", "Second", 2),
        createMessage("user", "Third", 3),
      ];

      const { lastFrame } = render(
        <MessageList messages={messages} sessionId="multi-message-session" />,
      );

      const output = lastFrame();

      // Should show correct message count
      expect(output).toContain("Messages 3");

      // Should show session ID
      expect(output).toContain("multi-me...");
      expect(output).toContain("Session:");

      // Should show all messages
      expect(output).toContain("First - Message 1");
      expect(output).toContain("Second - Message 2");
      expect(output).toContain("Third - Message 3");
    });
  });
});
