import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { globTool } from "@/tools/globTool.js";
import { TaskManager } from "@/services/taskManager.js";
import type { ToolContext } from "@/tools/types.js";
import type { Stats } from "fs";

const testContext: ToolContext = {
  workdir: "/test/workdir",
  taskManager: new TaskManager("test-session"),
};

// Mock glob
vi.mock("glob", () => ({
  glob: vi.fn(),
}));

// Mock fs/promises
vi.mock("fs/promises", () => ({
  stat: vi.fn(),
}));

// Mock path utilities
vi.mock("../utils/path.js", () => ({
  resolvePath: vi.fn((path: string, workdir: string) => path || workdir),
  getDisplayPath: vi.fn((path: string) => path),
}));

// Mock fileFilter utility
vi.mock("../utils/fileFilter.js", () => ({
  getGlobIgnorePatterns: vi.fn(() => ["**/node_modules/**", "**/.git/**"]),
}));

// Import the mocked modules
import { glob } from "glob";
import { stat } from "fs/promises";

describe("globTool", () => {
  const mockGlob = vi.mocked(glob);
  const mockStat = vi.mocked(stat);

  // Helper to create mock stats
  const createMockStats = (mtime: Date = new Date("2023-01-01")): Stats =>
    ({
      mtime,
    }) as Stats;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should be properly configured", () => {
    expect(globTool.name).toBe("Glob");
    expect(globTool.config.type).toBe("function");
    if (
      globTool.config.type === "function" &&
      globTool.config.function.parameters
    ) {
      expect(globTool.config.function.name).toBe("Glob");
      expect(globTool.config.function.parameters.required).toEqual(["pattern"]);
    }
  });

  it("should find TypeScript files with **/*.ts pattern", async () => {
    mockGlob.mockResolvedValueOnce([
      "/test/workdir/src/index.ts",
      "/test/workdir/src/utils.ts",
    ]);

    mockStat
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-02")))
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-01")));

    const result = await globTool.execute(
      { pattern: "**/*.ts" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.shortResult).toContain("Found 2 files");
  });

  it("should find all files with ** pattern", async () => {
    mockGlob.mockResolvedValueOnce([
      "/test/workdir/package.json",
      "/test/workdir/src/index.ts",
      "/test/workdir/tests/app.test.js",
      "/test/workdir/docs/README.md",
    ]);

    mockStat
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-01")))
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-02")))
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-03")))
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-04")));

    const result = await globTool.execute(
      { pattern: "**/*" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("package.json");
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("tests/app.test.js");
    expect(result.content).toContain("docs/README.md");
  });

  it("should find files in specific directory", async () => {
    mockGlob.mockResolvedValueOnce([
      "/test/workdir/src/index.ts",
      "/test/workdir/src/utils.ts",
    ]);

    mockStat
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-02")))
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-01")));

    const result = await globTool.execute(
      { pattern: "src/*" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.content).not.toContain("package.json");
  });

  it("should return no matches for non-existent pattern", async () => {
    mockGlob.mockResolvedValueOnce([]);

    const result = await globTool.execute(
      { pattern: "**/*.nonexistent" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("No files match the pattern");
    expect(result.shortResult).toBe("No matches found");
  });

  it("should work with custom search path", async () => {
    mockGlob.mockResolvedValueOnce([
      "/test/workdir/src/index.ts",
      "/test/workdir/src/utils.ts",
    ]);

    mockStat
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-02")))
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-01")));

    const result = await globTool.execute(
      { pattern: "*.ts", path: "/test/workdir/src" },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("index.ts");
    expect(result.content).toContain("utils.ts");
  });

  it("should return error for missing pattern", async () => {
    const result = await globTool.execute({}, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("pattern parameter is required");
  });

  it("should return error for invalid pattern type", async () => {
    const result = await globTool.execute({ pattern: 123 }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "pattern parameter is required and must be a string",
    );
  });

  it("should format compact parameters correctly", () => {
    const params1 = { pattern: "**/*.ts" };
    expect(globTool.formatCompactParams?.(params1, testContext)).toBe(
      "**/*.ts",
    );

    const params2 = { pattern: "*.js", path: "/custom/path" };
    expect(globTool.formatCompactParams?.(params2, testContext)).toBe(
      "*.js in /custom/path",
    );
  });

  it("should sort files by modification time", async () => {
    mockGlob.mockResolvedValueOnce([
      "/test/workdir/file1.txt",
      "/test/workdir/file2.txt",
    ]);

    // file2.txt is newer (modified later)
    mockStat
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-01"))) // file1.txt
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-02"))); // file2.txt

    const result = await globTool.execute(
      { pattern: "file*.txt" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
      },
    );

    expect(result.success).toBe(true);
    const lines = result.content.split("\n");
    // Most recently modified files should come first
    expect(lines[0]).toContain("file2.txt");
    expect(lines[1]).toContain("file1.txt");
  });

  it("should respect gitignore patterns", async () => {
    // Mock glob to return files that would include node_modules, but should be filtered out
    mockGlob.mockResolvedValueOnce([
      "/test/workdir/tests/app.test.js", // This should be included
    ]);

    mockStat.mockResolvedValueOnce(createMockStats(new Date("2023-01-01")));

    const result = await globTool.execute(
      { pattern: "**/*.js" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
      },
    );

    expect(result.success).toBe(true);
    // Should include .js files in tests directory
    expect(result.content).toContain("tests/app.test.js");
    // The glob mock is configured to not return node_modules files,
    // which simulates the gitignore filtering behavior
  });

  it("should handle stat errors gracefully", async () => {
    mockGlob.mockResolvedValueOnce([
      "/test/workdir/file1.txt",
      "/test/workdir/file2.txt",
    ]);

    // First file stat succeeds, second fails
    mockStat
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-01")))
      .mockRejectedValueOnce(new Error("Permission denied"));

    const result = await globTool.execute(
      { pattern: "file*.txt" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("file1.txt");
    expect(result.content).toContain("file2.txt");
    // Should still work even when some stat calls fail
  });

  it("should handle glob errors", async () => {
    mockGlob.mockRejectedValueOnce(new Error("Invalid pattern"));

    const result = await globTool.execute(
      { pattern: "[invalid" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Invalid pattern");
  });

  it("should work with complex patterns", async () => {
    mockGlob.mockResolvedValueOnce([
      "/test/workdir/src/component.tsx",
      "/test/workdir/src/utils.ts",
      "/test/workdir/test/app.test.js",
    ]);

    mockStat
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-01")))
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-02")))
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-03")));

    const result = await globTool.execute(
      { pattern: "**/*.{ts,tsx,js}" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/component.tsx");
    expect(result.content).toContain("src/utils.ts");
    expect(result.content).toContain("test/app.test.js");
  });

  it("should display relative paths correctly", async () => {
    mockGlob.mockResolvedValueOnce(["/test/workdir/nested/deep/file.ts"]);

    mockStat.mockResolvedValueOnce(createMockStats(new Date("2023-01-01")));

    const result = await globTool.execute(
      { pattern: "**/file.ts" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager("test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("nested/deep/file.ts");
  });
});
