import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { CommandOutputDisplay } from "../../src/components/CommandOutputDisplay.js";
import { CommandOutputBlock } from "wave-agent-sdk";

describe("CommandOutputDisplay", () => {
  const mockBlock: CommandOutputBlock = {
    type: "command_output",
    command: "ls -la",
    output:
      "total 0\ndrwxr-xr-x  2 user  group   64 Feb  5 23:00 .\ndrwxr-xr-x  3 user  group   96 Feb  5 23:00 ..",
    isRunning: false,
    exitCode: 0,
  };

  it("should render command and output correctly", () => {
    const { lastFrame } = render(<CommandOutputDisplay block={mockBlock} />);
    const frame = lastFrame();
    expect(frame).toContain("$ ls -la");
    expect(frame).toContain("✅");
    expect(frame).toContain("total 0");
  });

  it("should show running status", () => {
    const runningBlock = { ...mockBlock, isRunning: true, exitCode: null };
    const { lastFrame } = render(<CommandOutputDisplay block={runningBlock} />);
    expect(lastFrame()).toContain("🔄");
  });

  it("should show error status for non-zero exit code", () => {
    const errorBlock = { ...mockBlock, exitCode: 1 };
    const { lastFrame } = render(<CommandOutputDisplay block={errorBlock} />);
    expect(lastFrame()).toContain("❌");
  });

  it("should show warning status for SIGINT (130)", () => {
    const sigintBlock = { ...mockBlock, exitCode: 130 };
    const { lastFrame } = render(<CommandOutputDisplay block={sigintBlock} />);
    expect(lastFrame()).toContain("⚠️");
  });

  it("should truncate output when not expanded and exceeding MAX_LINES", async () => {
    const longOutput = Array.from(
      { length: 20 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    const longBlock = { ...mockBlock, output: longOutput };
    const { lastFrame } = render(
      <CommandOutputDisplay block={longBlock} isExpanded={false} />,
    );

    // Wait for useEffect to run and update state
    await new Promise((resolve) => setTimeout(resolve, 100));

    const frame = lastFrame();
    expect(frame).toContain("Content truncated");
    expect(frame).toContain("20 lines total");
    expect(frame).toContain("showing last 10 lines");
    expect(frame).not.toContain("line 1\n");
    expect(frame).toContain("line 20");
  });

  it("should not truncate output when expanded", () => {
    const longOutput = Array.from(
      { length: 20 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    const longBlock = { ...mockBlock, output: longOutput };
    const { lastFrame } = render(
      <CommandOutputDisplay block={longBlock} isExpanded={true} />,
    );
    const frame = lastFrame();
    expect(frame).not.toContain("Content truncated");
    expect(frame).toContain("line 1");
    expect(frame).toContain("line 20");
  });

  it("should handle empty output", () => {
    const emptyBlock = { ...mockBlock, output: "" };
    const { lastFrame } = render(<CommandOutputDisplay block={emptyBlock} />);
    expect(lastFrame()).toContain("$ ls -la");
    // Should not have the output box
    expect(lastFrame()).not.toContain("borderLeft");
  });
});
