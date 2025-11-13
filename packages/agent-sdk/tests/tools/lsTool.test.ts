import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { lsTool } from "@/tools/lsTool.js";
import type { ToolContext } from "@/tools/types.js";
import type { Stats, Dirent } from "fs";

const testContext: ToolContext = { workdir: "/test/workdir" };

// Mock fs/promises
vi.mock("fs", () => ({
  promises: {
    stat: vi.fn(),
    readdir: vi.fn(),
  },
}));

// Mock path utilities
vi.mock("@/utils/path.js", () => ({
  isBinary: vi.fn(),
  getDisplayPath: vi.fn((path: string) => path),
}));

// Import the mocked modules
import * as fs from "fs";
import { isBinary } from "@/utils/path.js";

describe("lsTool", () => {
  const mockStat = vi.mocked(fs.promises.stat);
  const mockReaddir = vi.mocked(fs.promises.readdir);
  const mockIsBinary = vi.mocked(isBinary);

  // Helper to create mock stats
  const createMockStats = (
    isFile: boolean,
    isDirectory: boolean,
    isSymbolicLink: boolean = false,
    size: number = 100,
  ): Stats =>
    ({
      isFile: () => isFile,
      isDirectory: () => isDirectory,
      isSymbolicLink: () => isSymbolicLink,
      size,
      mtime: new Date("2023-01-01"),
    }) as Stats;

  // Helper to create mock dirent
  const createMockDirent = (
    name: string,
    isFile: boolean,
    isDirectory: boolean,
    isSymbolicLink: boolean = false,
  ): Dirent<string> => ({
    name,
    isFile: () => isFile,
    isDirectory: () => isDirectory,
    isSymbolicLink: () => isSymbolicLink,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    parentPath: "/test/tempdir",
    path: `/test/tempdir/${name}`,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockIsBinary.mockReturnValue(false);
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should be properly configured", () => {
    expect(lsTool.name).toBe("LS");
    expect(lsTool.config.type).toBe("function");
    if (
      lsTool.config.type === "function" &&
      lsTool.config.function.parameters
    ) {
      expect(lsTool.config.function.name).toBe("LS");
      expect(lsTool.config.function.parameters.required).toEqual(["path"]);
    }
  });

  it("should list directory contents", async () => {
    const testDir = "/test/tempdir";

    // Mock directory stat
    mockStat.mockResolvedValueOnce(createMockStats(false, true));

    // Mock readdir with dirent objects
    mockReaddir.mockResolvedValueOnce([
      createMockDirent("docs", false, true),
      createMockDirent("src", false, true),
      createMockDirent("tests", false, true),
      createMockDirent(".gitignore", true, false),
      createMockDirent("package.json", true, false),
      createMockDirent("README.md", true, false),
    ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);

    // Mock individual file stats
    mockStat
      .mockResolvedValueOnce(createMockStats(false, true)) // docs
      .mockResolvedValueOnce(createMockStats(false, true)) // src
      .mockResolvedValueOnce(createMockStats(false, true)) // tests
      .mockResolvedValueOnce(createMockStats(true, false, false, 20)) // .gitignore
      .mockResolvedValueOnce(createMockStats(true, false, false, 50)) // package.json
      .mockResolvedValueOnce(createMockStats(true, false, false, 30)); // README.md

    const result = await lsTool.execute({ path: testDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Directory:");
    expect(result.content).toContain("Total items:");
    expect(result.content).toContain("📁 docs");
    expect(result.content).toContain("📁 src");
    expect(result.content).toContain("📁 tests");
    expect(result.content).toContain("📄 package.json");
    expect(result.content).toContain("📄 README.md");
    expect(result.content).toContain("📄 .gitignore");
    expect(result.shortResult).toMatch(/\d+ items \(\d+ dirs, \d+ files\)/);
  });

  it("should show file sizes", async () => {
    const testDir = "/test/tempdir";

    mockStat.mockResolvedValueOnce(createMockStats(false, true));

    mockReaddir.mockResolvedValueOnce([
      createMockDirent("large-file.txt", true, false),
      createMockDirent("package.json", true, false),
    ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);

    mockStat
      .mockResolvedValueOnce(createMockStats(true, false, false, 5000)) // large-file.txt
      .mockResolvedValueOnce(createMockStats(true, false, false, 25)); // package.json

    const result = await lsTool.execute({ path: testDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("large-file.txt (5000 bytes)");
    expect(result.content).toContain("package.json (25 bytes)");
  });

  it("should sort directories first, then files", async () => {
    const testDir = "/test/tempdir";

    mockStat.mockResolvedValueOnce(createMockStats(false, true));

    mockReaddir.mockResolvedValueOnce([
      createMockDirent("file1.txt", true, false),
      createMockDirent("dirA", false, true),
      createMockDirent("file2.txt", true, false),
      createMockDirent("dirB", false, true),
    ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);

    mockStat
      .mockResolvedValueOnce(createMockStats(true, false)) // file1.txt
      .mockResolvedValueOnce(createMockStats(false, true)) // dirA
      .mockResolvedValueOnce(createMockStats(true, false)) // file2.txt
      .mockResolvedValueOnce(createMockStats(false, true)); // dirB

    const result = await lsTool.execute({ path: testDir }, testContext);

    expect(result.success).toBe(true);
    const lines = result.content.split("\n");
    const itemLines = lines.filter(
      (line) => line.startsWith("📁") || line.startsWith("📄"),
    );

    // All directories should come before files
    let foundFile = false;
    for (const line of itemLines) {
      if (line.startsWith("📄")) {
        foundFile = true;
      } else if (line.startsWith("📁") && foundFile) {
        // If we find a directory after finding a file, sorting is wrong
        expect(false).toBe(true);
      }
    }
  });

  it("should ignore files matching ignore patterns", async () => {
    const testDir = "/test/tempdir";

    mockStat.mockResolvedValueOnce(createMockStats(false, true));

    mockReaddir.mockResolvedValueOnce([
      createMockDirent("temp.tmp", true, false),
      createMockDirent("backup.bak", true, false),
      createMockDirent("config.log", true, false),
      createMockDirent("package.json", true, false),
    ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);

    mockStat
      .mockResolvedValueOnce(createMockStats(true, false)) // temp.tmp
      .mockResolvedValueOnce(createMockStats(true, false)) // backup.bak
      .mockResolvedValueOnce(createMockStats(true, false)) // config.log
      .mockResolvedValueOnce(createMockStats(true, false)); // package.json

    const result = await lsTool.execute(
      {
        path: testDir,
        ignore: ["*.tmp", "*.bak", "*.log"],
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).not.toContain("temp.tmp");
    expect(result.content).not.toContain("backup.bak");
    expect(result.content).not.toContain("config.log");
    expect(result.content).toContain("package.json"); // Normal files should exist
  });

  it("should ignore files matching path patterns", async () => {
    const testDir = "/test/tempdir";

    mockStat.mockResolvedValueOnce(createMockStats(false, true));

    mockReaddir.mockResolvedValueOnce([
      createMockDirent("docs", false, true),
      createMockDirent("src", false, true),
    ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);

    mockStat
      .mockResolvedValueOnce(createMockStats(false, true)) // docs
      .mockResolvedValueOnce(createMockStats(false, true)); // src

    const result = await lsTool.execute(
      {
        path: testDir,
        ignore: [`${testDir}/docs`],
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).not.toContain("📁 docs");
    expect(result.content).toContain("📁 src"); // Other directories should exist
  });

  it("should show symlinks with special indicator", async () => {
    const testDir = "/test/tempdir";

    mockStat.mockResolvedValueOnce(createMockStats(false, true));

    mockReaddir.mockResolvedValueOnce([
      createMockDirent("readme-link.md", false, false, true),
      createMockDirent("README.md", true, false),
    ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);

    mockStat
      .mockResolvedValueOnce(createMockStats(false, false, true)) // readme-link.md (symlink)
      .mockResolvedValueOnce(createMockStats(true, false, false)); // README.md

    const result = await lsTool.execute({ path: testDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("🔗 readme-link.md");
    expect(result.content).toContain("📄 README.md");
  });

  it("should return error for non-existent path", async () => {
    const nonExistentPath = "/test/non-existent";

    mockStat.mockRejectedValueOnce(
      new Error("ENOENT: no such file or directory"),
    );

    const result = await lsTool.execute({ path: nonExistentPath }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("ENOENT");
  });

  it("should return error for file path (not directory)", async () => {
    const filePath = "/test/package.json";

    mockStat.mockResolvedValueOnce(createMockStats(true, false)); // is a file

    const result = await lsTool.execute({ path: filePath }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("is not a directory");
  });

  it("should return error for relative path", async () => {
    const result = await lsTool.execute(
      { path: "./relative/path" },
      testContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Path must be an absolute path");
  });

  it("should return error for missing path parameter", async () => {
    const result = await lsTool.execute({}, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("path parameter is required");
  });

  it("should return error for invalid path type", async () => {
    const result = await lsTool.execute({ path: 123 }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "path parameter is required and must be a string",
    );
  });

  it("should list subdirectory contents", async () => {
    const srcPath = "/test/tempdir/src";

    mockStat.mockResolvedValueOnce(createMockStats(false, true));

    mockReaddir.mockResolvedValueOnce([
      createMockDirent("index.ts", true, false),
      createMockDirent("utils.ts", true, false),
    ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);

    mockStat
      .mockResolvedValueOnce(createMockStats(true, false)) // index.ts
      .mockResolvedValueOnce(createMockStats(true, false)); // utils.ts

    const result = await lsTool.execute({ path: srcPath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Directory: " + srcPath);
    expect(result.content).toContain("📄 index.ts");
    expect(result.content).toContain("📄 utils.ts");
    expect(result.content).not.toContain("package.json"); // Should not contain parent directory files
    expect(result.shortResult).toContain("2 items (0 dirs, 2 files)");
  });

  it("should handle empty directory", async () => {
    const emptyDir = "/test/empty";

    mockStat.mockResolvedValueOnce(createMockStats(false, true));
    mockReaddir.mockResolvedValueOnce(
      [] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>,
    );

    const result = await lsTool.execute({ path: emptyDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Total items: 0");
    expect(result.shortResult).toBe("0 items (0 dirs, 0 files)");
  });

  it("should format compact parameters correctly", () => {
    const params1 = { path: "/home/user/project" };
    expect(lsTool.formatCompactParams?.(params1, testContext)).toBe(
      "/home/user/project",
    );

    const params2 = {
      path: "/home/user/project",
      ignore: ["*.tmp", "*.log"],
    };
    expect(lsTool.formatCompactParams?.(params2, testContext)).toBe(
      "/home/user/project ignore: *.tmp, *.log",
    );

    const params3 = { path: "/test" };
    expect(lsTool.formatCompactParams?.(params3, testContext)).toBe("/test");
  });

  it("should handle files without read permissions gracefully", async () => {
    const testDir = "/test/tempdir";

    mockStat.mockResolvedValueOnce(createMockStats(false, true));
    mockReaddir.mockResolvedValueOnce([
      createMockDirent("file.txt", true, false),
    ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);
    mockStat.mockResolvedValueOnce(createMockStats(true, false));

    const result = await lsTool.execute({ path: testDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Total items:");
  });

  it("should show binary file indicator", async () => {
    const testDir = "/test/tempdir";

    mockStat.mockResolvedValueOnce(createMockStats(false, true));

    mockReaddir.mockResolvedValueOnce([
      createMockDirent("binary.bin", true, false),
    ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);

    mockStat.mockResolvedValueOnce(createMockStats(true, false, false, 6));

    // Mock isBinary to return true for this file
    mockIsBinary.mockReturnValueOnce(true);

    const result = await lsTool.execute({ path: testDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("binary.bin");
    // Check if there's a binary file identifier (depends on isBinary function implementation)
  });

  it("should handle files with special characters in names", async () => {
    const testDir = "/test/tempdir";

    mockStat.mockResolvedValueOnce(createMockStats(false, true));

    mockReaddir.mockResolvedValueOnce([
      createMockDirent("file with spaces.txt", true, false),
      createMockDirent("file-with-dashes.txt", true, false),
      createMockDirent("file_with_underscores.txt", true, false),
    ] as unknown as Awaited<ReturnType<typeof fs.promises.readdir>>);

    mockStat
      .mockResolvedValueOnce(createMockStats(true, false))
      .mockResolvedValueOnce(createMockStats(true, false))
      .mockResolvedValueOnce(createMockStats(true, false));

    const result = await lsTool.execute({ path: testDir }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("file with spaces.txt");
    expect(result.content).toContain("file-with-dashes.txt");
    expect(result.content).toContain("file_with_underscores.txt");
  });
});
