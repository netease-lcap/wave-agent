import { describe, it, expect } from "vitest";
import { analyzeEditMismatch } from "../../src/utils/editUtils.js";

describe("analyzeEditMismatch", () => {
  it("should return generic message if no similarity found", () => {
    const content = "line 1\nline 2\nline 3";
    const search = "completely\ndifferent";
    const result = analyzeEditMismatch(content, search);
    expect(result).toBe(
      "old_string not found in file (no similar block found)",
    );
  });

  it("should highlight a single line mismatch", () => {
    const content = "const x = 1;\nconst y = 3;\nreturn x + y;";
    const search = "const x = 1;\nconst y = 2;\nreturn x + y;";
    const result = analyzeEditMismatch(content, search);

    expect(result).toContain("Best partial match found at line 1:");
    expect(result).toContain("   1 | const x = 1;");
    expect(result).toContain("   2 | - const y = 2;");
    expect(result).toContain("   2 | + const y = 3;");
    expect(result).toContain("   3 | return x + y;");
  });

  it("should find the best match among multiple candidates", () => {
    const content = "block 1\nline A\nline B\n\nblock 2\nline A\nline C";
    const search = "line A\nline B";
    const result = analyzeEditMismatch(content, search);

    expect(result).toContain("Best partial match found at line 2:");
    expect(result).toContain("   2 | line A");
    expect(result).toContain("   3 | line B");
  });

  it("should handle indentation mismatches explicitly", () => {
    const content = "  const x = 1;";
    const search = "const x = 1;";
    const result = analyzeEditMismatch(content, search);

    expect(result).toContain("- const x = 1;");
    expect(result).toContain("+   const x = 1;");
  });
});
