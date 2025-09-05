import { describe, it, expect } from "vitest";
import {
  fuzzySearchFiles,
  calculateFuzzyScore,
  scoreAndSortFiles,
} from "../../src/utils/fileScoring";
import type { FileTreeNode } from "../../src/types/common";

describe("fileScoring", () => {
  const mockFiles: FileTreeNode[] = [
    {
      path: "src/components/button.tsx",
      label: "button.tsx",
      children: [],
      fileSize: 1200,
    },
    {
      path: "src/utils/stringutils.ts",
      label: "stringutils.ts",
      children: [],
      fileSize: 800,
    },
    {
      path: "tests/components/button.test.tsx",
      label: "button.test.tsx",
      children: [],
      fileSize: 1500,
    },
    {
      path: "src/hooks/uselocalstorage.ts",
      label: "uselocalstorage.ts",
      children: [],
      fileSize: 600,
    },
    {
      path: "src/pages/homepage.tsx",
      label: "homepage.tsx",
      children: [],
      fileSize: 2000,
    },
    {
      path: "src/components/forms/loginform.tsx",
      label: "loginform.tsx",
      children: [],
      fileSize: 1800,
    },
    {
      path: "tests/utils/stringutils.test.ts",
      label: "stringutils.test.ts",
      children: [],
      fileSize: 900,
    },
  ];

  describe("calculateFuzzyScore", () => {
    it("should handle single keyword queries", () => {
      expect(
        calculateFuzzyScore("button", "src/components/button.tsx"),
      ).toBeGreaterThan(0);
      expect(
        calculateFuzzyScore("utils", "src/utils/stringutils.ts"),
      ).toBeGreaterThan(0);
      expect(calculateFuzzyScore("xyz", "src/components/button.tsx")).toBe(0);
    });

    it("should handle multiple keyword queries", () => {
      // Both keywords should match
      expect(
        calculateFuzzyScore("button test", "tests/components/button.test.tsx"),
      ).toBeGreaterThan(0);
      expect(
        calculateFuzzyScore("string utils", "src/utils/stringutils.ts"),
      ).toBeGreaterThan(0);
      expect(
        calculateFuzzyScore("utils test", "tests/utils/stringutils.test.ts"),
      ).toBeGreaterThan(0);

      // Partial match should have lower score or be filtered out
      expect(
        calculateFuzzyScore("button xyz", "tests/components/button.test.tsx"),
      ).toBeLessThan(
        calculateFuzzyScore("button test", "tests/components/button.test.tsx"),
      );
    });

    it("should handle queries with extra spaces", () => {
      expect(
        calculateFuzzyScore(
          "  button   test  ",
          "tests/components/button.test.tsx",
        ),
      ).toBeGreaterThan(0);
      expect(
        calculateFuzzyScore("button test", "tests/components/button.test.tsx"),
      ).toEqual(
        calculateFuzzyScore(
          "  button   test  ",
          "tests/components/button.test.tsx",
        ),
      );
    });

    it("should return 0 for empty queries", () => {
      expect(calculateFuzzyScore("", "src/components/button.tsx")).toBe(0);
      expect(calculateFuzzyScore("   ", "src/components/button.tsx")).toBe(0);
    });

    it("should prioritize exact matches", () => {
      const exactScore = calculateFuzzyScore(
        "button.tsx",
        "src/components/button.tsx",
      );
      const partialScore = calculateFuzzyScore(
        "button",
        "src/components/button.tsx",
      );
      expect(exactScore).toBeGreaterThan(partialScore);
    });
  });

  describe("fuzzySearchFiles", () => {
    it("should search with single keyword", () => {
      const results = fuzzySearchFiles("button", mockFiles);
      expect(results.length).toBeGreaterThan(0);
      expect(results.some((file) => file.path.includes("button"))).toBe(true);
    });

    it("should search with multiple keywords", () => {
      const results = fuzzySearchFiles("button test", mockFiles);
      expect(results.length).toBeGreaterThan(0);
      // Should find files that contain both "button" and "test"
      expect(
        results.some(
          (file) =>
            file.path.toLowerCase().includes("button") &&
            file.path.toLowerCase().includes("test"),
        ),
      ).toBe(true);
    });

    it("should handle queries with extra spaces", () => {
      const normalResults = fuzzySearchFiles("string utils", mockFiles);
      const spacedResults = fuzzySearchFiles("  string   utils  ", mockFiles);
      expect(normalResults).toEqual(spacedResults);
    });

    it("should return empty array for no matches", () => {
      const results = fuzzySearchFiles("nonexistent", mockFiles);
      expect(results).toEqual([]);
    });

    it("should order results by relevance", () => {
      const results = fuzzySearchFiles("utils", mockFiles);
      expect(results.length).toBeGreaterThan(1);
      // Results should be ordered by score (descending)
      for (let i = 1; i < results.length; i++) {
        const currentScore = calculateFuzzyScore(
          "utils",
          results[i].path.toLowerCase(),
        );
        const previousScore = calculateFuzzyScore(
          "utils",
          results[i - 1].path.toLowerCase(),
        );
        expect(currentScore).toBeLessThanOrEqual(previousScore);
      }
    });

    it("should find files with all keywords in multi-keyword search", () => {
      const results = fuzzySearchFiles("src components", mockFiles);
      expect(results.length).toBeGreaterThan(0);
      // All results should contain both "src" and "components"
      results.forEach((file) => {
        const path = file.path.toLowerCase();
        expect(path.includes("src") && path.includes("components")).toBe(true);
      });
    });
  });

  describe("scoreAndSortFiles", () => {
    it("should return all files with scores when query is provided", () => {
      const results = scoreAndSortFiles("button", mockFiles);
      expect(results.length).toBe(mockFiles.length);
      expect(results.every((result) => typeof result.score === "number")).toBe(
        true,
      );
    });

    it("should return files with score 0 for empty query", () => {
      const results = scoreAndSortFiles("", mockFiles);
      expect(results.length).toBe(mockFiles.length);
      expect(results.every((result) => result.score === 0)).toBe(true);
    });

    it("should sort by score in descending order", () => {
      const results = scoreAndSortFiles("utils", mockFiles);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });

    it("should handle multi-keyword queries", () => {
      const results = scoreAndSortFiles("test utils", mockFiles);
      expect(results.length).toBe(mockFiles.length);

      // Files matching both keywords should have higher scores
      const matchingFiles = results.filter((r) => r.score > 0);
      expect(matchingFiles.length).toBeGreaterThan(0);

      // Verify that files with both keywords have higher scores
      const bestMatch = results[0];
      expect(bestMatch.file.path.toLowerCase()).toMatch(
        /test.*utils|utils.*test/,
      );
    });
  });
});
