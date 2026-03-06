import { describe, it, expect } from "vitest";
import {
  getAllIgnorePatterns,
  COMMON_IGNORE_PATTERNS,
} from "../../src/utils/fileFilter.js";

describe("fileFilter", () => {
  describe("getAllIgnorePatterns", () => {
    it("should return all common ignore patterns", () => {
      const patterns = getAllIgnorePatterns();
      expect(patterns).toContain("node_modules/**");
      expect(patterns).toContain("*.log");
      expect(patterns).toContain(".vscode/**");
      expect(patterns).toContain("desktop.ini");
      expect(patterns.length).toBe(
        COMMON_IGNORE_PATTERNS.dependencies.length +
          COMMON_IGNORE_PATTERNS.cache.length +
          COMMON_IGNORE_PATTERNS.editor.length +
          COMMON_IGNORE_PATTERNS.os.length,
      );
    });
  });
});
