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

  describe("Truncation behavior", () => {
    it("should truncate content when not expanded", () => {
      const block = createLargeDiffBlock();
      const { lastFrame } = render(
        <DiffViewer block={block} isExpanded={false} />,
      );

      // Should show truncation message
      expect(lastFrame()).toContain("more lines truncated");
      expect(lastFrame()).toContain("press Ctrl+O to expand");
    });

    it("should not truncate content when expanded", () => {
      const block = createLargeDiffBlock();
      const { lastFrame } = render(
        <DiffViewer block={block} isExpanded={true} />,
      );

      // Should not show truncation message
      expect(lastFrame()).not.toContain("more lines truncated");
      expect(lastFrame()).not.toContain("press Ctrl+O to expand");
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
    it("should show syntax highlighted content for new files", () => {
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
      expect(lastFrame()).toContain("added line 1");
      expect(lastFrame()).not.toContain("+ added line");
      expect(lastFrame()).not.toContain("📄 New file");
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

    it("should show syntax highlighted content when only additions are present", () => {
      const block: DiffBlock = {
        type: "diff",
        path: "newfile.js",
        diffResult: [
          { value: "function hello() {\n", added: true, removed: false },
          { value: "  console.log('Hello');\n", added: true, removed: false },
          { value: "  return 'Hello';\n", added: true, removed: false },
          { value: "}\n", added: true, removed: false },
        ],
      };

      const { lastFrame } = render(<DiffViewer block={block} />);
      expect(lastFrame()).toContain("function hello()");
      expect(lastFrame()).toContain("console.log");
      // Should NOT show traditional diff format
      expect(lastFrame()).not.toContain("+ function hello()");
      expect(lastFrame()).not.toContain("📄 New file");
    });

    it("should not use syntax highlighting when there are removals", () => {
      const block: DiffBlock = {
        type: "diff",
        path: "modified.js",
        diffResult: [
          { value: "function old() {\n", added: false, removed: true },
          { value: "function new() {\n", added: true, removed: false },
          { value: "  return 'hello';\n", added: true, removed: false },
          { value: "}\n", added: true, removed: false },
        ],
      };

      const { lastFrame } = render(<DiffViewer block={block} />);
      expect(lastFrame()).toContain("- function old()");
      expect(lastFrame()).toContain("+ function new()");
      // Should NOT show new file header
      expect(lastFrame()).not.toContain("📄 New file:");
      expect(lastFrame()).not.toContain("Auto-detected syntax highlighting");
    });
  });
});
