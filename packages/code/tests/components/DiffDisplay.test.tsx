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

  it("should render highlighted code for Write tool", () => {
    const params = JSON.stringify({
      content: "new file content",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay toolName={WRITE_TOOL_NAME} parameters={params} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("```txt");
    expect(frame).toContain("new file content");
    expect(frame).toContain("```");
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

  it("should use word-level diff for multi-line changes with matching line counts", () => {
    const params = JSON.stringify({
      old_string: "line 1\nline 2",
      new_string: "line 1 modified\nline 2 modified",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay toolName={EDIT_TOOL_NAME} parameters={params} />,
    );
    const frame = lastFrame() || "";
    // In multi-line with matching line counts, it should show alternating lines
    expect(frame).toContain("-line 1");
    expect(frame).toContain("+line 1 modified");
    expect(frame).toContain("-line 2");
    expect(frame).toContain("+line 2 modified");

    const minusLine1Index = frame.indexOf("-line 1");
    const plusLine1Index = frame.indexOf("+line 1 modified");
    const minusLine2Index = frame.indexOf("-line 2");
    const plusLine2Index = frame.indexOf("+line 2 modified");

    expect(minusLine1Index).toBeLessThan(plusLine1Index);
    expect(plusLine1Index).toBeLessThan(minusLine2Index);
    expect(minusLine2Index).toBeLessThan(plusLine2Index);
  });

  it("should not truncate long diffs", () => {
    const longContent = Array.from(
      { length: 30 },
      (_, i) => `line ${i + 1}`,
    ).join("\n");
    const params = JSON.stringify({
      content: longContent,
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay toolName={WRITE_TOOL_NAME} parameters={params} />,
    );
    expect(lastFrame()).not.toContain("truncated");
    expect(lastFrame()).toContain("line 30");
  });

  it("should handle invalid JSON parameters gracefully", () => {
    const { lastFrame } = render(
      <DiffDisplay toolName={EDIT_TOOL_NAME} parameters="invalid json" />,
    );
    // It renders nothing because transform fails
    expect(lastFrame()).toBe("");
  });

  it("should handle context lines in diff", () => {
    const params = JSON.stringify({
      old_string: "line1\nline2\nline3",
      new_string: "line1\nline2 modified\nline3",
      file_path: "test.txt",
    });
    const { lastFrame } = render(
      <DiffDisplay toolName={EDIT_TOOL_NAME} parameters={params} />,
    );
    const frame = lastFrame();
    expect(frame).toContain(" line1");
    expect(frame).toContain("-line2");
    expect(frame).toContain("+line2 modified");
    expect(frame).toContain(" line3");
  });
});
