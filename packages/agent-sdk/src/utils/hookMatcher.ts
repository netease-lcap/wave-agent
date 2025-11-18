/**
 * Hook Pattern Matcher
 *
 * Provides pattern matching functionality for hook tool name matching.
 * Supports exact matching, wildcard patterns, and pipe-separated alternatives.
 */

import { minimatch } from "minimatch";

export class HookMatcher {
  /**
   * Test if pattern matches tool name
   * Supports multiple matching strategies:
   * - Exact matching: "Edit" matches "Edit"
   * - Pipe alternatives: "Edit|Write" matches "Edit" or "Write"
   * - Glob patterns: "Edit*" matches "EditFile", "EditText", etc.
   * - Case insensitive matching
   */
  matches(pattern: string, toolName: string): boolean {
    if (!pattern || !toolName) return false;

    // Handle pipe-separated alternatives (e.g., "Edit|Write|Delete")
    if (pattern.includes("|")) {
      const alternatives = pattern.split("|").map((alt) => alt.trim());
      return alternatives.some((alt) => this.matchesSingle(alt, toolName));
    }

    return this.matchesSingle(pattern, toolName);
  }

  /**
   * Match a single pattern against tool name
   */
  private matchesSingle(pattern: string, toolName: string): boolean {
    // Exact match (case insensitive)
    if (pattern.toLowerCase() === toolName.toLowerCase()) {
      return true;
    }

    // Glob pattern matching using minimatch
    try {
      return minimatch(toolName, pattern, {
        nocase: true, // Case insensitive
        noglobstar: false, // Allow ** patterns
        nonegate: true, // Disable negation for security
      });
    } catch {
      // Invalid pattern, fall back to exact match
      return false;
    }
  }

  /**
   * Validate pattern syntax
   */
  isValidPattern(pattern: string): boolean {
    if (!pattern || typeof pattern !== "string") return false;

    // Empty pattern is invalid
    if (pattern.trim().length === 0) return false;

    // Handle pipe-separated alternatives
    if (pattern.includes("|")) {
      const alternatives = pattern.split("|").map((alt) => alt.trim());
      return (
        alternatives.length > 0 &&
        alternatives.every(
          (alt) => alt.length > 0 && this.isValidSinglePattern(alt),
        )
      );
    }

    return this.isValidSinglePattern(pattern);
  }

  /**
   * Validate single pattern syntax
   */
  private isValidSinglePattern(pattern: string): boolean {
    // Basic validation - non-empty string
    if (!pattern || pattern.trim().length === 0) return false;

    // Check for dangerous characters that could be used for command injection
    // Note: [ ] are allowed for glob patterns
    const dangerousChars = /[;&|`$(){}><]/;
    if (dangerousChars.test(pattern)) return false;

    // Validate glob pattern syntax using minimatch
    try {
      // Test with a dummy string to validate pattern
      minimatch("test", pattern, { nocase: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get pattern type for optimization
   */
  getPatternType(pattern: string): "exact" | "glob" | "regex" | "alternatives" {
    if (!pattern) return "exact";

    // Check for pipe alternatives first
    if (pattern.includes("|")) {
      return "alternatives";
    }

    // Check for regex patterns first (before glob check)
    if (
      pattern.startsWith("/") &&
      pattern.endsWith("/") &&
      pattern.length > 2
    ) {
      return "regex";
    }

    // Check for glob patterns
    if (
      pattern.includes("*") ||
      pattern.includes("?") ||
      pattern.includes("[")
    ) {
      return "glob";
    }

    return "exact";
  }

  /**
   * Get all tool names that would match this pattern from a given list
   * Useful for testing and validation
   */
  getMatches(pattern: string, toolNames: string[]): string[] {
    return toolNames.filter((toolName) => this.matches(pattern, toolName));
  }

  /**
   * Optimize pattern for repeated matching
   * Returns a compiled matcher function for performance
   */
  compile(pattern: string): (toolName: string) => boolean {
    if (!this.isValidPattern(pattern)) {
      return () => false;
    }

    const patternType = this.getPatternType(pattern);

    switch (patternType) {
      case "exact": {
        const lowerPattern = pattern.toLowerCase();
        return (toolName: string) => toolName.toLowerCase() === lowerPattern;
      }

      case "alternatives": {
        const alternatives = pattern
          .split("|")
          .map((alt) => alt.trim().toLowerCase());
        return (toolName: string) => {
          const lowerTool = toolName.toLowerCase();
          return alternatives.some(
            (alt) =>
              lowerTool === alt || minimatch(toolName, alt, { nocase: true }),
          );
        };
      }

      case "glob":
        return (toolName: string) =>
          minimatch(toolName, pattern, { nocase: true });

      default:
        return (toolName: string) => this.matches(pattern, toolName);
    }
  }
}
