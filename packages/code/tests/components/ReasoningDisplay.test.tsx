import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { Box, Text } from "ink";
import { ReasoningDisplay } from "../../src/components/ReasoningDisplay.js";

// Mock Markdown component to avoid complex rendering in tests
vi.mock("../../src/components/Markdown.js", () => ({
  Markdown: ({ children }: { children: string }) => (
    <Box>
      <Text>{children}</Text>
    </Box>
  ),
}));

describe("ReasoningDisplay", () => {
  it("should render reasoning content correctly", () => {
    const block = {
      type: "reasoning" as const,
      content: "I am thinking about the problem.",
    };
    const { lastFrame } = render(<ReasoningDisplay block={block} />);
    expect(lastFrame()).toContain("I am thinking about the problem.");
  });

  it("should return null for empty content", () => {
    const block = {
      type: "reasoning" as const,
      content: "",
    };
    const { lastFrame } = render(<ReasoningDisplay block={block} />);
    expect(lastFrame()).toBe("");
  });

  it("should return null for whitespace content", () => {
    const block = {
      type: "reasoning" as const,
      content: "   ",
    };
    const { lastFrame } = render(<ReasoningDisplay block={block} />);
    expect(lastFrame()).toBe("");
  });
});
