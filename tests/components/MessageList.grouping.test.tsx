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

describe("MessageList Grouping and Display", () => {
  describe("Message Grouping Display", () => {
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

  describe("Message Indentation Alignment", () => {
    it("should align consecutive assistant messages content properly", () => {
      const messages = [
        createMessage("user", "Hello"),
        createMessage("assistant", "I'll help you with that."),
        createMessage("assistant", "Let me analyze the code."),
        createMessage("assistant", "Here are my findings."),
      ];

      const { lastFrame } = render(
        <MessageList messages={messages} isLoading={false} />,
      );
      const output = lastFrame();

      if (!output) {
        throw new Error("No output rendered");
      }

      // 分割输出为行以便分析缩进
      const lines = output.split("\n");

      // 找到三条连续的内容行
      const firstContentLine = lines.find((line) =>
        line.includes("I'll help you with that."),
      );
      const secondContentLine = lines.find((line) =>
        line.includes("Let me analyze the code."),
      );
      const thirdContentLine = lines.find((line) =>
        line.includes("Here are my findings."),
      );

      expect(firstContentLine).toBeDefined();
      expect(secondContentLine).toBeDefined();
      expect(thirdContentLine).toBeDefined();

      // 检查三行内容的缩进是否相同
      if (firstContentLine && secondContentLine && thirdContentLine) {
        // 计算每行开头空白字符的数量
        const firstIndent = firstContentLine.match(/^(\s*)/)?.[1].length || 0;
        const secondIndent = secondContentLine.match(/^(\s*)/)?.[1].length || 0;
        const thirdIndent = thirdContentLine.match(/^(\s*)/)?.[1].length || 0;

        // 所有内容行应该有相同的缩进
        expect(secondIndent).toBe(firstIndent);
        expect(thirdIndent).toBe(firstIndent);
      }
    });

    it("should maintain consistent indentation across different groups", () => {
      const messages = [
        createMessage("assistant", "First group message 1"),
        createMessage("assistant", "First group message 2"),
        createMessage("user", "User message"),
        createMessage("assistant", "Second group message 1"),
        createMessage("assistant", "Second group message 2"),
      ];

      const { lastFrame } = render(
        <MessageList messages={messages} isLoading={false} />,
      );
      const output = lastFrame();

      if (!output) {
        throw new Error("No output rendered");
      }

      const lines = output.split("\n");

      // 找到不同组的内容行
      const firstGroupFirstLine = lines.find((line) =>
        line.includes("First group message 1"),
      );
      const firstGroupSecondLine = lines.find((line) =>
        line.includes("First group message 2"),
      );
      const secondGroupFirstLine = lines.find((line) =>
        line.includes("Second group message 1"),
      );
      const secondGroupSecondLine = lines.find((line) =>
        line.includes("Second group message 2"),
      );

      if (
        firstGroupFirstLine &&
        firstGroupSecondLine &&
        secondGroupFirstLine &&
        secondGroupSecondLine
      ) {
        const indent1 = firstGroupFirstLine.match(/^(\s*)/)?.[1].length || 0;
        const indent2 = firstGroupSecondLine.match(/^(\s*)/)?.[1].length || 0;
        const indent3 = secondGroupFirstLine.match(/^(\s*)/)?.[1].length || 0;
        const indent4 = secondGroupSecondLine.match(/^(\s*)/)?.[1].length || 0;

        // 所有组的所有内容行都应该有相同的缩进
        expect(indent2).toBe(indent1);
        expect(indent3).toBe(indent1);
        expect(indent4).toBe(indent1);
      }
    });
  });
});
