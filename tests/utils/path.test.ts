import { describe, it, expect, vi, afterEach } from "vitest";
import { resolvePath, getDisplayPath } from "../../src/utils/path";
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

  describe("getDisplayPath", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("should return relative path when it's shorter and not in parent directory", () => {
      const mockCwd = "/Users/test/project";
      vi.spyOn(process, "cwd").mockReturnValue(mockCwd);

      const result = getDisplayPath("/Users/test/project/src/utils/path.ts");
      expect(result).toBe("src/utils/path.ts");
    });

    it("should return absolute path when relative path starts with ..", () => {
      const mockCwd = "/Users/test/project";
      vi.spyOn(process, "cwd").mockReturnValue(mockCwd);

      const absolutePath = "/Users/test/other-project/file.ts";
      const result = getDisplayPath(absolutePath);
      expect(result).toBe(absolutePath);
    });

    it("should return absolute path when relative path is longer", () => {
      const mockCwd = "/a";
      vi.spyOn(process, "cwd").mockReturnValue(mockCwd);

      const absolutePath = "/b";
      const result = getDisplayPath(absolutePath);
      // Relative would be "../b" which is longer than "/b"
      expect(result).toBe(absolutePath);
    });

    it("should return absolute path when relative path equals absolute path length", () => {
      const mockCwd = "/Users/test";
      vi.spyOn(process, "cwd").mockReturnValue(mockCwd);

      const absolutePath = "/Users/file.ts";
      const result = getDisplayPath(absolutePath);
      // Relative would be "../file.ts" which is same length as absolute
      expect(result).toBe(absolutePath);
    });

    it("should handle current directory file", () => {
      const mockCwd = "/Users/test/project";
      vi.spyOn(process, "cwd").mockReturnValue(mockCwd);

      const result = getDisplayPath("/Users/test/project/package.json");
      expect(result).toBe("package.json");
    });

    it("should handle process.cwd() throwing error", () => {
      vi.spyOn(process, "cwd").mockImplementation(() => {
        throw new Error("Access denied");
      });

      const absolutePath = "/Users/test/file.ts";
      const result = getDisplayPath(absolutePath);
      expect(result).toBe(absolutePath);
    });

    it("should return original path when input is empty", () => {
      const result = getDisplayPath("");
      expect(result).toBe("");
    });

    it("should handle Windows paths", () => {
      // Skip this test on non-Windows platforms since path.relative behaves differently
      if (process.platform !== "win32") {
        const mockCwd = "/Users/test/project";
        vi.spyOn(process, "cwd").mockReturnValue(mockCwd);

        const result = getDisplayPath("/Users/test/project/src/file.ts");
        expect(result).toBe("src/file.ts");
        return;
      }

      const mockCwd = "C:\\Users\\test\\project";
      vi.spyOn(process, "cwd").mockReturnValue(mockCwd);

      const result = getDisplayPath("C:\\Users\\test\\project\\src\\file.ts");
      expect(result).toBe("src\\file.ts");
    });
  });
});
