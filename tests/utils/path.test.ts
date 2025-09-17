import { describe, it, expect } from "vitest";
import { resolvePath } from "../../src/utils/path";
import { homedir } from "os";
import { resolve } from "path";

describe("path utils", () => {
  describe("resolvePath", () => {
    it("should handle tilde home directory expansion", () => {
      const result = resolvePath("~/.gitconfig");
      const expected = resolve(homedir(), ".gitconfig");
      expect(result).toBe(expected);
    });

    it("should handle tilde with subdirectory", () => {
      const result = resolvePath("~/Documents/test.txt");
      const expected = resolve(homedir(), "Documents/test.txt");
      expect(result).toBe(expected);
    });

    it("should handle just tilde", () => {
      const result = resolvePath("~");
      const expected = homedir();
      expect(result).toBe(expected);
    });

    it("should handle relative paths with workdir", () => {
      const result = resolvePath("test.txt", "/workspace");
      const expected = resolve("/workspace", "test.txt");
      expect(result).toBe(expected);
    });

    it("should handle absolute paths", () => {
      const result = resolvePath("/absolute/path/test.txt");
      const expected = resolve("/absolute/path/test.txt");
      expect(result).toBe(expected);
    });

    it("should not treat paths starting with ~ in middle as home directory", () => {
      const result = resolvePath("some~path/file.txt", "/workspace");
      const expected = resolve("/workspace", "some~path/file.txt");
      expect(result).toBe(expected);
    });
  });
});
