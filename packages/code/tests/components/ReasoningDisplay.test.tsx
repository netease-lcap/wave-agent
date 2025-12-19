import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { ReasoningDisplay } from "../../src/components/ReasoningDisplay.js";
import type { ReasoningBlock } from "wave-agent-sdk";

describe("ReasoningDisplay Component", () => {
  it("should render reasoning content with proper styling", () => {
    const reasoningBlock: ReasoningBlock = {
      type: "reasoning",
      content:
        "**Analyzing the Request**\n\nI need to understand what the user is asking for and provide a helpful response.",
    };

    const { lastFrame } = render(<ReasoningDisplay block={reasoningBlock} />);
    const output = lastFrame();

    // Should show reasoning content
    expect(output).toContain("Analyzing the Request");
    expect(output).toContain("I need to understand what the user is asking");
  });

  it("should not render when content is empty", () => {
    const reasoningBlock: ReasoningBlock = {
      type: "reasoning",
      content: "",
    };

    const { lastFrame } = render(<ReasoningDisplay block={reasoningBlock} />);
    const output = lastFrame();

    // Should not render anything when content is empty
    expect(output).toBe("");
  });

  it("should not render when content is only whitespace", () => {
    const reasoningBlock: ReasoningBlock = {
      type: "reasoning",
      content: "   \n\t  ",
    };

    const { lastFrame } = render(<ReasoningDisplay block={reasoningBlock} />);
    const output = lastFrame();

    // Should not render anything when content is only whitespace
    expect(output).toBe("");
  });

  it("should render markdown formatting in content", () => {
    const reasoningBlock: ReasoningBlock = {
      type: "reasoning",
      content:
        "**Bold text** and *italic text*\n\n- List item 1\n- List item 2",
    };

    const { lastFrame } = render(<ReasoningDisplay block={reasoningBlock} />);
    const output = lastFrame();

    // Should show formatted content (Markdown component handles formatting)
    expect(output).toContain("Bold text");
    expect(output).toContain("italic text");
    expect(output).toContain("List item 1");
    expect(output).toContain("List item 2");
  });
});
