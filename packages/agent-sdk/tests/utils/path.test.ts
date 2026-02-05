import { describe, it, expect } from "vitest";
import { resolvePath, getDisplayPath, isBinary } from "../../src/utils/path.js";
import { homedir } from "os";
import { resolve } from "path";

describe("path utils", () => {
  describe("isBinary", () => {
    it("should return true for binary extensions", () => {
      expect(isBinary("test.png")).toBe(true);
      expect(isBinary("test.JPG")).toBe(true);
      expect(isBinary("test.pdf")).toBe(true);
      expect(isBinary("test.exe")).toBe(true);
    });

    it("should return false for non-binary extensions", () => {
      expect(isBinary("test.ts")).toBe(false);
      expect(isBinary("test.txt")).toBe(false);
      expect(isBinary("test.json")).toBe(false);
    });

    it("should return false for files without extension", () => {
      expect(isBinary("LICENSE")).toBe(false);
      expect(isBinary("README")).toBe(false);
    });
  });

  describe("resolvePath", () => {
    it("should handle tilde home directory expansion", () => {
      const result = resolvePath("~/.gitconfig", "/test/workdir");
      const expected = resolve(homedir(), ".gitconfig");
      expect(result).toBe(expected);
    });

    it("should handle tilde with subdirectory", () => {
      const result = resolvePath("~/Documents/test.txt", "/test/workdir");
      const expected = resolve(homedir(), "Documents/test.txt");
      expect(result).toBe(expected);
    });

    it("should handle just tilde", () => {
      const result = resolvePath("~", "/test/workdir");
      const expected = homedir();
      expect(result).toBe(expected);
    });

    it("should handle relative paths with workdir", () => {
      const result = resolvePath("test.txt", "/workspace");
      const expected = resolve("/workspace", "test.txt");
      expect(result).toBe(expected);
    });

    it("should handle absolute paths", () => {
      const result = resolvePath("/absolute/path/test.txt", "/test/workdir");
      const expected = resolve("/absolute/path/test.txt");
      expect(result).toBe(expected);
    });

    it("should not treat paths starting with ~ in middle as home directory", () => {
      const result = resolvePath("some~path/file.txt", "/workspace");
      const expected = resolve("/workspace", "some~path/file.txt");
      expect(result).toBe(expected);
    });

    it("should handle relative paths with workdir", () => {
      const result = resolvePath("relative/path/file.txt", "/test/workdir");
      const expected = resolve("/test/workdir", "relative/path/file.txt");
      expect(result).toBe(expected);
    });
  });

  describe("getDisplayPath", () => {
    it("should return relative path when it's shorter and not in parent directory", () => {
      const mockWorkdir = "/Users/test/project";
      const result = getDisplayPath(
        "/Users/test/project/src/utils/path.ts",
        mockWorkdir,
      );
      expect(result).toBe("src/utils/path.ts");
    });

    it("should return absolute path when relative path starts with ..", () => {
      const mockWorkdir = "/Users/test/project";
      const absolutePath = "/Users/test/other-project/file.ts";
      const result = getDisplayPath(absolutePath, mockWorkdir);
      expect(result).toBe(absolutePath);
    });

    it("should return absolute path when relative path is longer", () => {
      const mockWorkdir = "/a";
      const absolutePath = "/b";
      const result = getDisplayPath(absolutePath, mockWorkdir);
      // Relative would be "../b" which is longer than "/b"
      expect(result).toBe(absolutePath);
    });

    it("should return absolute path when relative path equals absolute path length", () => {
      const mockWorkdir = "/Users/test";
      const absolutePath = "/Users/file.ts";
      const result = getDisplayPath(absolutePath, mockWorkdir);
      // Relative would be "../file.ts" which is same length as absolute
      expect(result).toBe(absolutePath);
    });

    it("should handle current directory file", () => {
      const mockWorkdir = "/Users/test/project";
      const result = getDisplayPath(
        "/Users/test/project/package.json",
        mockWorkdir,
      );
      expect(result).toBe("package.json");
    });

    it("should return '.' when path equals current working directory", () => {
      const mockWorkdir = "/Users/test/project";
      const result = getDisplayPath("/Users/test/project", mockWorkdir);
      expect(result).toBe(".");
    });

    it("should handle empty path", () => {
      const result = getDisplayPath("", "/test/workdir");
      expect(result).toBe("");
    });

    it("should handle Windows paths", () => {
      // Skip this test on non-Windows platforms since path.relative behaves differently
      if (process.platform !== "win32") {
        const mockWorkdir = "/Users/test/project";
        const result = getDisplayPath(
          "/Users/test/project/src/file.ts",
          mockWorkdir,
        );
        expect(result).toBe("src/file.ts");
        return;
      }

      const mockWorkdir = "C:\\Users\\test\\project";
      const result = getDisplayPath(
        "C:\\Users\\test\\project\\src\\file.ts",
        mockWorkdir,
      );
      expect(result).toBe("src\\file.ts");
    });

    it("should handle different workdir consistently", () => {
      const customWorkdir = "/custom/workdir";
      const result = getDisplayPath(
        "/custom/workdir/src/utils/file.ts",
        customWorkdir,
      );
      expect(result).toBe("src/utils/file.ts");

      // Test with different path that would be longer as relative
      const absolutePath = "/other/path/file.ts";
      const result2 = getDisplayPath(absolutePath, customWorkdir);
      expect(result2).toBe(absolutePath);
    });
  });
});
