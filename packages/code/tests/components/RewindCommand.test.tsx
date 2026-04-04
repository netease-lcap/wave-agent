import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { RewindCommand } from "../../src/components/RewindCommand.js";
import { stripAnsiColors } from "wave-agent-sdk";
import type { Message } from "wave-agent-sdk";

describe("RewindCommand Content", () => {
  it("should display text content", async () => {
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
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("Hello world");
    });
  });

  it("should display slash command content", async () => {
    const mockMessages: Partial<Message>[] = [
      {
        id: "1",
        role: "user",
        blocks: [
          {
            type: "slash",
            command: "settings",
            args: "theme dark",
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
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("/settings theme dark");
    });
  });

  it("should display bang command content", async () => {
    const mockMessages: Partial<Message>[] = [
      {
        id: "1",
        role: "user",
        blocks: [
          {
            type: "bang",
            command: "ls -la",
            output: "",
            isRunning: false,
            exitCode: 0,
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
      const output = stripAnsiColors(lastFrame() || "");
      expect(output).toContain("!ls -la");
    });
  });
});
