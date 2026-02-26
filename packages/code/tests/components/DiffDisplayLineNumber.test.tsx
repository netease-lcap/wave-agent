import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { DiffDisplay } from "../../src/components/DiffDisplay.js";
import { WRITE_TOOL_NAME, EDIT_TOOL_NAME } from "wave-agent-sdk";

describe("DiffDisplay Line Numbers", () => {
  it("should render line numbers for Write tool", () => {
    const params = JSON.stringify({
      content: "line 1\nline 2\nline 3",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay
        toolName={WRITE_TOOL_NAME}
        parameters={params}
        startLineNumber={1}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("      1 | +line 1");
    expect(frame).toContain("      2 | +line 2");
    expect(frame).toContain("      3 | +line 3");
  });

  it("should render line numbers for Edit tool with absolute line number", () => {
    const params = JSON.stringify({
      old_string: "old line",
      new_string: "new line",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay
        toolName={EDIT_TOOL_NAME}
        parameters={params}
        startLineNumber={10}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("10    | -old line");
    expect(frame).toContain("   10 | +new line");
  });

  it("should handle context lines and ellipsis with line numbers", () => {
    const params = JSON.stringify({
      old_string:
        "line 1\nline 2\nline 3\nline 4\nline 5\nline 6\nline 7\nline 8\nline 9\nline 10",
      new_string:
        "line 1\nline 2\nline 3\nline 4\nline 5 modified\nline 6\nline 7\nline 8\nline 9\nline 10",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay
        toolName={EDIT_TOOL_NAME}
        parameters={params}
        startLineNumber={100}
      />,
    );
    const frame = lastFrame();

    // Should show context lines around the change
    expect(frame).toContain("102 102 |  line 3");
    expect(frame).toContain("103 103 |  line 4");
    expect(frame).toContain("104     | -line 5");
    expect(frame).toContain("    104 | +line 5 modified");
    expect(frame).toContain("105 105 |  line 6");
    expect(frame).toContain("106 106 |  line 7");

    // Should show ellipsis for skipped lines
    expect(frame).toContain("...");
  });

  it("should handle word-level diff with line numbers", () => {
    const params = JSON.stringify({
      old_string: "The quick brown fox",
      new_string: "The fast brown fox",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay
        toolName={EDIT_TOOL_NAME}
        parameters={params}
        startLineNumber={50}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("50    | -The quick brown fox");
    expect(frame).toContain("   50 | +The fast brown fox");
  });
});
