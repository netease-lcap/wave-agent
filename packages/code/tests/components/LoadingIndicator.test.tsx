import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { LoadingIndicator } from "../../src/components/LoadingIndicator.js";

describe("LoadingIndicator", () => {
  it("should render nothing when idle", () => {
    const { lastFrame } = render(<LoadingIndicator />);
    expect(lastFrame()).toBe("");
  });

  it("should show the AI thinking indicator with an abort hint", () => {
    const { lastFrame } = render(<LoadingIndicator isLoading />);
    const frame = lastFrame();
    expect(frame).toContain("✻ AI is thinking...");
    expect(frame).toContain("Esc");
    expect(frame).toContain("to abort");
    expect(frame).not.toContain("Compacting");
  });

  it("should show the compacting hint", () => {
    const { lastFrame } = render(<LoadingIndicator isCompacting />);
    const frame = lastFrame();
    expect(frame).toContain("✻ Compacting message history...");
    expect(frame).not.toContain("AI is thinking");
  });

  it("should not show a streaming tail before any compaction output arrives", () => {
    const { lastFrame } = render(
      <LoadingIndicator isCompacting compactionStream="" />,
    );
    const frame = lastFrame();
    expect(frame).toContain("✻ Compacting message history...");
    expect(frame).not.toContain("…");
  });

  it("should show a short compaction stream in full as the tail", () => {
    const { lastFrame } = render(
      <LoadingIndicator isCompacting compactionStream="summarizing" />,
    );
    const frame = lastFrame();
    expect(frame).toContain("✻ Compacting message history...");
    expect(frame).toContain("summarizing");
  });

  it("should show only the last 30 characters of a long compaction stream", () => {
    const stream =
      "We started by reviewing the failing test, then traced the root cause " +
      "into the streaming path and patched the race condition";
    const { lastFrame } = render(
      <LoadingIndicator isCompacting compactionStream={stream} />,
    );
    const frame = lastFrame();
    expect(frame).toContain(`…${stream.slice(-30)}`);
    expect(frame).not.toContain("We started by reviewing");
  });

  it("should flatten newlines in the compaction stream tail", () => {
    const stream = "line one\nline two";
    const { lastFrame } = render(
      <LoadingIndicator isCompacting compactionStream={stream} />,
    );
    expect(lastFrame()).toContain("line one\\nline two");
  });

  it("should show the command running indicator", () => {
    const { lastFrame } = render(<LoadingIndicator isCommandRunning />);
    expect(lastFrame()).toContain("✻ Command is running...");
  });
});
