import React from "react";
import { render } from "ink-testing-library";
import { describe, it, expect } from "vitest";
import { DiffViewer } from "../src/components/DiffViewer";
import type { DiffBlock } from "../src/types";

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

  describe("Truncation behavior", () => {
    it("should truncate content when not expanded", () => {
      const block = createLargeDiffBlock();
      const { lastFrame } = render(
        <DiffViewer block={block} isExpanded={false} />,
      );

      // Should show truncation message
      expect(lastFrame()).toContain("more lines truncated");
      expect(lastFrame()).toContain("press Ctrl+R to expand");
    });

    it("should not truncate content when expanded", () => {
      const block = createLargeDiffBlock();
      const { lastFrame } = render(
        <DiffViewer block={block} isExpanded={true} />,
      );

      // Should not show truncation message
      expect(lastFrame()).not.toContain("more lines truncated");
      expect(lastFrame()).not.toContain("press Ctrl+R to expand");
    });

    it("should handle small diffs without truncation regardless of expand state", () => {
      const smallBlock: DiffBlock = {
        type: "diff",
        path: "small.txt",
        diffResult: [
          { value: "line 1\n", added: false, removed: false },
          { value: "old\n", added: false, removed: true },
          { value: "new\n", added: true, removed: false },
        ],
      };

      const { lastFrame: collapsedFrame } = render(
        <DiffViewer block={smallBlock} isExpanded={false} />,
      );
      const { lastFrame: expandedFrame } = render(
        <DiffViewer block={smallBlock} isExpanded={true} />,
      );

      // Neither should show truncation for small diffs
      expect(collapsedFrame()).not.toContain("more lines truncated");
      expect(expandedFrame()).not.toContain("more lines truncated");
    });
  });

  describe("Basic functionality", () => {
    it("should display file path", () => {
      const block: DiffBlock = {
        type: "diff",
        path: "src/example.ts",
        diffResult: [{ value: "test\n", added: false, removed: false }],
      };

      const { lastFrame } = render(<DiffViewer block={block} />);
      expect(lastFrame()).toContain("📄 src/example.ts");
    });

    it("should display warning when present", () => {
      const block: DiffBlock = {
        type: "diff",
        path: "test.txt",
        warning: "File was modified externally",
        diffResult: [{ value: "test\n", added: false, removed: false }],
      };

      const { lastFrame } = render(<DiffViewer block={block} />);
      expect(lastFrame()).toContain("⚠️ File was modified externally");
    });

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
    it("should show added lines with + prefix", () => {
      const block: DiffBlock = {
        type: "diff",
        path: "test.txt",
        diffResult: [{ value: "added line\n", added: true, removed: false }],
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

    it("should show unchanged lines with space prefix", () => {
      const block: DiffBlock = {
        type: "diff",
        path: "test.txt",
        diffResult: [
          { value: "unchanged line\n", added: false, removed: false },
          { value: "another line\n", added: true, removed: false }, // Add a change to show context
        ],
      };

      const { lastFrame } = render(<DiffViewer block={block} />);
      expect(lastFrame()).toContain("  unchanged line");
    });
  });
});
