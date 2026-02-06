import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { DiffDisplay } from "../../src/components/DiffDisplay.js";
import { WRITE_TOOL_NAME, EDIT_TOOL_NAME } from "wave-agent-sdk";

describe("DiffDisplay", () => {
  it("should not render anything for non-diff tools", () => {
    const { lastFrame } = render(
      <DiffDisplay toolName="Read" parameters='{"file_path": "test.txt"}' />,
    );
    expect(lastFrame()).toBe("");
  });

  it("should render diff for Write tool", () => {
    const params = JSON.stringify({
      content: "new file content",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay toolName={WRITE_TOOL_NAME} parameters={params} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Diff:");
    expect(frame).toContain("+new file content");
  });

  it("should render diff for Edit tool", () => {
    const params = JSON.stringify({
      old_string: "old content",
      new_string: "new content",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay toolName={EDIT_TOOL_NAME} parameters={params} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Diff:");
    expect(frame).toContain("-old content");
    expect(frame).toContain("+new content");
  });

  it("should handle word-level diff for Edit tool", () => {
    const params = JSON.stringify({
      old_string: "The quick brown fox",
      new_string: "The fast brown fox",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay toolName={EDIT_TOOL_NAME} parameters={params} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("The");
    expect(frame).toContain("quick");
    expect(frame).toContain("fast");
    expect(frame).toContain("brown fox");
  });

  it("should not use word-level diff for multi-line changes", () => {
    const params = JSON.stringify({
      old_string: "line 1\nline 2",
      new_string: "line 1 modified\nline 2 modified",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay toolName={EDIT_TOOL_NAME} parameters={params} />,
    );
    const frame = lastFrame();
    // In multi-line, it should just show the lines with +/-
    expect(frame).toContain("-line 1");
    expect(frame).toContain("-line 2");
    expect(frame).toContain("+line 1 modified");
    expect(frame).toContain("+line 2 modified");
    // It should NOT have the word-level highlighting (which uses background colors)
    // Since we can't easily check background colors in the text output here,
    // we just verify the basic structure is correct.
  });

  it("should truncate long diffs when not expanded", () => {
    const longContent = Array.from(
      { length: 30 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    const params = JSON.stringify({
      content: longContent,
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay
        toolName={WRITE_TOOL_NAME}
        parameters={params}
        isExpanded={false}
      />,
    );
    expect(lastFrame()).toContain("truncated");
  });

  it("should not truncate when expanded", () => {
    const longContent = Array.from(
      { length: 30 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    const params = JSON.stringify({
      content: longContent,
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay
        toolName={WRITE_TOOL_NAME}
        parameters={params}
        isExpanded={true}
      />,
    );
    expect(lastFrame()).not.toContain("truncated");
    expect(lastFrame()).toContain("+line 30");
  });

  it("should handle invalid JSON parameters gracefully", () => {
    const { lastFrame } = render(
      <DiffDisplay toolName={EDIT_TOOL_NAME} parameters="invalid json" />,
    );
    // It renders the "Diff:" header but no content because transform fails
    expect(lastFrame()).toContain("Diff:");
    expect(lastFrame()).not.toContain("-");
    expect(lastFrame()).not.toContain("+");
  });
});
