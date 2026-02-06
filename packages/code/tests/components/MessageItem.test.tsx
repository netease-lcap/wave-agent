import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { Text } from "ink";
import { MessageItem } from "../../src/components/MessageItem.js";
import { MessageSource, type Message } from "wave-agent-sdk";

// Mock sub-components to isolate MessageItem
vi.mock("../../src/components/CommandOutputDisplay.js", () => ({
  CommandOutputDisplay: () => <Text>MOCKED_COMMAND_OUTPUT</Text>,
}));
vi.mock("../../src/components/ToolResultDisplay.js", () => ({
  ToolResultDisplay: () => <Text>MOCKED_TOOL_RESULT</Text>,
}));
vi.mock("../../src/components/MemoryDisplay.js", () => ({
  MemoryDisplay: () => <Text>MOCKED_MEMORY</Text>,
}));
vi.mock("../../src/components/CompressDisplay.js", () => ({
  CompressDisplay: () => <Text>MOCKED_COMPRESS</Text>,
}));
vi.mock("../../src/components/SubagentBlock.js", () => ({
  SubagentBlock: () => <Text>MOCKED_SUBAGENT</Text>,
}));
vi.mock("../../src/components/ReasoningDisplay.js", () => ({
  ReasoningDisplay: () => <Text>MOCKED_REASONING</Text>,
}));
vi.mock("../../src/components/Markdown.js", () => ({
  Markdown: ({ children }: { children: string }) => <Text>{children}</Text>,
}));

describe("MessageItem Component", () => {
  it("should return null for empty blocks", () => {
    const message: Message = {
      role: "user",
      blocks: [],
    };
    const { lastFrame } = render(
      <MessageItem
        message={message}
        isExpanded={false}
        shouldShowHeader={true}
      />,
    );
    expect(lastFrame()).toBe("");
  });

  describe("Headers and Roles", () => {
    it("should show '👤 You' for user role when shouldShowHeader is true", () => {
      const message: Message = {
        role: "user",
        blocks: [{ type: "text", content: "hello" }],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={true}
        />,
      );
      expect(lastFrame()).toContain("👤 You");
    });

    it("should show '🤖 Assistant' for assistant role when shouldShowHeader is true", () => {
      const message: Message = {
        role: "assistant",
        blocks: [{ type: "text", content: "hello" }],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={true}
        />,
      );
      expect(lastFrame()).toContain("🤖 Assistant");
    });

    it("should not show header when shouldShowHeader is false", () => {
      const message: Message = {
        role: "user",
        blocks: [{ type: "text", content: "hello" }],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).not.toContain("👤 You");
    });
  });

  describe("Block Types", () => {
    it("should render text block", () => {
      const message: Message = {
        role: "user",
        blocks: [{ type: "text", content: "plain text" }],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).toContain("plain text");
    });

    it("should render text block with customCommandContent (⚡)", () => {
      const message: Message = {
        role: "user",
        blocks: [
          {
            type: "text",
            content: "command text",
            customCommandContent: "some command",
          },
        ],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).toContain("⚡");
      expect(lastFrame()).toContain("command text");
    });

    it("should render text block with HOOK source (🔗)", () => {
      const message: Message = {
        role: "user",
        blocks: [
          {
            type: "text",
            content: "hook text",
            source: MessageSource.HOOK,
          },
        ],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).toContain("🔗");
      expect(lastFrame()).toContain("hook text");
    });

    it("should render error block", () => {
      const message: Message = {
        role: "assistant",
        blocks: [{ type: "error", content: "something failed" }],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).toContain("❌ Error: something failed");
    });

    it("should render command_output block", () => {
      const message: Message = {
        role: "assistant",
        blocks: [
          {
            type: "command_output",
            output: "output",
            command: "ls",
            isRunning: false,
            exitCode: 0,
          },
        ],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).toContain("MOCKED_COMMAND_OUTPUT");
    });

    it("should render tool block", () => {
      const message: Message = {
        role: "assistant",
        blocks: [
          {
            type: "tool",
            id: "1",
            name: "test",
            parameters: "{}",
            result: "ok",
            stage: "end",
          },
        ],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).toContain("MOCKED_TOOL_RESULT");
    });

    it("should render image block without imageUrls", () => {
      const message: Message = {
        role: "user",
        blocks: [{ type: "image" }],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).toContain("📷 Image");
      expect(lastFrame()).not.toContain("(");
    });

    it("should render image block with imageUrls", () => {
      const message: Message = {
        role: "user",
        blocks: [{ type: "image", imageUrls: ["url1", "url2"] }],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).toContain("📷 Image");
      expect(lastFrame()).toContain("(2)");
    });

    it("should render memory block", () => {
      const message: Message = {
        role: "assistant",
        blocks: [{ type: "memory", content: "mem", isSuccess: true }],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).toContain("MOCKED_MEMORY");
    });

    it("should render compress block", () => {
      const message: Message = {
        role: "assistant",
        blocks: [{ type: "compress", content: "compressed", sessionId: "s1" }],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).toContain("MOCKED_COMPRESS");
    });

    it("should render subagent block", () => {
      const message: Message = {
        role: "assistant",
        blocks: [
          {
            type: "subagent",
            subagentId: "sub1",
            subagentName: "Sub",
            status: "completed",
            sessionId: "s1",
            configuration: {
              name: "Sub",
              description: "desc",
              systemPrompt: "hi",
              filePath: "path",
              scope: "builtin",
              priority: 0,
            },
          },
        ],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).toContain("MOCKED_SUBAGENT");
    });

    it("should render reasoning block", () => {
      const message: Message = {
        role: "assistant",
        blocks: [{ type: "reasoning", content: "thinking" }],
      };
      const { lastFrame } = render(
        <MessageItem
          message={message}
          isExpanded={false}
          shouldShowHeader={false}
        />,
      );
      expect(lastFrame()).toContain("MOCKED_REASONING");
    });
  });
});
