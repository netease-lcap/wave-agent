import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { CompactDisplay } from "../../src/components/CompactDisplay.js";

describe("CompactDisplay", () => {
  it("should render compacted messages header", () => {
    const block = {
      type: "compact" as const,
      content: "Compacted content",
      sessionId: "test-session",
    };
    const { lastFrame } = render(<CompactDisplay block={block} />);
    const frame = lastFrame();
    expect(frame).toContain("Compacted Messages");
    expect(frame).toContain("Compacted content");
  });

  it("should show full content and not truncate", () => {
    const longContent = "line 1\nline 2\nline 3\nline 4\nline 5";
    const block = {
      type: "compact" as const,
      content: longContent,
      sessionId: "test-session",
    };
    const { lastFrame } = render(<CompactDisplay block={block} />);
    const frame = lastFrame();
    expect(frame).not.toContain("Content truncated");
    expect(frame).toContain("line 1");
    expect(frame).toContain("line 5");
  });

  it("should handle empty content", () => {
    const block = {
      type: "compact" as const,
      content: "",
      sessionId: "test-session",
    };
    const { lastFrame } = render(<CompactDisplay block={block} />);
    expect(lastFrame()).toContain("Compacted Messages");
    // Should not have the content box
    expect(lastFrame()).not.toContain("borderLeft");
  });
});
