import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { MemoryDisplay } from "../../src/components/MemoryDisplay.js";

describe("MemoryDisplay", () => {
  it("should render success state correctly", () => {
    const block = {
      type: "memory" as const,
      content: "Important info",
      isSuccess: true,
      memoryType: "user" as const,
      storagePath: "user-memory.md",
    };
    const { lastFrame } = render(<MemoryDisplay block={block} />);
    const frame = lastFrame();
    expect(frame).toContain("💾 Added to memory");
    expect(frame).toContain("Important info");
    expect(frame).toContain("Memory saved to user-memory.md");
  });

  it("should render failure state correctly", () => {
    const block = {
      type: "memory" as const,
      content: "Failed info",
      isSuccess: false,
      memoryType: "project" as const,
    };
    const { lastFrame } = render(<MemoryDisplay block={block} />);
    const frame = lastFrame();
    expect(frame).toContain("⚠️ Failed to add memory");
    expect(frame).toContain("Failed info");
    expect(frame).not.toContain("Memory saved to");
  });

  it("should handle missing storagePath", () => {
    const block = {
      type: "memory" as const,
      content: "Info",
      isSuccess: true,
      memoryType: "project" as const,
    };
    const { lastFrame } = render(<MemoryDisplay block={block} />);
    expect(lastFrame()).toContain("Memory saved to AGENTS.md");
  });
});
