import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageList } from "../../src/components/MessageList.js";
import { useTasks } from "../../src/hooks/useTasks.js";
import { ChatContextType, useChat } from "../../src/contexts/useChat.js";
import type { Message } from "wave-agent-sdk";

vi.mock("../../src/hooks/useTasks.js", () => ({
  useTasks: vi.fn(),
}));

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

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
    vi.mocked(useTasks).mockReturnValue([]);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: true,
    } as unknown as ChatContextType);
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
        isExpanded={false}
      />,
    );
    const output = lastFrame();

    // Should show the loading message
    expect(output).toContain("💭 AI is thinking... | Esc to abort");

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
        isExpanded={false}
      />,
    );
    const output = lastFrame();

    // Should show Messages count
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
        isExpanded={false}
      />,
    );
    const output = lastFrame();

    // Should show both loading and command running messages
    expect(output).toContain("💭 AI is thinking... | Esc to abort");
    expect(output).toContain("Command is running...");

    // Should show the actual messages
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });
});
