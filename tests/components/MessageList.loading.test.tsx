import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { MessageList } from "@/components/MessageList";
import type { Message } from "@/types";

const createMessage = (
  role: "user" | "assistant",
  content: string,
): Message => ({
  role,
  blocks: [{ type: "text", content }],
});

describe("MessageList Loading State", () => {
  it("should not display AI thinking message when loading", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there!"),
    ];

    const { lastFrame } = render(
      <MessageList messages={messages} isLoading={true} />,
    );
    const output = lastFrame();

    // Should not show the loading message in MessageList
    expect(output).not.toContain("AI is thinking...");

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
      <MessageList messages={messages} isLoading={false} />,
    );
    const output = lastFrame();

    // Should not show any loading message
    expect(output).not.toContain("AI is thinking...");

    // Should show the actual messages
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });

  it("should display welcome message when no messages and not loading", () => {
    const { lastFrame } = render(
      <MessageList messages={[]} isLoading={false} />,
    );
    const output = lastFrame();

    expect(output).toContain("Welcome to LCAP Code Assistant!");
    expect(output).not.toContain("AI is thinking...");
  });

  it("should display welcome message when no messages and loading", () => {
    const { lastFrame } = render(
      <MessageList messages={[]} isLoading={true} />,
    );
    const output = lastFrame();

    // Should still show welcome message, not loading message
    expect(output).toContain("Welcome to LCAP Code Assistant!");
    expect(output).not.toContain("AI is thinking...");
  });
});
