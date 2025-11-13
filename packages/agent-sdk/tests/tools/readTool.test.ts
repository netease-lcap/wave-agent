import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readTool } from "@/tools/readTool.js";
import { readFile } from "fs/promises";
import type { ToolContext } from "@/tools/types.js";

// Mock fs/promises
vi.mock("fs/promises", () => ({
  readFile: vi.fn(),
}));

// Mock path utilities
vi.mock("@/utils/path.js", () => ({
  resolvePath: vi.fn((path: string, workdir: string) =>
    path.startsWith("/") ? path : `${workdir}/${path}`,
  ),
  getDisplayPath: vi.fn((path: string) => path),
}));

// Mock file format utilities
vi.mock("@/utils/fileFormat.js", () => ({
  isBinaryDocument: vi.fn(() => false),
  getBinaryDocumentError: vi.fn(() => "Binary document error"),
}));

const testContext: ToolContext = { workdir: "/test/workdir" };

// Mock file contents for different test scenarios
const mockFiles: Record<string, string> = {
  "/test/workdir/small.txt": `Line 1
Line 2
Line 3
Line 4
Line 5`,
  "/test/workdir/medium.txt": Array.from(
    { length: 50 },
    (_, i) => `Line ${i + 1}`,
  ).join("\n"),
  "/test/workdir/large.txt": Array.from(
    { length: 3000 },
    (_, i) => `Line ${i + 1}`,
  ).join("\n"),
  "/test/workdir/empty.txt": "",
  "/test/workdir/long-lines.txt": `Short line
${"x".repeat(2500)}
Another short line`,
  "/test/workdir/unicode.txt": `Hello 世界
Emoji: 🚀 🌟 ✨
Multi-byte: café naïve résumé`,
  "/test/workdir/subdir/nested.txt": "Nested file content",
  "/test/workdir/mixed-endings.txt": "Line 1\r\nLine 2\nLine 3\r\n",
  "/test/workdir/special-chars.txt": "Normal text\x00\x01\x02More text",
};

const mockReadFile = vi.mocked(readFile);

describe("readTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Setup default mock behavior
    mockReadFile.mockImplementation(async (path: unknown) => {
      const pathStr = path as string;
      if (mockFiles[pathStr] !== undefined) {
        return mockFiles[pathStr];
      }
      throw new Error(`ENOENT: no such file or directory, open '${pathStr}'`);
    });
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("should be properly configured", () => {
    expect(readTool.name).toBe("Read");
    expect(readTool.config.type).toBe("function");
    if (
      readTool.config.type === "function" &&
      readTool.config.function.parameters
    ) {
      expect(readTool.config.function.name).toBe("Read");
      expect(readTool.config.function.parameters.required).toEqual([
        "file_path",
      ]);
    }
  });

  it("should read small file completely", async () => {
    const filePath = "/test/workdir/small.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("File:");
    expect(result.content).toContain("Total lines: 5");
    expect(result.content).toContain("     1\tLine 1");
    expect(result.content).toContain("     2\tLine 2");
    expect(result.content).toContain("     5\tLine 5");
    expect(result.shortResult).toBe("Read 5 lines");
  });

  it("should read file with absolute path", async () => {
    const filePath = "/test/workdir/small.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Line 1");
    expect(result.content).toContain("Line 5");
  });

  it("should read file with offset", async () => {
    const filePath = "/test/workdir/medium.txt";
    const result = await readTool.execute(
      {
        file_path: filePath,
        offset: 10,
        limit: 5,
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Lines 10-14 of 50");
    expect(result.content).toContain("    10\tLine 10");
    expect(result.content).toContain("    14\tLine 14");
    expect(result.content).not.toContain("Line 9");
    expect(result.content).not.toContain("Line 15");
  });

  it("should read file with limit", async () => {
    const filePath = "/test/workdir/medium.txt";
    const result = await readTool.execute(
      {
        file_path: filePath,
        limit: 10,
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Lines 1-10 of 50");
    expect(result.content).toContain("     1\tLine 1");
    expect(result.content).toContain("    10\tLine 10");
    expect(result.content).not.toContain("Line 11");
  });

  it("should truncate long lines", async () => {
    const filePath = "/test/workdir/long-lines.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Short line");
    expect(result.content).toContain("Another short line");
    // Long lines should be truncated and "..." added
    expect(result.content).toContain("...");
  });

  it("should handle empty file", async () => {
    const filePath = "/test/workdir/empty.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain(
      "⚠️ System reminder: This file exists but has empty contents.",
    );
    expect(result.shortResult).toBe("Empty file");
  });

  it("should handle unicode content", async () => {
    const filePath = "/test/workdir/unicode.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Hello 世界");
    expect(result.content).toContain("🚀 🌟 ✨");
    expect(result.content).toContain("café naïve résumé");
  });

  it("should limit to 2000 lines by default for large files", async () => {
    const filePath = "/test/workdir/large.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Lines 1-2000 of 3000");
    expect(result.content).toContain("     1\tLine 1");
    expect(result.content).toContain("  2000\tLine 2000");
    expect(result.content).toContain("... 1000 more lines not shown");
    expect(result.shortResult).toBe("Read 2000 lines (truncated)");
  });

  it("should read from specific offset in large file", async () => {
    const filePath = "/test/workdir/large.txt";
    const result = await readTool.execute(
      {
        file_path: filePath,
        offset: 2500,
        limit: 100,
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Lines 2500-2599 of 3000");
    expect(result.content).toContain("  2500\tLine 2500");
    expect(result.content).toContain("  2599\tLine 2599");
  });

  it("should handle relative paths", async () => {
    const result = await readTool.execute(
      {
        file_path: "small.txt",
      },
      { workdir: "/test/workdir" },
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Line 1");
  });

  it("should handle nested file paths", async () => {
    const filePath = "/test/workdir/subdir/nested.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Nested file content");
  });

  it("should return error for non-existent file", async () => {
    const filePath = "/test/workdir/non-existent.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Failed to read file");
  });

  it("should return error for missing file_path parameter", async () => {
    const result = await readTool.execute({}, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("file_path parameter is required");
  });

  it("should return error for invalid file_path type", async () => {
    const result = await readTool.execute({ file_path: 123 }, testContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "file_path parameter is required and must be a string",
    );
  });

  it("should return error for invalid offset", async () => {
    const filePath = "/test/workdir/small.txt";
    const result = await readTool.execute(
      {
        file_path: filePath,
        offset: 100, // Exceeds file line count
      },
      testContext,
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain("Start line 100 exceeds total lines");
  });

  it("should adjust end line if it exceeds file length", async () => {
    const filePath = "/test/workdir/small.txt";
    const result = await readTool.execute(
      {
        file_path: filePath,
        offset: 3,
        limit: 10, // Exceeds file line count
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("Lines 3-5 of 5");
    expect(result.content).toContain("     3\tLine 3");
    expect(result.content).toContain("     5\tLine 5");
  });

  it("should format compact parameters correctly", () => {
    const params1 = { file_path: "/path/to/file.txt" };
    expect(readTool.formatCompactParams?.(params1, testContext)).toBe(
      "/path/to/file.txt",
    );

    const params2 = {
      file_path: "/path/to/file.txt",
      offset: 10,
      limit: 20,
    };
    expect(readTool.formatCompactParams?.(params2, testContext)).toBe(
      "/path/to/file.txt 10:20",
    );

    const params3 = {
      file_path: "/path/to/file.txt",
      offset: 5,
    };
    expect(readTool.formatCompactParams?.(params3, testContext)).toBe(
      "/path/to/file.txt 5:2000",
    );

    const params4 = {
      file_path: "/path/to/file.txt",
      limit: 50,
    };
    expect(readTool.formatCompactParams?.(params4, testContext)).toBe(
      "/path/to/file.txt 1:50",
    );
  });

  it("should handle files with different line endings", async () => {
    const filePath = "/test/workdir/mixed-endings.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Line 1");
    expect(result.content).toContain("Line 2");
    expect(result.content).toContain("Line 3");
  });

  it("should show proper line numbering with gaps", async () => {
    const filePath = "/test/workdir/medium.txt";
    const result = await readTool.execute(
      {
        file_path: filePath,
        offset: 45,
        limit: 10,
      },
      testContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("    45\tLine 45");
    expect(result.content).toContain("    50\tLine 50");
    // Ensure line number format is correctly aligned
    expect(result.content).toMatch(/\s+\d+\t/);
  });

  it("should handle binary-like content gracefully", async () => {
    const filePath = "/test/workdir/special-chars.txt";
    const result = await readTool.execute({ file_path: filePath }, testContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("Normal text");
    expect(result.content).toContain("More text");
  });
});
