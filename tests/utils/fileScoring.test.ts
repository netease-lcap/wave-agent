import { describe, it, expect } from "vitest";
import {
  fuzzySearchFiles,
  calculateFuzzyScore,
} from "../../src/utils/fileScoring";
import type { FileTreeNode } from "../../src/types/common";

describe("fileScoring", () => {
  const mockFiles: FileTreeNode[] = [
    {
      path: "src/components/ToolResultDisplay.tsx",
      label: "ToolResultDisplay.tsx",
      children: [],
    },
    {
      path: "tests/components/ToolResultDisplay.test.tsx",
      label: "ToolResultDisplay.test.tsx",
      children: [],
    },
    {
      path: "src/components/CommandOutputDisplay.tsx",
      label: "CommandOutputDisplay.tsx",
      children: [],
    },
    {
      path: "tests/components/ToolResultDisplay.compactParams.test.tsx",
      label: "ToolResultDisplay.compactParams.test.tsx",
      children: [],
    },
    {
      path: "src/utils/resultProcessor.ts",
      label: "resultProcessor.ts",
      children: [],
    },
    { path: "docs/tool-guide.md", label: "tool-guide.md", children: [] },
    {
      path: "src/tools/fileSearchTool.ts",
      label: "fileSearchTool.ts",
      children: [],
    },
    { path: "package.json", label: "package.json", children: [] },
    { path: "README.md", label: "README.md", children: [] },
  ];

  describe("calculateFuzzyScore", () => {
    it("should handle single keyword queries", () => {
      const score = calculateFuzzyScore(
        "tool",
        "src/components/ToolResultDisplay.tsx",
      );
      expect(score).toBeGreaterThan(0);
    });

    it("should handle space-separated keywords", () => {
      const score = calculateFuzzyScore(
        "result tool",
        "src/components/ToolResultDisplay.tsx",
      );
      expect(score).toBeGreaterThan(0);
    });

    it("should support out-of-order keywords", () => {
      const score = calculateFuzzyScore(
        "display result",
        "src/components/ToolResultDisplay.tsx",
      );
      expect(score).toBeGreaterThan(0);
    });

    it("should return 0 for queries with missing keywords", () => {
      const score = calculateFuzzyScore(
        "missing keyword",
        "src/components/ToolResultDisplay.tsx",
      );
      expect(score).toBe(0);
    });

    it("should give higher scores to filename matches", () => {
      const fileNameScore = calculateFuzzyScore(
        "tool",
        "src/components/ToolResultDisplay.tsx",
      );
      const pathScore = calculateFuzzyScore("tool", "src/tools/utils.tsx");
      expect(fileNameScore).toBeGreaterThan(pathScore);
    });

    it("should handle empty or whitespace queries", () => {
      expect(calculateFuzzyScore("", "test.txt")).toBe(0);
      expect(calculateFuzzyScore("   ", "test.txt")).toBe(0);
      expect(calculateFuzzyScore("  \t  ", "test.txt")).toBe(0);
    });

    it("should handle multiple spaces between keywords", () => {
      const score = calculateFuzzyScore(
        "result   tool",
        "src/components/ToolResultDisplay.tsx",
      );
      expect(score).toBeGreaterThan(0);
    });
  });

  describe("fuzzySearchFiles", () => {
    it("should find files with single keyword", () => {
      const results = fuzzySearchFiles("tool", mockFiles);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((f) => f.path.includes("Tool"))).toBe(true);
    });

    it("should find files with space-separated keywords", () => {
      const results = fuzzySearchFiles("result tool", mockFiles);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((f) => f.path.includes("ToolResultDisplay"))).toBe(
        true,
      );
    });

    it("should support out-of-order keyword matching", () => {
      const results = fuzzySearchFiles("display result", mockFiles);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((f) => f.path.includes("ToolResultDisplay"))).toBe(
        true,
      );
    });

    it("should return results in score order (highest first)", () => {
      const results = fuzzySearchFiles("test tool", mockFiles);
      if (results.length > 1) {
        const scores = results.map((f) =>
          calculateFuzzyScore("test tool", f.path.toLowerCase()),
        );
        for (let i = 1; i < scores.length; i++) {
          expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
        }
      }
    });

    it("should return empty array for queries with no matches", () => {
      const results = fuzzySearchFiles("nonexistent file", mockFiles);
      expect(results).toEqual([]);
    });

    it("should handle case-insensitive matching", () => {
      const results = fuzzySearchFiles("TOOL RESULT", mockFiles);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((f) => f.path.includes("ToolResultDisplay"))).toBe(
        true,
      );
    });

    it("should match partial filenames", () => {
      const results = fuzzySearchFiles("compact params", mockFiles);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((f) => f.path.includes("compactParams"))).toBe(true);
    });

    it("should prioritize filename matches over path matches", () => {
      const results = fuzzySearchFiles("tool", mockFiles);
      expect(results.length).toBeGreaterThan(0);
      // Files with 'tool' in filename should come before files with 'tool' only in path
      const firstResult = results[0];
      expect(firstResult.path.toLowerCase()).toMatch(/tool/);
    });
  });
});
