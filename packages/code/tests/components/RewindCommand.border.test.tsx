import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render } from "../helpers/inkHarness.js";
import { RewindCommand } from "../../src/components/RewindCommand.js";
import { stripAnsiColors } from "wave-agent-sdk";
import type { RewindCheckpoint } from "wave-agent-sdk";

const checkpoints: RewindCheckpoint[] = [
  { id: "u1", content: "Hello", index: 0 },
];

describe("RewindCommand Border", () => {
  it("should have top and bottom borders but no side borders", async () => {
    const { lastFrame } = render(
      <RewindCommand
        getCheckpoints={vi.fn().mockResolvedValue(checkpoints)}
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
      <RewindCommand
        getCheckpoints={vi.fn().mockResolvedValue([])}
        onSelect={vi.fn()}
        onCancel={vi.fn()}
      />,
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
