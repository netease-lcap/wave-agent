import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageList } from "../../src/components/MessageList.js";
import { useTasks } from "../../src/hooks/useTasks.js";
import { ChatContextType, useChat } from "../../src/contexts/useChat.js";
import type { Message } from "wave-agent-sdk";
import { stripAnsiColors } from "wave-agent-sdk";

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

describe("MessageList static output width", () => {
  beforeEach(() => {
    vi.mocked(useTasks).mockReturnValue([]);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: true,
    } as unknown as ChatContextType);
  });

  const createMessagesWithWideTool = (): Message[] => {
    // compactParams longer than the test terminal width (100 columns) so the
    // tool header row would overflow the viewport without a width bound.
    const wideParams = "/very/long/path/".repeat(10); // ~150 chars
    // Enough messages to trigger the collapsed-mode fold (last 30 shown),
    // mirroring a long restored session where the <Static> burst is large.
    const messages: Message[] = Array.from({ length: 46 }, (_, i) => ({
      id: `msg-${i}`,
      role: i % 2 === 0 ? "user" : "assistant",
      blocks: [
        {
          type: "reasoning",
          content: `Inspect step ${i}: ` + "detailed reasoning ".repeat(8),
          stage: "end",
        },
        { type: "text", content: `Result ${i}` },
      ],
      timestamp: new Date().toISOString(),
    }));
    // Append a tool message with a wide compactParams row.
    messages.push({
      id: "msg-wide",
      role: "assistant",
      blocks: [
        {
          type: "tool",
          name: "Grep",
          stage: "end",
          success: true,
          compactParams: wideParams,
          shortResult: "Found 7 matching lines",
        },
        { type: "text", content: "Done checking." },
      ],
      timestamp: new Date().toISOString(),
    });
    return messages;
  };

  const lastNonBlankLine = (frame: string | undefined): number => {
    if (!frame) return -1;
    const lines = frame.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      if (lines[i].trim() !== "") return i;
    }
    return -1;
  };

  it("should not pad the static output with blank lines when content is wider than the terminal", () => {
    const messages = createMessagesWithWideTool();
    const { lastFrame } = render(
      <MessageList messages={messages} isExpanded={false} />,
    );

    const frame = lastFrame();
    expect(frame).toBeDefined();
    const lines = (frame ?? "").split("\n");
    const lastContent = lastNonBlankLine(frame);

    // Content must exist and must extend to the end of the frame. Before the
    // fix, an overflowing row widened the absolutely-positioned <Static> node
    // past the terminal width while its height kept the pre-resize value,
    // leaving dozens of blank rows after the last message.
    expect(lastContent).toBeGreaterThanOrEqual(0);
    expect(lines.length - 1 - lastContent).toBeLessThanOrEqual(2);
    expect(frame).toContain("Done checking.");
    expect(frame).toContain("Found 7 matching lines");
  });

  it("should wrap wide compactParams within the terminal width", () => {
    const messages = createMessagesWithWideTool();
    const { lastFrame } = render(
      <MessageList messages={messages} isExpanded={false} />,
    );

    // Every rendered line must fit the terminal width (100 columns) — no line
    // may exceed it, otherwise the overflow widens the static node.
    const frame = lastFrame();
    expect(frame).toBeDefined();
    const lines = (frame ?? "").split("\n");
    for (const line of lines) {
      const visible = stripAnsiColors(line);
      expect(visible.length).toBeLessThanOrEqual(100);
    }
  });
});
