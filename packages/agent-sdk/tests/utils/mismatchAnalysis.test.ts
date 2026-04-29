import { describe, it, expect } from "vitest";
import { analyzeEditMismatch } from "../../src/utils/editUtils.js";

describe("analyzeEditMismatch", () => {
  it("should return generic message", () => {
    expect(analyzeEditMismatch()).toBe("old_string not found in file");
  });
});
