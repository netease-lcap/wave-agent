import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MessageList } from "@/components/MessageList";
import type { Message } from "@/types";

// Mock useChat hook with factory function
vi.mock("@/contexts/useChat", () => ({
  useChat: vi.fn(() => ({
    isLoading: false,
    isCommandRunning: false,
    totalTokens: 1000,
  })),
}));

// Mock useLoadingTimer hook
vi.mock("@/hooks/useLoadingTimer", () => ({
  useLoadingTimer: vi.fn(() => ({
    formattedTime: "5s",
  })),
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
    vi.clearAllMocks();
  });

  it("should show loading message when AI is thinking", async () => {
    const { useChat } = await import("@/contexts/useChat");
    (useChat as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: true,
      isCommandRunning: false,
      totalTokens: 1000,
    });

    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there!"),
    ];

    const { lastFrame } = render(<MessageList messages={messages} />);
    const output = lastFrame();

    // Should show the loading message with simplified format
    expect(output).toContain(
      "💭 AI is thinking... 5s | 1,000 tokens | Esc to abort",
    );

    // Should still show the actual messages
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });

  it("should show command running message when command is running", async () => {
    const { useChat } = await import("@/contexts/useChat");
    (useChat as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isCommandRunning: true,
      totalTokens: 1000,
    });

    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there!"),
    ];

    const { lastFrame } = render(<MessageList messages={messages} />);
    const output = lastFrame();

    // Should show the command running message
    expect(output).toContain("Command is running...");

    // Should still show the actual messages
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });

  it("should display messages normally when not loading", async () => {
    const { useChat } = await import("@/contexts/useChat");
    (useChat as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isCommandRunning: false,
      totalTokens: 1000,
    });

    const messages = [
      createMessage("user", "Hello"),
      createMessage("assistant", "Hi there!"),
    ];

    const { lastFrame } = render(<MessageList messages={messages} />);
    const output = lastFrame();

    // Should not show any loading message
    expect(output).not.toContain("💭 AI is thinking...");
    expect(output).not.toContain("Command is running...");

    // Should show the actual messages
    expect(output).toContain("Hello");
    expect(output).toContain("Hi there!");
  });

  it("should display welcome message only when no messages and not loading", async () => {
    const { useChat } = await import("@/contexts/useChat");
    (useChat as ReturnType<typeof vi.fn>).mockReturnValue({
      isLoading: false,
      isCommandRunning: false,
      totalTokens: 1000,
    });

    const { lastFrame } = render(<MessageList messages={[]} />);
    const output = lastFrame();

    expect(output).toContain("Welcome to LCAP Code Assistant!");
    expect(output).not.toContain("💭 AI is thinking...");
    expect(output).not.toContain("Command is running...");
  });
});
