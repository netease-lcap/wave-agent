import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { globTool } from "@/tools/globTool.js";
import { TaskManager } from "@/services/taskManager.js";
import type { ToolContext } from "@/tools/types.js";
import type { Stats } from "fs";
import { Container } from "@/utils/container.js";

const testContext: ToolContext = {
  workdir: "/test/workdir",
  taskManager: new TaskManager(new Container(), "test-session"),
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
vi.mock("@/utils/path.js", () => ({
  resolvePath: vi.fn((path: string, workdir: string) => {
    if (path.startsWith("/")) return path;
    return `${workdir}/${path}`.replace(/\/+/g, "/");
  }),
  getDisplayPath: vi.fn((path: string) => path),
}));

// Import the mocked modules
import { stat } from "fs/promises";
import { glob } from "glob";

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
      expect(globTool.config.function.description).toBe(
        "Fast file pattern matching tool that works with any codebase size",
      );
      expect(globTool.config.function.parameters.required).toEqual(["pattern"]);
    }
  });

  it("should find TypeScript files with **/*.ts pattern", async () => {
    mockGlob.mockResolvedValue(["src/index.ts", "src/utils.ts"]);

    mockStat
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-02")))
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-01")));

    const result = await globTool.execute(
      { pattern: "**/*.ts" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager(new Container(), "test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
    expect(result.shortResult).toContain("Found 2 files");
    expect(mockGlob).toHaveBeenCalledWith("**/*.ts", {
      cwd: "/test/workdir",
      nodir: true,
      dot: true,
      ignore: ["**/.git/**"],
    });
  });

  it("should find all files with ** pattern", async () => {
    mockGlob.mockResolvedValue([
      "package.json",
      "src/index.ts",
      "tests/app.test.js",
      "docs/README.md",
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
        taskManager: new TaskManager(new Container(), "test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("package.json");
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("tests/app.test.js");
    expect(result.content).toContain("docs/README.md");
  });

  it("should find files in specific directory", async () => {
    mockGlob.mockResolvedValue(["src/index.ts", "src/utils.ts"]);

    mockStat
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-02")))
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-01")));

    const result = await globTool.execute(
      { pattern: "src/*" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager(new Container(), "test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/index.ts");
    expect(result.content).toContain("src/utils.ts");
  });

  it("should return no matches for non-existent pattern", async () => {
    mockGlob.mockResolvedValue([]);

    const result = await globTool.execute(
      { pattern: "**/*.nonexistent" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager(new Container(), "test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("No files match the pattern");
    expect(result.shortResult).toBe("No matches found");
  });

  it("should work with custom search path", async () => {
    mockGlob.mockResolvedValue(["index.ts", "utils.ts"]);

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
    expect(mockGlob).toHaveBeenCalledWith("*.ts", {
      cwd: "/test/workdir/src",
      nodir: true,
      dot: true,
      ignore: ["**/.git/**"],
    });
  });

  it("should return error for missing pattern", async () => {
    const result = globTool.validate!({});

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toContain("Missing required parameter: pattern");
  });

  it("should return error for invalid pattern type", async () => {
    const result = globTool.validate!({ pattern: 123 });

    expect(result).not.toBeNull();
    expect(result!.success).toBe(false);
    expect(result!.error).toContain("Parameter pattern must be a string");
  });

  it("should support limit argument and populate metadata", async () => {
    mockGlob.mockResolvedValue(["file1.ts", "file2.ts", "file3.ts"]);
    mockStat.mockResolvedValue(createMockStats());

    const result = await globTool.execute(
      {
        pattern: "**/*.ts",
        limit: 2,
      },
      testContext,
    );

    expect(result.success).toBe(true);
    const lines = result.content.split("\n").filter((line) => line.trim());
    expect(lines.length).toBe(2);
    expect(result.metadata?.numFiles).toBe(3);
    expect(result.metadata?.truncated).toBe(true);
    expect(result.metadata?.durationMs).toBeGreaterThanOrEqual(0);
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
    mockGlob.mockResolvedValue(["file1.txt", "file2.txt"]);

    // file2.txt is newer (modified later)
    mockStat
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-01"))) // file1.txt
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-02"))); // file2.txt

    const result = await globTool.execute(
      { pattern: "file*.txt" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager(new Container(), "test-session"),
      },
    );

    expect(result.success).toBe(true);
    const lines = result.content.split("\n");
    // Most recently modified files should come first
    expect(lines[0]).toContain("file2.txt");
    expect(lines[1]).toContain("file1.txt");
  });

  it("should handle stat errors gracefully", async () => {
    mockGlob.mockResolvedValue(["file1.txt", "file2.txt"]);

    // First file stat succeeds, second fails
    mockStat
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-01")))
      .mockRejectedValueOnce(new Error("Permission denied"));

    const result = await globTool.execute(
      { pattern: "file*.txt" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager(new Container(), "test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("file1.txt");
    expect(result.content).toContain("file2.txt");
  });

  it("should work with complex patterns", async () => {
    mockGlob.mockResolvedValue([
      "src/component.tsx",
      "src/utils.ts",
      "test/app.test.js",
    ]);

    mockStat
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-01")))
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-02")))
      .mockResolvedValueOnce(createMockStats(new Date("2023-01-03")));

    const result = await globTool.execute(
      { pattern: "**/*.{ts,tsx,js}" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager(new Container(), "test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("src/component.tsx");
    expect(result.content).toContain("src/utils.ts");
    expect(result.content).toContain("test/app.test.js");
  });

  it("should display relative paths correctly", async () => {
    mockGlob.mockResolvedValue(["nested/deep/file.ts"]);

    mockStat.mockResolvedValueOnce(createMockStats(new Date("2023-01-01")));

    const result = await globTool.execute(
      { pattern: "**/file.ts" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager(new Container(), "test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("nested/deep/file.ts");
  });

  it("should limit the number of results to 100", async () => {
    const manyFiles = Array.from({ length: 105 }, (_, i) => `file${i}.txt`);
    mockGlob.mockResolvedValue(manyFiles);

    // Mock stat for all files - make them progressively newer
    manyFiles.forEach((_, i) => {
      mockStat.mockResolvedValueOnce(
        createMockStats(new Date(2023, 0, 1, 0, 0, i)),
      );
    });

    const result = await globTool.execute({ pattern: "**/*.txt" }, testContext);

    expect(result.success).toBe(true);
    const lines = result.content.split("\n");
    expect(lines.length).toBe(100);
    expect(result.shortResult).toBe("Found 105 files (showing first 100)");
    // Verify it shows the most recent ones
    expect(lines[0]).toContain("file104.txt");
    expect(lines[99]).toContain("file5.txt");
  });
});
