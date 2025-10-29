import { render } from "ink-testing-library";
import React from "react";
import { describe, expect, it } from "vitest";
import { CompressDisplay } from "../../src/components/CompressDisplay.js";
import type { CompressBlock } from "wave-agent-sdk";

describe("CompressDisplay", () => {
  it("should render compression block with proper styling", () => {
    const block: CompressBlock = {
      type: "compress",
      content: "This is compressed content\nwith multiple lines\nof text",
    };

    const { lastFrame } = render(
      <CompressDisplay block={block} isExpanded={false} />,
    );

    expect(lastFrame()).toContain("📦 Compressed Messages");
    expect(lastFrame()).toContain("This is compressed content");
  });

  it("should show truncation message when content is long and collapsed", () => {
    const longContent = Array(10)
      .fill("line")
      .map((_, i) => `Line ${i + 1}`)
      .join("\n");

    const block: CompressBlock = {
      type: "compress",
      content: longContent,
    };

    const { lastFrame } = render(
      <CompressDisplay block={block} isExpanded={false} />,
    );

    expect(lastFrame()).toContain("Content truncated");
    expect(lastFrame()).toContain("Press Ctrl+O to expand");
  });

  it("should show full content when expanded", () => {
    const longContent = Array(10)
      .fill("line")
      .map((_, i) => `Line ${i + 1}`)
      .join("\n");

    const block: CompressBlock = {
      type: "compress",
      content: longContent,
    };

    const { lastFrame } = render(
      <CompressDisplay block={block} isExpanded={true} />,
    );

    expect(lastFrame()).toContain("Line 1");
    expect(lastFrame()).toContain("Line 10");
    expect(lastFrame()).not.toContain("Content truncated");
  });
});
