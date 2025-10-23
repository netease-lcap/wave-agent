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

    // Should show the loading message with simplified format
    expect(output).toContain(
      "💭 AI is thinking...  | 1,000 tokens | Esc to abort",
    );

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
  });

  it("should not show loading UI when isExpanded is true", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there!"),
    ];

    const { lastFrame } = render(
      <MessageList
        messages={messages}
        isLoading={true}
        isCommandRunning={true}
        latestTotalTokens={1000}
        isExpanded={true} // Expanded state
      />,
    );
    const output = lastFrame();

    // In expanded state, should not show loading related UI
    expect(output).not.toContain("💭 AI is thinking...");
    expect(output).not.toContain("Command is running...");

    // But should show message content
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });
});
