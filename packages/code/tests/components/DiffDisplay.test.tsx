import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { DiffDisplay } from "../../src/components/DiffDisplay.js";
import type { ToolBlock } from "wave-agent-sdk";
import { useStdout } from "ink";

// Mock ink's useStdout
vi.mock("ink", async () => {
  const actual = await vi.importActual("ink");
  return {
    ...actual,
    useStdout: vi.fn(),
  };
});

// Mock transformToolBlockToChanges
vi.mock("../../src/utils/toolParameterTransforms.js", () => ({
  transformToolBlockToChanges: vi.fn(),
}));

import { transformToolBlockToChanges } from "../../src/utils/toolParameterTransforms.js";

describe("DiffDisplay Component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should respect maxHeight based on stdout rows (subtracting 20)", () => {
    vi.mocked(useStdout).mockReturnValue({
      stdout: { rows: 40 },
    } as unknown as ReturnType<typeof useStdout>);

    // maxHeight should be 40 - 20 = 20

    const toolBlock: ToolBlock = {
      type: "tool",
      name: "Edit",
      stage: "end",
      parameters: "{}",
    };

    // Mock 30 changes (lines)
    const mockChanges = [
      {
        oldContent: Array(30).fill("old line").join("\n"),
        newContent: Array(30).fill("new line").join("\n"),
      },
    ];
    vi.mocked(transformToolBlockToChanges).mockReturnValue(mockChanges);

    const { lastFrame } = render(<DiffDisplay toolBlock={toolBlock} />);
    const output = lastFrame();

    // It should show truncation message
    expect(output).toContain("truncated");
    // It should show "truncated 11 more lines"
    // maxHeight is 20, it shows maxHeight - 1 = 19 lines.
    // Total elements = 60. 60 - 19 = 41.
    expect(output).toContain("truncated 41 more lines");
  });

  it("should have a minimum maxHeight of 5", () => {
    vi.mocked(useStdout).mockReturnValue({
      stdout: { rows: 15 },
    } as unknown as ReturnType<typeof useStdout>);

    // 15 - 20 = -5, so maxHeight should be 5

    const toolBlock: ToolBlock = {
      type: "tool",
      name: "Edit",
      stage: "end",
      parameters: "{}",
    };

    const mockChanges = [
      {
        oldContent: Array(10).fill("old line").join("\n"),
        newContent: Array(10).fill("new line").join("\n"),
      },
    ];
    vi.mocked(transformToolBlockToChanges).mockReturnValue(mockChanges);

    const { lastFrame } = render(<DiffDisplay toolBlock={toolBlock} />);
    const output = lastFrame();

    expect(output).toContain("truncated");
    // maxHeight is 5, shows 4 lines. 20 - 4 = 16.
    expect(output).toContain("truncated 16 more lines");
  });
});
