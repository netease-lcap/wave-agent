import * as fs from "fs";
import * as path from "path";
import { type Ignore } from "ignore";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { collectGitignoreFiles } from "../../src/utils/fileFilter";

// Mock fs 和 path 模块
vi.mock("fs");
vi.mock("path");

const mockFs = vi.mocked(fs);
const mockPath = vi.mocked(path);

describe("collectGitignoreFiles", () => {
  let mockIgnoreInstance: Partial<Ignore> & { add: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    // Mock ignore 实例
    mockIgnoreInstance = {
      add: vi.fn(),
    } as Partial<Ignore> & { add: ReturnType<typeof vi.fn> };

    // Mock path.join
    mockPath.join.mockImplementation((...args) => args.join("/"));

    // Mock path.relative
    mockPath.relative.mockImplementation((from, to) => {
      if (from === to) return "";
      const fromParts = from.split("/");
      const toParts = to.split("/");

      // Find common prefix
      let commonLength = 0;
      while (
        commonLength < fromParts.length &&
        commonLength < toParts.length &&
        fromParts[commonLength] === toParts[commonLength]
      ) {
        commonLength++;
      }

      return toParts.slice(commonLength).join("/");
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should collect .gitignore from root directory", () => {
    // Setup
    const rootDir = "/project";
    const gitignoreContent = "*.log\nnode_modules/\n";

    mockFs.existsSync.mockImplementation((filePath) => {
      return filePath === "/project/.gitignore";
    });

    mockFs.readFileSync.mockImplementation((filePath) => {
      if (filePath === "/project/.gitignore") {
        return gitignoreContent;
      }
      throw new Error("File not found");
    });

    mockFs.readdirSync.mockReturnValue([]);

    // Execute
    collectGitignoreFiles(rootDir, mockIgnoreInstance as Ignore, rootDir);

    // Verify
    expect(mockFs.existsSync).toHaveBeenCalledWith("/project/.gitignore");
    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      "/project/.gitignore",
      "utf8",
    );
    expect(mockIgnoreInstance.add).toHaveBeenCalledWith(gitignoreContent);
  });

  it("should collect .gitignore from subdirectories with proper path prefixes", () => {
    // Setup
    const rootDir = "/project";
    const subDir = "/project/.husky/_";

    mockFs.existsSync.mockImplementation((filePath) => {
      return filePath === "/project/.husky/_/.gitignore";
    });

    mockFs.readFileSync.mockImplementation((filePath) => {
      if (filePath === "/project/.husky/_/.gitignore") {
        return "_\n";
      }
      throw new Error("File not found");
    });

    mockFs.readdirSync.mockReturnValue([]);

    mockPath.relative.mockReturnValue(".husky/_");

    // Execute
    collectGitignoreFiles(subDir, mockIgnoreInstance as Ignore, rootDir);

    // Verify
    expect(mockFs.existsSync).toHaveBeenCalledWith(
      "/project/.husky/_/.gitignore",
    );
    expect(mockFs.readFileSync).toHaveBeenCalledWith(
      "/project/.husky/_/.gitignore",
      "utf8",
    );
    expect(mockIgnoreInstance.add).toHaveBeenCalledWith([".husky/_/_"]);
  });

  it("should handle rules with leading slash in subdirectories", () => {
    // Setup
    const rootDir = "/project";
    const subDir = "/project/src";

    mockFs.existsSync.mockImplementation((filePath) => {
      return filePath === "/project/src/.gitignore";
    });

    mockFs.readFileSync.mockImplementation((filePath) => {
      if (filePath === "/project/src/.gitignore") {
        return "/temp\n*.tmp\n";
      }
      throw new Error("File not found");
    });

    mockFs.readdirSync.mockReturnValue([]);

    mockPath.relative.mockReturnValue("src");

    // Execute
    collectGitignoreFiles(subDir, mockIgnoreInstance as Ignore, rootDir);

    // Verify
    expect(mockIgnoreInstance.add).toHaveBeenCalledWith([
      "src/temp",
      "src/*.tmp",
    ]);
  });

  it("should skip excluded directories during traversal", () => {
    // Setup
    const rootDir = "/project";

    mockFs.existsSync.mockReturnValue(false);

    // Use vi.fn() to properly mock readdirSync
    const mockReaddirSync = vi.fn();
    mockFs.readdirSync = mockReaddirSync;

    // Mock directory structure with excluded directories
    mockReaddirSync.mockReturnValue([
      { name: ".git", isDirectory: () => true },
      { name: "node_modules", isDirectory: () => true },
      { name: "dist", isDirectory: () => true },
      { name: "build", isDirectory: () => true },
      { name: "src", isDirectory: () => true },
    ]);

    // Execute
    collectGitignoreFiles(rootDir, mockIgnoreInstance as Ignore, rootDir);

    // Verify that only allowed directories are traversed
    expect(mockReaddirSync).toHaveBeenCalledWith("/project", {
      withFileTypes: true,
    });
    expect(mockReaddirSync).toHaveBeenCalledWith("/project/src", {
      withFileTypes: true,
    });

    // Should not traverse excluded directories
    expect(mockReaddirSync).not.toHaveBeenCalledWith("/project/.git", {
      withFileTypes: true,
    });
    expect(mockReaddirSync).not.toHaveBeenCalledWith("/project/node_modules", {
      withFileTypes: true,
    });
    expect(mockReaddirSync).not.toHaveBeenCalledWith("/project/dist", {
      withFileTypes: true,
    });
    expect(mockReaddirSync).not.toHaveBeenCalledWith("/project/build", {
      withFileTypes: true,
    });
  });

  it("should filter out empty lines and comments from .gitignore", () => {
    // Setup
    const rootDir = "/project";
    const gitignoreContent = `
# This is a comment
*.log

# Another comment
node_modules/

`;

    mockFs.existsSync.mockImplementation((filePath) => {
      return filePath === "/project/src/.gitignore";
    });

    mockFs.readFileSync.mockImplementation((filePath) => {
      if (filePath === "/project/src/.gitignore") {
        return gitignoreContent;
      }
      throw new Error("File not found");
    });

    mockFs.readdirSync.mockReturnValue([]);

    mockPath.relative.mockReturnValue("src");

    // Execute
    collectGitignoreFiles(
      "/project/src",
      mockIgnoreInstance as Ignore,
      rootDir,
    );

    // Verify that only non-empty, non-comment lines are processed
    expect(mockIgnoreInstance.add).toHaveBeenCalledWith([
      "src/*.log",
      "src/node_modules/",
    ]);
  });

  it("should handle errors gracefully when reading .gitignore files", () => {
    // Setup
    const rootDir = "/project";

    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error("Permission denied");
    });
    mockFs.readdirSync.mockReturnValue([]);

    // Execute - should not throw
    expect(() => {
      collectGitignoreFiles(rootDir, mockIgnoreInstance as Ignore, rootDir);
    }).not.toThrow();

    // Verify that ignore.add was not called due to error
    expect(mockIgnoreInstance.add).not.toHaveBeenCalled();
  });

  it("should handle directory traversal errors gracefully", () => {
    // Setup
    const rootDir = "/project";

    mockFs.existsSync.mockReturnValue(false);
    mockFs.readdirSync.mockImplementation(() => {
      throw new Error("Permission denied");
    });

    // Execute - should not throw
    expect(() => {
      collectGitignoreFiles(rootDir, mockIgnoreInstance as Ignore, rootDir);
    }).not.toThrow();
  });

  it("should handle nested directory structure correctly", () => {
    // Setup
    const rootDir = "/project";

    mockFs.existsSync.mockImplementation((filePath) => {
      return filePath === "/project/a/b/c/.gitignore";
    });

    mockFs.readFileSync.mockImplementation((filePath) => {
      if (filePath === "/project/a/b/c/.gitignore") {
        return "*.test\n";
      }
      throw new Error("File not found");
    });

    // Use vi.fn() to properly mock readdirSync
    const mockReaddirSync = vi.fn();
    mockFs.readdirSync = mockReaddirSync;

    // Mock nested directory traversal
    mockReaddirSync
      .mockReturnValueOnce([{ name: "a", isDirectory: () => true }])
      .mockReturnValueOnce([{ name: "b", isDirectory: () => true }])
      .mockReturnValueOnce([{ name: "c", isDirectory: () => true }])
      .mockReturnValueOnce([]);

    mockPath.relative.mockImplementation((from, to) => {
      if (from === "/project" && to === "/project/a/b/c") {
        return "a/b/c";
      }
      return "";
    });

    // Execute
    collectGitignoreFiles(rootDir, mockIgnoreInstance as Ignore, rootDir);

    // Verify
    expect(mockIgnoreInstance.add).toHaveBeenCalledWith(["a/b/c/*.test"]);
  });
});
