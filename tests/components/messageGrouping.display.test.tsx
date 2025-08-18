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

describe("MessageList with grouped display", () => {
  it("should display single messages without grouping", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there!"),
      createMessage("user", "How are you?"),
    ];

    const { lastFrame } = render(
      <MessageList messages={messages} isLoading={false} />,
    );
    const output = lastFrame();

    // Should show individual message headers
    expect(output).toContain("👤 You #1");
    expect(output).toContain("🤖 Assistant #2");
    expect(output).toContain("👤 You #3");
  });

  it("should group consecutive assistant messages", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there!"),
      createMessage("assistant", "How can I help you?"),
      createMessage("assistant", "I'm here to assist."),
      createMessage("user", "Thanks"),
    ];

    const { lastFrame } = render(
      <MessageList messages={messages} isLoading={false} />,
    );
    const output = lastFrame();

    // Should show grouped assistant messages
    expect(output).toContain("👤 You #1");
    expect(output).toContain("🤖 Assistant #2-4"); // Grouped range
    expect(output).toContain("👤 You #5");

    // Should show all message content
    expect(output).toContain("Hi there!");
    expect(output).toContain("How can I help you?");
    expect(output).toContain("I'm here to assist.");
  });

  it("should handle multiple separate assistant groups", () => {
    const messages = [
      createMessage("assistant", "First group start"),
      createMessage("assistant", "First group end"),
      createMessage("user", "User message"),
      createMessage("assistant", "Second group start"),
      createMessage("assistant", "Second group end"),
    ];

    const { lastFrame } = render(
      <MessageList messages={messages} isLoading={false} />,
    );
    const output = lastFrame();

    // Should show two separate groups
    expect(output).toContain("🤖 Assistant #1-2");
    expect(output).toContain("👤 You #3");
    expect(output).toContain("🤖 Assistant #4-5");
  });

  it("should show correct message count in pagination", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi"),
      createMessage("assistant", "How can I help?"),
    ];

    const { lastFrame } = render(
      <MessageList messages={messages} isLoading={false} />,
    );
    const output = lastFrame();

    // Should show correct total message count (not grouped count)
    expect(output).toContain("Messages 3 Page 1/1");
  });
});
