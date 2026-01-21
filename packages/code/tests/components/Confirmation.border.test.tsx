import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "ink-testing-library";
import { Confirmation } from "../../src/components/Confirmation.js";
import { waitForText } from "../helpers/waitHelpers.js";

import { stripAnsiColors } from "wave-agent-sdk";

describe("Confirmation Border", () => {
  let mockOnDecision: ReturnType<typeof vi.fn>;
  let mockOnCancel: ReturnType<typeof vi.fn>;
  let mockOnAbort: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockOnDecision = vi.fn();
    mockOnCancel = vi.fn();
    mockOnAbort = vi.fn();
    vi.clearAllMocks();
  });

  it("should only have top border", async () => {
    const { lastFrame } = render(
      <Confirmation
        toolName="Edit"
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    await waitForText(lastFrame, "Tool: Edit");

    const frame = lastFrame();
    if (!frame) throw new Error("Frame is undefined");
    const cleanFrame = stripAnsiColors(frame);
    const lines = cleanFrame.split("\n");

    // The first line should contain the top border
    expect(lines[0]).toMatch(/[┌─┐]/);

    // Subsequent lines should NOT contain vertical borders │
    for (let i = 1; i < lines.length - 1; i++) {
      expect(lines[i]).not.toContain("│");
    }

    // The last line should NOT contain bottom border characters └ ─ ┘
    const lastLine = lines[lines.length - 1];
    expect(lastLine).not.toMatch(/[└┘]/);
  });
});
