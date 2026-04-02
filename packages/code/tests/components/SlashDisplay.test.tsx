import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { SlashDisplay } from "../../src/components/SlashDisplay.js";
import type { SlashBlock } from "wave-agent-sdk";

describe("SlashDisplay Component", () => {
  it("should render command and args", () => {
    const block: SlashBlock = {
      type: "slash",
      command: "test",
      args: "arg1 arg2",
      stage: "success",
    };
    const { lastFrame } = render(<SlashDisplay block={block} />);
    const frame = lastFrame();
    expect(frame).toContain("/ ");
    expect(frame).toContain("test");
    expect(frame).toContain("arg1 arg2");
  });

  it("should render shortResult when not expanded", () => {
    const block: SlashBlock = {
      type: "slash",
      command: "test",
      args: "arg1",
      stage: "success",
      shortResult: "short result content",
    };
    const { lastFrame } = render(
      <SlashDisplay block={block} isExpanded={false} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("short result content");
    // Check if it's on a new line (by checking if it's not on the same line as command)
    // In ink-testing-library, lastFrame() returns a string with newlines.
    const lines = frame!
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]).toContain("/ test arg1");
    expect(lines[1]).toContain("short result content");
  });

  it("should not render shortResult when expanded", () => {
    const block: SlashBlock = {
      type: "slash",
      command: "test",
      args: "arg1",
      stage: "success",
      shortResult: "short result content",
    };
    const { lastFrame } = render(
      <SlashDisplay block={block} isExpanded={true} />,
    );
    const frame = lastFrame();
    expect(frame).not.toContain("short result content");
  });

  it("should render result when expanded", () => {
    const block: SlashBlock = {
      type: "slash",
      command: "test",
      args: "arg1",
      stage: "success",
      result: "full result content",
    };
    const { lastFrame } = render(
      <SlashDisplay block={block} isExpanded={true} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Result:");
    expect(frame).toContain("full result content");
  });

  it("should render error when present", () => {
    const block: SlashBlock = {
      type: "slash",
      command: "test",
      args: "arg1",
      stage: "error",
      error: "some error occurred",
    };
    const { lastFrame } = render(<SlashDisplay block={block} />);
    const frame = lastFrame();
    expect(frame).toContain("Error: some error occurred");
  });
});
