import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { globTool } from "@/tools/globTool.js";
import { TaskManager } from "@/services/taskManager.js";
import type { ToolContext } from "@/tools/types.js";
import type { Stats } from "fs";
import { Container } from "@/utils/container.js";
import { spawn } from "child_process";
import { EventEmitter } from "events";

const testContext: ToolContext = {
  workdir: "/test/workdir",
  taskManager: new TaskManager(new Container(), "test-session"),
};

// Mock child_process
vi.mock("child_process", () => ({
  spawn: vi.fn(),
}));

// Mock ripgrep utility
vi.mock("@/utils/ripgrep.js", () => ({
  rgPath: "/mock/rg",
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

// Mock fileFilter utility
vi.mock("@/utils/fileFilter.js", () => ({
  getAllIgnorePatterns: vi.fn(() => ["**/node_modules/**", "**/.git/**"]),
}));

// Import the mocked modules
import { stat } from "fs/promises";

describe("globTool", () => {
  const mockSpawn = vi.mocked(spawn);
  const mockStat = vi.mocked(stat);

  // Helper to create mock stats
  const createMockStats = (mtime: Date = new Date("2023-01-01")): Stats =>
    ({
      mtime,
    }) as Stats;

  // Helper to mock ripgrep output
  const mockRgOutput = (files: string[], exitCode = 0) => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
    }) as unknown as ReturnType<typeof spawn>;

    mockSpawn.mockReturnValueOnce(child);

    // Use setImmediate to ensure the event handlers are attached before emitting
    setImmediate(() => {
      if (files.length > 0) {
        stdout.emit("data", Buffer.from(files.join("\n")));
      }
      child.emit("close", exitCode);
    });
  };

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
    mockRgOutput(["src/index.ts", "src/utils.ts"]);

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
    expect(mockSpawn).toHaveBeenCalledWith(
      "/mock/rg",
      expect.arrayContaining(["--files", "--glob", "**/*.ts"]),
      expect.objectContaining({ cwd: "/test/workdir" }),
    );
  });

  it("should find all files with ** pattern", async () => {
    mockRgOutput([
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
    mockRgOutput(["src/index.ts", "src/utils.ts"]);

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
    mockRgOutput([]);

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
    mockRgOutput(["index.ts", "utils.ts"]);

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
    expect(mockSpawn).toHaveBeenCalledWith(
      "/mock/rg",
      expect.anything(),
      expect.objectContaining({ cwd: "/test/workdir/src" }),
    );
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
    mockRgOutput(["file1.txt", "file2.txt"]);

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

  it("should respect gitignore patterns", async () => {
    // Ripgrep handles gitignore automatically, but we also pass common ignore patterns
    mockRgOutput(["tests/app.test.js"]);

    mockStat.mockResolvedValueOnce(createMockStats(new Date("2023-01-01")));

    const result = await globTool.execute(
      { pattern: "**/*.js" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager(new Container(), "test-session"),
      },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("tests/app.test.js");
    expect(mockSpawn).toHaveBeenCalledWith(
      "/mock/rg",
      expect.arrayContaining(["--glob", "!**/node_modules/**"]),
      expect.anything(),
    );
  });

  it("should handle stat errors gracefully", async () => {
    mockRgOutput(["file1.txt", "file2.txt"]);

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

  it("should handle ripgrep errors", async () => {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const child = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
    }) as unknown as ReturnType<typeof spawn>;

    mockSpawn.mockReturnValueOnce(child);

    setImmediate(() => {
      stderr.emit("data", Buffer.from("Some error"));
      child.emit("close", 2); // Exit code 2 is error
    });

    const result = await globTool.execute(
      { pattern: "[invalid" },
      {
        workdir: "/test/workdir",
        taskManager: new TaskManager(new Container(), "test-session"),
      },
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("ripgrep failed with code 2");
    expect(result.error).toContain("Some error");
  });

  it("should work with complex patterns", async () => {
    mockRgOutput(["src/component.tsx", "src/utils.ts", "test/app.test.js"]);

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
    mockRgOutput(["nested/deep/file.ts"]);

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

  it("should limit the number of results to 1000", async () => {
    const manyFiles = Array.from({ length: 1005 }, (_, i) => `file${i}.txt`);
    mockRgOutput(manyFiles);

    // Mock stat for all files - make them progressively newer
    manyFiles.forEach((_, i) => {
      mockStat.mockResolvedValueOnce(
        createMockStats(new Date(2023, 0, 1, 0, 0, i)),
      );
    });

    const result = await globTool.execute({ pattern: "**/*.txt" }, testContext);

    expect(result.success).toBe(true);
    const lines = result.content.split("\n");
    expect(lines.length).toBe(1000);
    expect(result.shortResult).toBe("Found 1005 files (showing first 1000)");
    // Verify it shows the most recent ones
    expect(lines[0]).toContain("file1004.txt");
    expect(lines[999]).toContain("file5.txt");
  });
});
