import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { CompressDisplay } from "../../src/components/CompressDisplay.js";

describe("CompressDisplay", () => {
  it("should render compressed messages header", () => {
    const block = {
      type: "compress" as const,
      content: "Compressed content",
      sessionId: "test-session",
    };
    const { lastFrame } = render(<CompressDisplay block={block} />);
    expect(lastFrame()).toContain("📦 Compressed Messages");
    expect(lastFrame()).toContain("Compressed content");
  });

  it("should truncate content when not expanded", () => {
    const longContent = "line 1\nline 2\nline 3\nline 4\nline 5";
    const block = {
      type: "compress" as const,
      content: longContent,
      sessionId: "test-session",
    };
    const { lastFrame } = render(
      <CompressDisplay block={block} isExpanded={false} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Content truncated");
    expect(frame).toContain("5 lines total");
    expect(frame).toContain("showing first 3 lines");
    expect(frame).toContain("line 1");
    expect(frame).not.toContain("line 4");
  });

  it("should not truncate when expanded", () => {
    const longContent = "line 1\nline 2\nline 3\nline 4\nline 5";
    const block = {
      type: "compress" as const,
      content: longContent,
      sessionId: "test-session",
    };
    const { lastFrame } = render(
      <CompressDisplay block={block} isExpanded={true} />,
    );
    const frame = lastFrame();
    expect(frame).not.toContain("Content truncated");
    expect(frame).toContain("line 1");
    expect(frame).toContain("line 5");
  });

  it("should handle empty content", () => {
    const block = {
      type: "compress" as const,
      content: "",
      sessionId: "test-session",
    };
    const { lastFrame } = render(<CompressDisplay block={block} />);
    expect(lastFrame()).toContain("📦 Compressed Messages");
    // Should not have the content box
    expect(lastFrame()).not.toContain("borderLeft");
  });
});
