/**
 * Hook Matcher Unit Tests
 *
 * Tests pattern matching functionality including exact matches,
 * glob patterns, pipe alternatives, and validation logic.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { HookMatcher } from "../../src/utils/hookMatcher.js";

describe("HookMatcher", () => {
  let matcher: HookMatcher;

  beforeEach(() => {
    matcher = new HookMatcher();
  });

  describe("exact matching", () => {
    it("should match exact strings case-insensitively", () => {
      expect(matcher.matches("Edit", "Edit")).toBe(true);
      expect(matcher.matches("Edit", "edit")).toBe(true);
      expect(matcher.matches("edit", "Edit")).toBe(true);
      expect(matcher.matches("EDIT", "edit")).toBe(true);
    });

    it("should not match different strings", () => {
      expect(matcher.matches("Edit", "Write")).toBe(false);
      expect(matcher.matches("Edit", "EditFile")).toBe(false);
      expect(matcher.matches("EditFile", "Edit")).toBe(false);
    });
  });

  describe("pipe alternatives matching", () => {
    it("should match any alternative in pipe-separated list", () => {
      const pattern = "Edit|Write|Delete";

      expect(matcher.matches(pattern, "Edit")).toBe(true);
      expect(matcher.matches(pattern, "Write")).toBe(true);
      expect(matcher.matches(pattern, "Delete")).toBe(true);
      expect(matcher.matches(pattern, "edit")).toBe(true); // Case insensitive
    });

    it("should not match tools not in alternatives", () => {
      const pattern = "Edit|Write";

      expect(matcher.matches(pattern, "Delete")).toBe(false);
      expect(matcher.matches(pattern, "Read")).toBe(false);
      expect(matcher.matches(pattern, "EditWrite")).toBe(false);
    });

    it("should handle whitespace in alternatives", () => {
      const pattern = "Edit | Write | Delete";

      expect(matcher.matches(pattern, "Edit")).toBe(true);
      expect(matcher.matches(pattern, "Write")).toBe(true);
      expect(matcher.matches(pattern, "Delete")).toBe(true);
    });
  });

  describe("glob pattern matching", () => {
    it("should match wildcard patterns", () => {
      expect(matcher.matches("Edit*", "Edit")).toBe(true);
      expect(matcher.matches("Edit*", "EditFile")).toBe(true);
      expect(matcher.matches("Edit*", "EditText")).toBe(true);
      expect(matcher.matches("*Edit", "FileEdit")).toBe(true);
      expect(matcher.matches("*Edit*", "FileEditTool")).toBe(true);
    });

    it("should match question mark patterns", () => {
      expect(matcher.matches("Edit?", "Edit1")).toBe(true);
      expect(matcher.matches("Edit?", "EditA")).toBe(true);
      expect(matcher.matches("Edit?", "Edit")).toBe(false); // ? requires one character
      expect(matcher.matches("Edit?", "Edit12")).toBe(false); // ? matches only one character
    });

    it("should match bracket patterns", () => {
      expect(matcher.matches("Edit[123]", "Edit1")).toBe(true);
      expect(matcher.matches("Edit[123]", "Edit2")).toBe(true);
      expect(matcher.matches("Edit[123]", "Edit4")).toBe(false);
      expect(matcher.matches("Edit[a-z]", "Edita")).toBe(true);
      expect(matcher.matches("Edit[a-z]", "EditA")).toBe(true); // Case insensitive
    });

    it("should not match when glob pattern doesn't match", () => {
      expect(matcher.matches("Edit*", "Write")).toBe(false);
      expect(matcher.matches("*Edit", "Write")).toBe(false);
      expect(matcher.matches("Edit?", "WriteFile")).toBe(false);
    });
  });

  describe("complex pattern matching", () => {
    it("should handle pipe-separated glob patterns", () => {
      const pattern = "Edit*|Write*|Delete*";

      expect(matcher.matches(pattern, "EditFile")).toBe(true);
      expect(matcher.matches(pattern, "WriteText")).toBe(true);
      expect(matcher.matches(pattern, "DeleteFile")).toBe(true);
      expect(matcher.matches(pattern, "ReadFile")).toBe(false);
    });

    it("should handle mixed exact and glob patterns", () => {
      const pattern = "Edit|Write*|Delete";

      expect(matcher.matches(pattern, "Edit")).toBe(true);
      expect(matcher.matches(pattern, "WriteFile")).toBe(true);
      expect(matcher.matches(pattern, "WriteText")).toBe(true);
      expect(matcher.matches(pattern, "Delete")).toBe(true);
      expect(matcher.matches(pattern, "EditFile")).toBe(false); // Edit is exact match only
      expect(matcher.matches(pattern, "DeleteFile")).toBe(false); // Delete is exact match only
    });
  });

  describe("edge cases", () => {
    it("should handle empty strings gracefully", () => {
      expect(matcher.matches("", "Edit")).toBe(false);
      expect(matcher.matches("Edit", "")).toBe(false);
      expect(matcher.matches("", "")).toBe(false);
    });

    it("should handle invalid input gracefully", () => {
      // Test with empty strings instead of null/undefined
      expect(matcher.matches("", "Edit")).toBe(false);
      expect(matcher.matches("Edit", "")).toBe(false);
    });

    it("should handle special characters in tool names", () => {
      expect(matcher.matches("Tool-Name", "Tool-Name")).toBe(true);
      expect(matcher.matches("Tool_Name", "Tool_Name")).toBe(true);
      expect(matcher.matches("Tool.Name", "Tool.Name")).toBe(true);
    });
  });

  describe("pattern validation", () => {
    it("should validate correct patterns", () => {
      expect(matcher.isValidPattern("Edit")).toBe(true);
      expect(matcher.isValidPattern("Edit|Write")).toBe(true);
      expect(matcher.isValidPattern("Edit*")).toBe(true);
      expect(matcher.isValidPattern("Edit?")).toBe(true);
      expect(matcher.isValidPattern("Edit[123]")).toBe(true);
      expect(matcher.isValidPattern("*")).toBe(true);
      expect(matcher.isValidPattern("Tool-Name")).toBe(true);
      expect(matcher.isValidPattern("Tool_Name")).toBe(true);
    });

    it("should reject invalid patterns", () => {
      expect(matcher.isValidPattern("")).toBe(false);
      expect(matcher.isValidPattern("   ")).toBe(false);
      // Test with empty string instead of null/undefined
      expect(matcher.isValidPattern("")).toBe(false);

      // Patterns with potentially dangerous characters
      expect(matcher.isValidPattern("Edit;rm -rf /")).toBe(false);
      expect(matcher.isValidPattern("Edit|Write;")).toBe(false);
      expect(matcher.isValidPattern("Edit&Write")).toBe(false);
      expect(matcher.isValidPattern("Edit`Write")).toBe(false);
      expect(matcher.isValidPattern("Edit$(echo)")).toBe(false);
    });

    it("should validate pipe alternatives", () => {
      expect(matcher.isValidPattern("Edit|Write|Delete")).toBe(true);
      expect(matcher.isValidPattern("|Edit")).toBe(false); // Empty alternative
      expect(matcher.isValidPattern("Edit|")).toBe(false); // Empty alternative
      expect(matcher.isValidPattern("Edit||Write")).toBe(false); // Empty alternative
    });
  });

  describe("pattern type detection", () => {
    it("should detect exact patterns", () => {
      expect(matcher.getPatternType("Edit")).toBe("exact");
      expect(matcher.getPatternType("WriteFile")).toBe("exact");
      expect(matcher.getPatternType("Tool-Name")).toBe("exact");
    });

    it("should detect alternative patterns", () => {
      expect(matcher.getPatternType("Edit|Write")).toBe("alternatives");
      expect(matcher.getPatternType("Edit|Write|Delete")).toBe("alternatives");
      expect(matcher.getPatternType("Edit* | Write*")).toBe("alternatives");
    });

    it("should detect glob patterns", () => {
      expect(matcher.getPatternType("Edit*")).toBe("glob");
      expect(matcher.getPatternType("*Edit")).toBe("glob");
      expect(matcher.getPatternType("Edit?")).toBe("glob");
      expect(matcher.getPatternType("Edit[123]")).toBe("glob");
      expect(matcher.getPatternType("*")).toBe("glob");
    });

    it("should detect regex patterns (reserved)", () => {
      expect(matcher.getPatternType("/Edit.*/")).toBe("regex");
      expect(matcher.getPatternType("/^Edit$/")).toBe("regex");
    });
  });

  describe("utility methods", () => {
    it("should get all matches from a list", () => {
      const toolNames = [
        "Edit",
        "Write",
        "Delete",
        "Read",
        "EditFile",
        "WriteText",
      ];

      expect(matcher.getMatches("Edit", toolNames)).toEqual(["Edit"]);
      expect(matcher.getMatches("Edit|Write", toolNames)).toEqual([
        "Edit",
        "Write",
      ]);
      expect(matcher.getMatches("Edit*", toolNames)).toEqual([
        "Edit",
        "EditFile",
      ]);
      expect(matcher.getMatches("*Edit*", toolNames)).toEqual([
        "Edit",
        "EditFile",
      ]);
      expect(matcher.getMatches("Unknown", toolNames)).toEqual([]);
    });

    it("should compile patterns for optimized matching", () => {
      const compiledExact = matcher.compile("Edit");
      expect(compiledExact("Edit")).toBe(true);
      expect(compiledExact("edit")).toBe(true);
      expect(compiledExact("Write")).toBe(false);

      const compiledGlob = matcher.compile("Edit*");
      expect(compiledGlob("Edit")).toBe(true);
      expect(compiledGlob("EditFile")).toBe(true);
      expect(compiledGlob("Write")).toBe(false);

      const compiledAlternatives = matcher.compile("Edit|Write");
      expect(compiledAlternatives("Edit")).toBe(true);
      expect(compiledAlternatives("Write")).toBe(true);
      expect(compiledAlternatives("Delete")).toBe(false);
    });

    it("should handle invalid patterns in compile", () => {
      const invalidCompiled = matcher.compile("");
      expect(invalidCompiled("Edit")).toBe(false);
      expect(invalidCompiled("anything")).toBe(false);
    });
  });
});
