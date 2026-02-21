import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi } from "vitest";
import { ToolDisplay } from "../../src/components/ToolDisplay.js";

import { Box, Text } from "ink";

// Mock DiffDisplay
vi.mock("../../src/components/DiffDisplay.js", () => ({
  DiffDisplay: ({ toolName }: { toolName: string }) => (
    <Box>
      <Text>Diff for {toolName}</Text>
    </Box>
  ),
}));

describe("ToolDisplay", () => {
  const mockBlock = {
    type: "tool" as const,
    name: "test_tool",
    parameters: '{"arg": "val"}',
    compactParams: "(arg=val)",
    stage: "end" as const,
    success: true,
    result: "Full result content",
  };

  it("should render tool name and compact params when collapsed", () => {
    const { lastFrame } = render(
      <ToolDisplay block={mockBlock} isExpanded={false} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("● test_tool");
    expect(frame).toContain("(arg=val)");
    expect(frame).toContain("Full result content");
  });

  it("should render full parameters and result when expanded", () => {
    const { lastFrame } = render(
      <ToolDisplay block={mockBlock} isExpanded={true} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("Parameters:");
    expect(frame).toContain('{"arg": "val"}');
    expect(frame).toContain("Result:");
    expect(frame).toContain("Full result content");
    expect(frame).not.toContain("(arg=val)");
  });

  it("should show running status", () => {
    const runningBlock = {
      ...mockBlock,
      stage: "running" as const,
      success: undefined,
    };
    const { lastFrame } = render(<ToolDisplay block={runningBlock} />);
    expect(lastFrame()).toContain("●");
  });

  it("should show error status", () => {
    const errorBlock = {
      ...mockBlock,
      success: false,
      error: "Something went wrong",
    };
    const { lastFrame } = render(<ToolDisplay block={errorBlock} />);
    const frame = lastFrame();
    expect(frame).toContain("●");
    expect(frame).toContain("Error: Something went wrong");
  });

  it("should show image indicator", () => {
    const imageBlock = {
      ...mockBlock,
      images: [{ data: "base64data", mediaType: "image/png" }],
    };
    const { lastFrame } = render(<ToolDisplay block={imageBlock} />);
    expect(lastFrame()).toContain("🖼️");
  });

  it("should show multiple image indicator", () => {
    const imageBlock = {
      ...mockBlock,
      images: [
        { data: "base64data1", mediaType: "image/png" },
        { data: "base64data2", mediaType: "image/png" },
      ],
    };
    const { lastFrame } = render(<ToolDisplay block={imageBlock} />);
    expect(lastFrame()).toContain("🖼️×2");
  });

  it("should show DiffDisplay when successful and stage is end", () => {
    const { lastFrame } = render(<ToolDisplay block={mockBlock} />);
    expect(lastFrame()).toContain("Diff for test_tool");
  });

  it("should truncate result in collapsed state if no shortResult", () => {
    const longResult = "line 1\nline 2\nline 3\nline 4\nline 5\nline 6";
    const longBlock = { ...mockBlock, result: longResult };
    const { lastFrame } = render(
      <ToolDisplay block={longBlock} isExpanded={false} />,
    );
    const frame = lastFrame();
    expect(frame).not.toContain("line 1");
    expect(frame).toContain("line 6");
  });
});
