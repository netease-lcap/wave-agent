import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { Text } from "ink";
import { MessageBlockItem } from "../../src/components/MessageBlockItem.js";
import { MessageSource, type Message, type MessageBlock } from "wave-agent-sdk";

// Mock sub-components to isolate MessageBlockItem
vi.mock("../../src/components/CommandOutputDisplay.js", () => ({
  CommandOutputDisplay: () => <Text>MOCKED_COMMAND_OUTPUT</Text>,
}));
vi.mock("../../src/components/ToolDisplay.js", () => ({
  ToolDisplay: () => <Text>MOCKED_TOOL_RESULT</Text>,
}));
vi.mock("../../src/components/CompressDisplay.js", () => ({
  CompressDisplay: () => <Text>MOCKED_COMPRESS</Text>,
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
      const message: Message = { role: "user", blocks: [] };
      const block: MessageBlock = { type: "text", content: "plain text" };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("plain text");
    });

    it("should render text block with customCommandContent (⚡)", () => {
      const message: Message = { role: "user", blocks: [] };
      const block: MessageBlock = {
        type: "text",
        content: "command text",
        customCommandContent: "some command",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("$");
      expect(lastFrame()).toContain("command text");
    });

    it("should render text block with HOOK source (🔗)", () => {
      const message: Message = { role: "user", blocks: [] };
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
      const message: Message = { role: "assistant", blocks: [] };
      const block: MessageBlock = {
        type: "error",
        content: "something failed",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("Error: something failed");
    });

    it("should render command_output block", () => {
      const message: Message = { role: "assistant", blocks: [] };
      const block: MessageBlock = {
        type: "command_output",
        output: "output",
        command: "ls",
        isRunning: false,
        exitCode: 0,
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("MOCKED_COMMAND_OUTPUT");
    });

    it("should render tool block", () => {
      const message: Message = { role: "assistant", blocks: [] };
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
      const message: Message = { role: "user", blocks: [] };
      const block: MessageBlock = { type: "image" };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("# Image");
      expect(lastFrame()).not.toContain("(");
    });

    it("should render image block with imageUrls", () => {
      const message: Message = { role: "user", blocks: [] };
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

    it("should render compress block", () => {
      const message: Message = { role: "assistant", blocks: [] };
      const block: MessageBlock = {
        type: "compress",
        content: "compressed",
        sessionId: "s1",
      };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("MOCKED_COMPRESS");
    });

    it("should render reasoning block", () => {
      const message: Message = { role: "assistant", blocks: [] };
      const block: MessageBlock = { type: "reasoning", content: "thinking" };
      const { lastFrame } = render(
        <MessageBlockItem block={block} message={message} isExpanded={false} />,
      );
      expect(lastFrame()).toContain("MOCKED_REASONING");
    });
  });
});
