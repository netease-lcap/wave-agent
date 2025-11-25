import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach } from "vitest";
import { MessageList } from "../../src/components/MessageList.js";
import type { Message } from "wave-agent-sdk";

const createMessage = (
  role: "user" | "assistant",
  content: string,
): Message => ({
  role,
  blocks: [{ type: "text", content }],
});

describe("MessageList Loading State", () => {
  beforeEach(() => {
    // Clear any potential state
  });

  it("should show loading message when AI is thinking", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there!"),
    ];

    const { lastFrame } = render(
      <MessageList
        messages={messages}
        isLoading={true}
        isCommandRunning={false}
        latestTotalTokens={1000}
        isExpanded={false}
      />,
    );
    const output = lastFrame();

    // Should show the loading message without tokens (tokens are now in Messages row)
    expect(output).toContain("💭 AI is thinking... Esc to abort");

    // Should show token count in the Messages row at the bottom
    expect(output).toContain("Messages 2 | 1,000 tokens");

    // Should still show the actual messages
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });

  it("should show command running message when command is running", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there!"),
    ];

    const { lastFrame } = render(
      <MessageList
        messages={messages}
        isLoading={false}
        isCommandRunning={true}
        latestTotalTokens={1000}
        isExpanded={false}
      />,
    );
    const output = lastFrame();

    // Should show the command running message
    expect(output).toContain("Command is running...");

    // Should show token count in the Messages row at the bottom
    expect(output).toContain("Messages 2 | 1,000 tokens");

    // Should still show the actual messages
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });

  it("should display messages normally when not loading", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there!"),
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

    // Should not show any loading message
    expect(output).not.toContain("💭 AI is thinking...");
    expect(output).not.toContain("Command is running...");

    // Should show token count in the Messages row at the bottom
    expect(output).toContain("Messages 2 | 1,000 tokens");

    // Should show the actual messages
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });

  it("should display welcome message only when no messages and not loading", () => {
    const { lastFrame } = render(
      <MessageList
        messages={[]}
        isLoading={false}
        isCommandRunning={false}
        latestTotalTokens={1000}
        isExpanded={false}
      />,
    );
    const output = lastFrame();

    expect(output).toContain("Welcome to WAVE Code Assistant!");
    expect(output).not.toContain("💭 AI is thinking...");
    expect(output).not.toContain("Command is running...");
    // No Messages row should be shown when there are no messages
    expect(output).not.toContain("Messages");
  });

  it("should show token count with zero tokens", () => {
    const messages = [createMessage("user", "Hello")];

    const { lastFrame } = render(
      <MessageList
        messages={messages}
        isLoading={false}
        isCommandRunning={false}
        latestTotalTokens={0}
        isExpanded={false}
      />,
    );
    const output = lastFrame();

    // Should show Messages count but not tokens when latestTotalTokens is 0
    expect(output).toContain("Messages 1");
    expect(output).not.toContain("tokens");
  });

  it("should handle both loading and command running states", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there!"),
    ];

    const { lastFrame } = render(
      <MessageList
        messages={messages}
        isLoading={true}
        isCommandRunning={true}
        latestTotalTokens={2500}
        isExpanded={false}
      />,
    );
    const output = lastFrame();

    // Should show both loading and command running messages
    expect(output).toContain("💭 AI is thinking... Esc to abort");
    expect(output).toContain("Command is running...");

    // Should show token count in the Messages row
    expect(output).toContain("Messages 2 | 2,500 tokens");

    // Should show the actual messages
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });
});
