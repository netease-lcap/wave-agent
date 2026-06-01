import { describe, it, expect } from "vitest";
import { analyzeEditMismatch } from "../../src/utils/editUtils.js";

describe("analyzeEditMismatch", () => {
  it("should include the attempted string in error message", () => {
    expect(analyzeEditMismatch("hello")).toBe(
      "String to replace not found in file.\nString: hello",
    );
  });

  it("should truncate long strings", () => {
    const longString = "a".repeat(300);
    const result = analyzeEditMismatch(longString);
    expect(result).toContain("String to replace not found in file.");
    expect(result).toContain("a".repeat(200) + "...");
  });

  it("should not truncate short strings", () => {
    const shortString = "a".repeat(200);
    const result = analyzeEditMismatch(shortString);
    expect(result).not.toContain("...");
  });
});
