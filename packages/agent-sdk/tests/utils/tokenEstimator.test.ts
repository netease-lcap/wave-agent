import { describe, it, expect } from "vitest";
import {
  estimateTokenCount,
  exceedsTokenThreshold,
  getTokenUsageDescription,
} from "../../src/utils/tokenEstimator.js";

describe("tokenEstimator", () => {
  describe("estimateTokenCount", () => {
    it("should return 0 for empty string", () => {
      expect(estimateTokenCount("")).toBe(0);
      expect(estimateTokenCount("   ")).toBe(1); // Whitespace adjustment
    });

    it("should estimate tokens for simple text", () => {
      // "hello world" = 11 chars, should be ~3 tokens
      const result = estimateTokenCount("hello world");
      expect(result).toBeGreaterThan(2);
      expect(result).toBeLessThan(6);
    });

    it("should estimate tokens for longer text", () => {
      // 400 characters should be around 100 tokens (4 chars per token)
      const longText = "A".repeat(400);
      const result = estimateTokenCount(longText);
      expect(result).toBeGreaterThan(90);
      expect(result).toBeLessThan(110);
    });

    it("should handle mixed content with whitespace", () => {
      const mixedText = "function test() { return 'hello world'; }";
      const result = estimateTokenCount(mixedText);
      expect(result).toBeGreaterThan(8);
      expect(result).toBeLessThan(15);
    });

    it("should handle text with lots of whitespace", () => {
      const spaceyText = "word    another    word    with    spaces";
      const denseText = "wordanotherwordwithspaces";

      const spaceyResult = estimateTokenCount(spaceyText);
      const denseResult = estimateTokenCount(denseText);

      // Both should be reasonable estimates (spacey text might be slightly higher due to space tokens)
      expect(spaceyResult).toBeGreaterThan(5);
      expect(denseResult).toBeGreaterThan(5);
      expect(spaceyResult).toBeLessThan(15);
      expect(denseResult).toBeLessThan(15);
    });
  });

  describe("exceedsTokenThreshold", () => {
    it("should use default threshold of 20000", () => {
      const smallText = "small";
      const hugeText = "A".repeat(100000); // ~25k tokens

      expect(exceedsTokenThreshold(smallText)).toBe(false);
      expect(exceedsTokenThreshold(hugeText)).toBe(true);
    });

    it("should respect custom threshold", () => {
      const mediumText = "A".repeat(400); // ~100 tokens

      expect(exceedsTokenThreshold(mediumText, 50)).toBe(true);
      expect(exceedsTokenThreshold(mediumText, 200)).toBe(false);
    });

    it("should handle edge cases", () => {
      expect(exceedsTokenThreshold("", 1)).toBe(false);
      expect(exceedsTokenThreshold("A", 0)).toBe(true);
    });
  });

  describe("getTokenUsageDescription", () => {
    it("should describe small usage correctly", () => {
      const smallText = "hello world";
      const description = getTokenUsageDescription(smallText, 1000);

      expect(description).toContain("within");
      expect(description).toContain("1,000");
      expect(description).toMatch(/\d+ tokens/);
    });

    it("should describe large usage correctly", () => {
      const largeText = "A".repeat(100000); // ~25k tokens
      const description = getTokenUsageDescription(largeText, 20000);

      expect(description).toContain("exceeds");
      expect(description).toContain("20,000");
      expect(description).toMatch(/[\d,]+ tokens/);
    });

    it("should format numbers with commas", () => {
      const hugeText = "A".repeat(200000); // ~50k tokens
      const description = getTokenUsageDescription(hugeText);

      expect(description).toMatch(/\d{2},\d{3} tokens/); // Should have comma formatting
      expect(description).toContain("20,000 limit");
    });

    it("should handle custom thresholds", () => {
      const text = "A".repeat(4000); // ~1k tokens
      const description = getTokenUsageDescription(text, 500);

      expect(description).toContain("exceeds");
      expect(description).toContain("500 limit");
    });
  });
});
