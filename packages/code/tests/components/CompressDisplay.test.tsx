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
    const frame = lastFrame();
    expect(frame).toContain("📦 Compressed Messages");
    expect(frame).toContain("Compressed content");
  });

  it("should show full content and not truncate", () => {
    const longContent = "line 1\nline 2\nline 3\nline 4\nline 5";
    const block = {
      type: "compress" as const,
      content: longContent,
      sessionId: "test-session",
    };
    const { lastFrame } = render(<CompressDisplay block={block} />);
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
