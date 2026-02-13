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

  it("should display messages normally", () => {
    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there!"),
    ];

    const { lastFrame } = render(
      <MessageList messages={messages} isExpanded={false} />,
    );
    const output = lastFrame();

    // Should show the actual messages
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });

  it("should display welcome message only when no messages", () => {
    const { lastFrame } = render(
      <MessageList messages={[]} isExpanded={false} />,
    );
    const output = lastFrame();

    expect(output).toContain("Welcome to WAVE Code Assistant!");
    // No Messages row should be shown when there are no messages
    expect(output).not.toContain("Messages");
  });

  it("should not show token count", () => {
    const messages = [createMessage("user", "Hello")];

    const { lastFrame } = render(
      <MessageList messages={messages} isExpanded={false} />,
    );
    const output = lastFrame();

    // Should not show Messages count or tokens
    expect(output).not.toContain("Messages");
    expect(output).not.toContain("tokens");
  });
});
