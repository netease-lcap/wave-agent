import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { RewindCommand } from "../../src/components/RewindCommand.js";
import { stripAnsiColors } from "wave-agent-sdk";
import type { Message } from "wave-agent-sdk";

describe("RewindCommand Preview", () => {
  it("should show preview for TextBlock", async () => {
    const mockMessages: Partial<Message>[] = [
      {
        id: "1",
        role: "user",
        blocks: [{ type: "text", content: "Hello world" }],
      },
    ];

    const { lastFrame } = render(
      <RewindCommand
        messages={mockMessages as Message[]}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Hello world");
    });
  });

  it("should show preview for SlashBlock", async () => {
    const mockMessages: Partial<Message>[] = [
      {
        id: "1",
        role: "user",
        blocks: [
          {
            type: "slash",
            command: "test",
            args: "arg1 arg2",
            stage: "success",
          },
        ],
      },
    ];

    const { lastFrame } = render(
      <RewindCommand
        messages={mockMessages as Message[]}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("/test arg1 arg2");
    });
  });

  it("should show preview for both TextBlock and SlashBlock", async () => {
    const mockMessages: Partial<Message>[] = [
      {
        id: "1",
        role: "user",
        blocks: [
          { type: "text", content: "Pre-text" },
          {
            type: "slash",
            command: "test",
            args: "arg1",
            stage: "success",
          },
        ],
      },
    ];

    const { lastFrame } = render(
      <RewindCommand
        messages={mockMessages as Message[]}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      const frame = stripAnsiColors(lastFrame() || "");
      expect(frame).toContain("Pre-text /test arg1");
    });
  });
});
