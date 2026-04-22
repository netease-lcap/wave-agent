import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { Text } from "ink";
import { MessageBlockItem } from "../../src/components/MessageBlockItem.js";
import { MessageSource, type Message, type MessageBlock } from "wave-agent-sdk";

// Mock sub-components to isolate MessageBlockItem
vi.mock("../../src/components/BangDisplay.js", () => ({
  BangDisplay: () => <Text>MOCKED_BANG</Text>,
}));
vi.mock("../../src/components/ToolDisplay.js", () => ({
  ToolDisplay: () => <Text>MOCKED_TOOL_RESULT</Text>,
}));
vi.mock("../../src/components/CompactDisplay.js", () => ({
  CompactDisplay: () => <Text>MOCKED_COMPRESS</Text>,
}));
vi.mock("../../src/components/ReasoningDisplay.js", () => ({
  ReasoningDisplay: () => <Text>MOCKED_REASONING</Text>,
}));
vi.mock("../../src/components/Markdown.js", () => ({
  Markdown: ({ children }: { children: string }) => <Text>{children}</Text>,
}));

describe("MessageBlockItem Component", () => {
  describe("Block Types", () => {
    it("should render text block", () => {
      const message: Message = { id: "test-id", role: "user", blocks: [] };
      const block: MessageBlock = { type: "text", content: "plain text" };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("plain text");
    });

    it("should render text block with HOOK source (🔗)", () => {
      const message: Message = { id: "test-id", role: "user", blocks: [] };
      const block: MessageBlock = {
        type: "text",
        content: "hook text",
        source: MessageSource.HOOK,
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("~");
      expect(lastFrame()).toContain("hook text");
    });

    it("should render error block", () => {
      const message: Message = { id: "test-id", role: "assistant", blocks: [] };
      const block: MessageBlock = {
        type: "error",
        content: "something failed",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("Error: something failed");
    });

    it("should render bang block", () => {
      const message: Message = { id: "test-id", role: "assistant", blocks: [] };
      const block: MessageBlock = {
        type: "bang",
        output: "output",
        command: "ls",
        stage: "end",
        exitCode: 0,
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("MOCKED_BANG");
    });

    it("should render tool block", () => {
      const message: Message = { id: "test-id", role: "assistant", blocks: [] };
      const block: MessageBlock = {
        type: "tool",
        id: "1",
        name: "test",
        parameters: "{}",
        result: "ok",
        stage: "end",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("MOCKED_TOOL_RESULT");
    });

    it("should render image block without imageUrls", () => {
      const message: Message = { id: "test-id", role: "user", blocks: [] };
      const block: MessageBlock = { type: "image" };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("# Image");
      expect(lastFrame()).not.toContain("(");
    });

    it("should render image block with imageUrls", () => {
      const message: Message = { id: "test-id", role: "user", blocks: [] };
      const block: MessageBlock = {
        type: "image",
        imageUrls: ["url1", "url2"],
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("# Image");
      expect(lastFrame()).toContain("(2)");
    });

    it("should render compact block", () => {
      const message: Message = { id: "test-id", role: "assistant", blocks: [] };
      const block: MessageBlock = {
        type: "compact",
        content: "compacted",
        sessionId: "s1",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("MOCKED_COMPRESS");
    });

    it("should render reasoning block", () => {
      const message: Message = { id: "test-id", role: "assistant", blocks: [] };
      const block: MessageBlock = { type: "reasoning", content: "thinking" };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("MOCKED_REASONING");
    });
  });

  describe("Text Block Streaming", () => {
    const createAssistantMessage = (): Message => ({
      id: "test-id",
      role: "assistant",
      blocks: [],
    });

    it("should show last 30 chars with ellipsis when streaming and content is long", () => {
      const message: Message = createAssistantMessage();
      const block: MessageBlock = {
        type: "text",
        content:
          "This is a very long streaming message that should be truncated",
        stage: "streaming",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      const frame = lastFrame();
      expect(frame).toContain("…");
      expect(frame).toContain("that should be truncated");
    });

    it("should show full content when streaming and content is short", () => {
      const message: Message = createAssistantMessage();
      const block: MessageBlock = {
        type: "text",
        content: "short",
        stage: "streaming",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("short");
    });

    it("should flatten newlines when streaming", () => {
      const message: Message = createAssistantMessage();
      const block: MessageBlock = {
        type: "text",
        content: "line1\nline2\nline3\nthis is the end of the stream",
        stage: "streaming",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      const frame = lastFrame();
      // Newlines should be replaced with literal \n in the displayed text
      expect(frame).toContain("end of the stream");
      expect(frame).toContain("…");
    });

    it("should use Markdown when stage is not streaming", () => {
      const message: Message = createAssistantMessage();
      const block: MessageBlock = {
        type: "text",
        content: "**bold** text",
        stage: "end",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("**bold** text");
    });

    it("should use Markdown when stage is undefined", () => {
      const message: Message = createAssistantMessage();
      const block: MessageBlock = {
        type: "text",
        content: "**bold** text",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("**bold** text");
    });

    it("should show full content when user message is streaming", () => {
      const message: Message = { id: "test-id", role: "user", blocks: [] };
      const block: MessageBlock = {
        type: "text",
        content: "user streaming content that is very long",
        stage: "streaming",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("user streaming content that is very long");
    });

    it("should show full content when expanded and streaming", () => {
      const message: Message = createAssistantMessage();
      const block: MessageBlock = {
        type: "text",
        content: "expanded streaming content that is very long",
        stage: "streaming",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={true} />,
      );
      expect(lastFrame()).toContain(
        "expanded streaming content that is very long",
      );
    });
  });
});
