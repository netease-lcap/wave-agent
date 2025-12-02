import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { DiffViewer } from "../../src/components/DiffViewer.js";
import type { DiffBlock } from "wave-agent-sdk";

describe("DiffViewer", () => {
  const createLargeDiffBlock = (): DiffBlock => {
    // Create a diff with many changes to exceed the 100 line limit
    const diffResult = [];

    // Add some context lines
    for (let i = 0; i < 50; i++) {
      diffResult.push({
        value: `context line ${i}\n`,
        added: false,
        removed: false,
      });
    }

    // Add many changes to exceed the limit
    for (let i = 0; i < 60; i++) {
      diffResult.push({
        value: `removed line ${i}\n`,
        added: false,
        removed: true,
      });
      diffResult.push({
        value: `added line ${i}\n`,
        added: true,
        removed: false,
      });
    }

    return {
      type: "diff",
      path: "large.txt",
      diffResult,
    };
  };

  describe("Content display behavior", () => {
    it("should always show all content without truncation", () => {
      const block = createLargeDiffBlock();
      const { lastFrame } = render(<DiffViewer block={block} />);

      // Should never show truncation message since DiffViewer always shows all content
      expect(lastFrame()).not.toContain("more lines truncated");
      expect(lastFrame()).not.toContain("press Ctrl+O to expand");
    });

    it("should handle small diffs without truncation", () => {
      const smallBlock: DiffBlock = {
        type: "diff",
        path: "small.txt",
        diffResult: [
          { value: "line 1\n", added: false, removed: false },
          { value: "old\n", added: false, removed: true },
          { value: "new\n", added: true, removed: false },
        ],
      };

      const { lastFrame } = render(<DiffViewer block={smallBlock} />);

      // Should not show truncation for small diffs
      expect(lastFrame()).not.toContain("more lines truncated");
    });
  });

  describe("Basic functionality", () => {
    it("should handle empty diff result", () => {
      const block: DiffBlock = {
        type: "diff",
        path: "empty.txt",
        diffResult: [],
      };

      const { lastFrame } = render(<DiffViewer block={block} />);
      expect(lastFrame()).toContain("No changes detected");
    });
  });

  describe("Diff rendering", () => {
    it("should show added lines with + prefix for new files", () => {
      const block: DiffBlock = {
        type: "diff",
        path: "test.txt",
        diffResult: [
          { value: "added line 1\n", added: true, removed: false },
          { value: "added line 2\n", added: true, removed: false },
          { value: "added line 3\n", added: true, removed: false },
          { value: "added line 4\n", added: true, removed: false },
        ],
      };

      const { lastFrame } = render(<DiffViewer block={block} />);
      expect(lastFrame()).toContain("+ added line 1");
      expect(lastFrame()).toContain("+ added line 2");
    });

    it("should show added lines with + prefix when mixed with other changes", () => {
      const block: DiffBlock = {
        type: "diff",
        path: "test.txt",
        diffResult: [
          { value: "removed line\n", added: false, removed: true },
          { value: "added line\n", added: true, removed: false },
        ],
      };

      const { lastFrame } = render(<DiffViewer block={block} />);
      expect(lastFrame()).toContain("+ added line");
    });

    it("should show removed lines with - prefix", () => {
      const block: DiffBlock = {
        type: "diff",
        path: "test.txt",
        diffResult: [{ value: "removed line\n", added: false, removed: true }],
      };

      const { lastFrame } = render(<DiffViewer block={block} />);
      expect(lastFrame()).toContain("- removed line");
    });

    it("should show unchanged lines with space prefix in traditional diff format", () => {
      const block: DiffBlock = {
        type: "diff",
        path: "test.txt",
        diffResult: [
          { value: "unchanged line\n", added: false, removed: false },
          { value: "removed line\n", added: false, removed: true }, // Add removal to prevent syntax highlighting
          { value: "added line\n", added: true, removed: false },
        ],
      };

      const { lastFrame } = render(<DiffViewer block={block} />);
      expect(lastFrame()).toContain("  unchanged line");
      expect(lastFrame()).toContain("- removed line");
      expect(lastFrame()).toContain("+ added line");
      // Should NOT show new file header
      expect(lastFrame()).not.toContain("📄 New file:");
    });
  });
});
