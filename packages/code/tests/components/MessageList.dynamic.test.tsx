import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { MessageList } from "../../src/components/MessageList.js";
import { useTasks } from "../../src/hooks/useTasks.js";
import { ChatContextType, useChat } from "../../src/contexts/useChat.js";
import type { Message, ToolBlock } from "wave-agent-sdk";

import { Box, Text } from "ink";

// Mock useInput to prevent key handling during tests
vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useInput: vi.fn(),
    // We need Static to actually render its children for testing
    Static: ({
      items,
      children,
    }: {
      items: unknown[];
      children: (item: unknown, index: number) => React.ReactNode;
    }) => (
      <Box flexDirection="column">
        {items.map((item, index) => (
          <Box key={index}>{children(item, index)}</Box>
        ))}
      </Box>
    ),
  };
});

vi.mock("../../src/hooks/useTasks.js", () => ({
  useTasks: vi.fn(),
}));

vi.mock("../../src/contexts/useChat.js", () => ({
  useChat: vi.fn(),
}));

// Mock MessageItem to track if it's rendered
vi.mock("../../src/components/MessageItem.js", () => ({
  MessageItem: ({ message }: { message: Message }) => (
    <Box flexDirection="column">
      {message.blocks.map((b, i) => {
        const content =
          "content" in b ? (b as { content: string }).content : "";
        const name = "name" in b ? (b as { name: string }).name : "";
        return (
          <Box key={i}>
            <Text>{content || name}</Text>
          </Box>
        );
      })}
    </Box>
  ),
}));

describe("MessageList Dynamic Logic", () => {
  beforeEach(() => {
    vi.mocked(useTasks).mockReturnValue([]);
    vi.mocked(useChat).mockReturnValue({
      isTaskListVisible: true,
      isConfirmationVisible: false,
    } as unknown as ChatContextType);
  });

  const createToolMessage = (
    name: string,
    stage: "running" | "end",
  ): Message => ({
    role: "assistant",
    blocks: [
      {
        type: "tool",
        name,
        stage,
        parameters: "{}",
      } as ToolBlock,
    ],
  });

  it("should render last message statically if it has no tools", () => {
    const messages: Message[] = [
      { role: "user", blocks: [{ type: "text", content: "hello" }] },
    ];

    // In this test, we can't easily "see" if it's in Static vs Box without deeper inspection
    // but we can verify it renders.
    const { lastFrame } = render(<MessageList messages={messages} />);
    expect(lastFrame()).toContain("hello");
  });

  it("should render last message dynamically if it has a running tool", () => {
    const messages: Message[] = [createToolMessage("running_tool", "running")];

    const { lastFrame } = render(<MessageList messages={messages} />);
    expect(lastFrame()).toContain("running_tool");
  });

  it("should render last message statically if tool is in 'end' stage", () => {
    const messages: Message[] = [createToolMessage("finished_tool", "end")];

    const { lastFrame } = render(<MessageList messages={messages} />);
    expect(lastFrame()).toContain("finished_tool");
  });

  it("should split messages correctly when last is dynamic", () => {
    const messages: Message[] = [
      { role: "user", blocks: [{ type: "text", content: "first message" }] },
      createToolMessage("active_tool", "running"),
    ];

    const { lastFrame } = render(<MessageList messages={messages} />);
    expect(lastFrame()).toContain("first message");
    expect(lastFrame()).toContain("active_tool");
  });
});
