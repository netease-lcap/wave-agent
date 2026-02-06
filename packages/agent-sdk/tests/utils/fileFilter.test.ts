import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  getAllIgnorePatterns,
  getGlobIgnorePatterns,
  parseGitignoreToGlob,
  COMMON_IGNORE_PATTERNS,
} from "../../src/utils/fileFilter.js";

vi.mock("fs", () => ({
  readdirSync: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

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

  describe("parseGitignoreToGlob", () => {
    it("should parse .gitignore files and convert to glob patterns", () => {
      const workdir = "/mock/workdir";
      const gitignoreContent = `
# comment
node_modules/
dist/
*.log
!important.log
/absolute-path
relative/path/
      `;

      vi.mocked(fs.readdirSync).mockReturnValue([
        {
          name: ".gitignore",
          isFile: () => true,
          isDirectory: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        },
      ] as unknown as fs.Dirent<never>[]);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(gitignoreContent);

      const patterns = parseGitignoreToGlob(workdir);

      expect(patterns).toContain("node_modules/**");
      expect(patterns).toContain("**/node_modules/**");
      expect(patterns).toContain("dist/**");
      expect(patterns).toContain("**/dist/**");
      expect(patterns).toContain("*.log");
      expect(patterns).toContain("absolute-path");
      expect(patterns).toContain("relative/path/**");
      expect(patterns).not.toContain("important.log");
      expect(patterns).not.toContain("# comment");
    });

    it("should handle subdirectories with .gitignore", () => {
      const workdir = "/mock/workdir";
      const subDir = path.join(workdir, "subdir");
      const gitignoreContent = "local-ignore";

      vi.mocked(fs.readdirSync).mockImplementation(
        (dir: string | Buffer | URL) => {
          if (dir.toString() === workdir) {
            return [
              {
                name: "subdir",
                isFile: () => false,
                isDirectory: () => true,
                isBlockDevice: () => false,
                isCharacterDevice: () => false,
                isSymbolicLink: () => false,
                isFIFO: () => false,
                isSocket: () => false,
              },
            ] as unknown as fs.Dirent<never>[];
          }
          if (dir.toString() === subDir) {
            return [
              {
                name: ".gitignore",
                isFile: () => true,
                isDirectory: () => false,
                isBlockDevice: () => false,
                isCharacterDevice: () => false,
                isSymbolicLink: () => false,
                isFIFO: () => false,
                isSocket: () => false,
              },
            ] as unknown as fs.Dirent<never>[];
          }
          return [];
        },
      );

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(gitignoreContent);

      const patterns = parseGitignoreToGlob(workdir);
      expect(patterns).toContain("subdir/local-ignore");
    });

    it("should handle errors gracefully", () => {
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });
      const patterns = parseGitignoreToGlob("/mock/workdir");
      expect(patterns).toEqual([]);
    });

    it("should respect maxDepth", () => {
      const workdir = "/mock/workdir";
      vi.mocked(fs.readdirSync).mockClear();
      vi.mocked(fs.readdirSync).mockReturnValue([
        {
          name: "dir1",
          isFile: () => false,
          isDirectory: () => true,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        },
      ] as unknown as fs.Dirent<never>[]);

      // This would cause infinite recursion if not for maxDepth
      parseGitignoreToGlob(workdir);
      // Initial call + 5 levels of recursion = 6 calls
      // Wait, if maxDepth is 5:
      // Call 1 (depth 5) -> readdir -> finds dir1
      // Call 2 (depth 4) -> readdir -> finds dir1
      // Call 3 (depth 3) -> readdir -> finds dir1
      // Call 4 (depth 2) -> readdir -> finds dir1
      // Call 5 (depth 1) -> readdir -> finds dir1
      // Call 6 (depth 0) -> returns [] immediately
      // So readdirSync should be called 5 times.
      expect(fs.readdirSync).toHaveBeenCalledTimes(5);
    });
  });

  describe("getGlobIgnorePatterns", () => {
    it("should return common patterns when no workdir is provided", () => {
      const patterns = getGlobIgnorePatterns();
      expect(patterns).toEqual(getAllIgnorePatterns());
    });

    it("should include gitignore patterns when workdir is provided", () => {
      const workdir = "/mock/workdir";
      vi.mocked(fs.readdirSync).mockReturnValue([
        {
          name: ".gitignore",
          isFile: () => true,
          isDirectory: () => false,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
        },
      ] as unknown as fs.Dirent<never>[]);
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("node_modules/");

      const patterns = getGlobIgnorePatterns(workdir);
      expect(patterns.length).toBeGreaterThan(getAllIgnorePatterns().length);
      expect(patterns).toContain("node_modules/**");
    });
  });
});
