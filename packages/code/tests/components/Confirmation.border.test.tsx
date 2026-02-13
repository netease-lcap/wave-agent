import React from "react";
import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render } from "ink-testing-library";
import { Confirmation } from "../../src/components/Confirmation.js";

import { stripAnsiColors, type PermissionDecision } from "wave-agent-sdk";

describe("Confirmation Border", () => {
  let mockOnDecision: Mock<(decision: PermissionDecision) => void>;
  let mockOnCancel: Mock<() => void>;
  let mockOnAbort: Mock<() => void>;

  beforeEach(() => {
    mockOnDecision = vi.fn<(decision: PermissionDecision) => void>();
    mockOnCancel = vi.fn<() => void>();
    mockOnAbort = vi.fn<() => void>();
    vi.clearAllMocks();
  });

  it("should not have any borders", async () => {
    const { lastFrame } = render(
      <Confirmation
        toolName="Edit"
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Tool: Edit");
    });

    const frame = lastFrame();
    if (!frame) throw new Error("Frame is undefined");
    const cleanFrame = stripAnsiColors(frame);

    // Should NOT contain any border characters
    expect(cleanFrame).not.toMatch(/[┌─┐└┘│╭╮╰╯]/);
  });

  it("should not have border or horizontal padding for plan content and render as markdown", async () => {
    const { lastFrame } = render(
      <Confirmation
        toolName="ExitPlanMode"
        toolInput={{ plan_content: "**Test** Plan Content" }}
        onDecision={mockOnDecision}
        onCancel={mockOnCancel}
        onAbort={mockOnAbort}
      />,
    );

    await vi.waitFor(() => {
      expect(stripAnsiColors(lastFrame() || "")).toContain("Test Plan Content");
    });

    const frame = lastFrame();
    if (!frame) throw new Error("Frame is undefined");
    const cleanFrame = stripAnsiColors(frame);

    // Check for absence of borders
    expect(cleanFrame).not.toContain("╭");
    expect(cleanFrame).not.toContain("╮");
    expect(cleanFrame).not.toContain("╰");
    expect(cleanFrame).not.toContain("╯");

    // Check for absence of horizontal padding
    const lines = cleanFrame.split("\n");
    const planContentLine = lines.find((l) => l.includes("Test Plan Content"));
    expect(planContentLine?.trimStart()).toBe("Test Plan Content");

    // Verify markdown rendering (bold text should have asterisks removed by Markdown component)
    expect(cleanFrame).toContain("Test Plan Content");
    expect(cleanFrame).not.toContain("**Test**");
  });
});
