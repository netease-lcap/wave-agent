import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { RewindCommand } from "../../src/components/RewindCommand.js";
import { stripAnsiColors } from "wave-agent-sdk";
import type { Message } from "wave-agent-sdk";

describe("RewindCommand Border", () => {
  const mockMessages: Partial<Message>[] = [
    { role: "user", blocks: [{ type: "text", content: "Hello" }] },
  ];

  it("should have top and bottom borders but no side borders", async () => {
    const { lastFrame } = render(
      <RewindCommand
        messages={mockMessages as Message[]}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Rewind:");
    });

    const frame = lastFrame();
    if (!frame) throw new Error("Frame is undefined");
    const cleanFrame = stripAnsiColors(frame);
    const lines = cleanFrame.split("\n");

    // Check for top border (should contain horizontal line characters but no corners)
    // Actually, Ink with borderLeft/Right={false} still uses corners if borderStyle is "single"
    // but they are at the start/end of the line.
    // Let's check that the lines do NOT have vertical bars in the middle or at the edges.

    for (const line of lines) {
      expect(line).not.toContain("│");
    }

    // The first line should have horizontal bars
    expect(lines[0]).toContain("─");
    // The last line should have horizontal bars
    expect(lines[lines.length - 1]).toContain("─");
  });

  it("should not have side borders when no checkpoints", async () => {
    const { lastFrame } = render(
      <RewindCommand messages={[]} onSelect={vi.fn()} onCancel={vi.fn()} />,
    );

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("No user messages");
    });

    const frame = lastFrame();
    if (!frame) throw new Error("Frame is undefined");
    const cleanFrame = stripAnsiColors(frame);
    const lines = cleanFrame.split("\n");

    for (const line of lines) {
      expect(line).not.toContain("│");
    }
    expect(lines[0]).toContain("─");
    expect(lines[lines.length - 1]).toContain("─");
  });
});
