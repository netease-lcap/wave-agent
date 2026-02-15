import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { DiffDisplay } from "../../src/components/DiffDisplay.js";
import { EDIT_TOOL_NAME } from "wave-agent-sdk";

describe("DiffDisplay Truncation", () => {
  it("should truncate first block of unchanged lines (keep last 3)", () => {
    const params = JSON.stringify({
      old_string: "c1\nc2\nc3\nc4\nc5\nold",
      new_string: "c1\nc2\nc3\nc4\nc5\nnew",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay toolName={EDIT_TOOL_NAME} parameters={params} />,
    );
    const frame = lastFrame();

    // Should contain ellipsis at the top
    expect(frame).toContain("...");
    // Should NOT contain the first two lines
    expect(frame).not.toContain(" c1");
    expect(frame).not.toContain(" c2");
    // Should contain the last 3 context lines before the change
    expect(frame).toContain(" c3");
    expect(frame).toContain(" c4");
    expect(frame).toContain(" c5");
    expect(frame).toContain("-old");
    expect(frame).toContain("+new");
  });

  it("should truncate last block of unchanged lines (keep first 3)", () => {
    const params = JSON.stringify({
      old_string: "old\nc1\nc2\nc3\nc4\nc5",
      new_string: "new\nc1\nc2\nc3\nc4\nc5",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay toolName={EDIT_TOOL_NAME} parameters={params} />,
    );
    const frame = lastFrame();

    expect(frame).toContain("-old");
    expect(frame).toContain("+new");
    // Should contain the first 3 context lines after the change
    expect(frame).toContain(" c1");
    expect(frame).toContain(" c2");
    expect(frame).toContain(" c3");
    // Should NOT contain the last two lines
    expect(frame).not.toContain(" c4");
    expect(frame).not.toContain(" c5");
    // Should contain ellipsis at the bottom
    expect(frame).toContain("...");
  });

  it("should truncate middle block of unchanged lines (keep first 3 and last 3)", () => {
    const params = JSON.stringify({
      old_string: "start\nc1\nc2\nc3\nc4\nc5\nc6\nc7\nc8\nend",
      new_string: "start mod\nc1\nc2\nc3\nc4\nc5\nc6\nc7\nc8\nend mod",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay toolName={EDIT_TOOL_NAME} parameters={params} />,
    );
    const frame = lastFrame();

    expect(frame).toContain("-start");
    expect(frame).toContain("+start mod");

    // First 3 of middle block
    expect(frame).toContain(" c1");
    expect(frame).toContain(" c2");
    expect(frame).toContain(" c3");

    // Ellipsis in the middle
    expect(frame).toContain("...");

    // Middle lines should be missing
    expect(frame).not.toContain(" c4");
    expect(frame).not.toContain(" c5");

    // Last 3 of middle block
    expect(frame).toContain(" c6");
    expect(frame).toContain(" c7");
    expect(frame).toContain(" c8");

    expect(frame).toContain("-end");
    expect(frame).toContain("+end mod");
  });

  it("should not truncate if lines are within limits", () => {
    const params = JSON.stringify({
      old_string: "c1\nc2\nold\nc3\nc4\nc5\nc6\nend\nc7\nc8",
      new_string: "c1\nc2\nnew\nc3\nc4\nc5\nc6\nend mod\nc7\nc8",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay toolName={EDIT_TOOL_NAME} parameters={params} />,
    );
    const frame = lastFrame();

    // No ellipsis should be present
    expect(frame).not.toContain("...");

    // All lines should be present
    ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"].forEach((line) => {
      expect(frame).toContain(` ${line}`);
    });
  });
});
