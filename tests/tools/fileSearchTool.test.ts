import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fileSearchTool } from "../../src/tools/fileSearchTool";
import type { ToolContext } from "../../src/tools/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("fileSearchTool", () => {
  let tempDir: string;
  let originalCwd: string;
  let mockContext: ToolContext;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 保存原始工作目录
    originalCwd = process.cwd();

    // 创建临时目录
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-search-test-"));

    // 创建测试文件结构
    const testFiles = [
      "src/components/ToolResultDisplay.tsx",
      "src/tools/fileSearchTool.ts",
      "src/utils/resultProcessor.ts",
      "src/components/CommandOutputDisplay.tsx",
      "docs/tool-guide.md",
      "docs/result-processing.md",
      "tests/tool.test.ts",
      "tests/display.test.ts",
      "config/tool-config.json",
      "README.md",
      "package.json",
      // 创建更多文件来测试限制功能
      ...Array.from({ length: 15 }, (_, i) => `src/tool-${i}.ts`),
    ];

    // 创建目录结构和文件
    for (const filePath of testFiles) {
      const fullPath = path.join(tempDir, filePath);
      const dir = path.dirname(fullPath);

      // 确保目录存在
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入文件内容
      fs.writeFileSync(fullPath, `// Test file: ${filePath}`);
    }

    // 改变工作目录到临时目录
    process.chdir(tempDir);

    mockContext = {
      workdir: tempDir,
    };
  });

  afterEach(() => {
    // 恢复原始工作目录
    process.chdir(originalCwd);

    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("should find files with single keyword", async () => {
    const result = await fileSearchTool.execute({ query: "tool" }, mockContext);

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
    expect(result.content).toContain("tool-guide.md");
    // 由于结果限制为10个，且按字母序排序，fileSearchTool.ts 可能不在前10个中
    // 但是应该包含一些包含"tool"的文件
    expect(result.content).toMatch(/tool/i);
  });

  it("should find specific files with more targeted search", async () => {
    const result = await fileSearchTool.execute(
      { query: "fileSearchTool" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("fileSearchTool.ts");
  });

  it("should find files with space-separated keywords", async () => {
    const result = await fileSearchTool.execute(
      { query: "result tool" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it("should support out-of-order keyword matching", async () => {
    const result = await fileSearchTool.execute(
      { query: "display result" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it("should handle case-insensitive queries", async () => {
    const result = await fileSearchTool.execute(
      { query: "TOOL RESULT" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it("should handle queries with multiple spaces", async () => {
    const result = await fileSearchTool.execute(
      { query: "result   tool   display" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it('should return "No matching files found" for unmatched queries', async () => {
    const result = await fileSearchTool.execute(
      { query: "nonexistent missing" },
      mockContext,
    );

    expect(result.success).toBe(true);
    expect(result.content).toBe("No matching files found");
    expect(result.shortResult).toBe("No files found");
  });

  it("should limit results to 10 items", async () => {
    const result = await fileSearchTool.execute({ query: "tool" }, mockContext);

    expect(result.success).toBe(true);
    const lines = result.content.split("\n").filter((line) => line.trim());
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(result.shortResult).toContain("(top 10)");
  });

  it("should return error for missing query parameter", async () => {
    const result = await fileSearchTool.execute({}, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("query parameter is required");
  });

  it("should return error for invalid query parameter", async () => {
    const result = await fileSearchTool.execute({ query: 123 }, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain(
      "query parameter is required and must be a string",
    );
  });

  it("should handle empty or whitespace-only queries", async () => {
    const result = await fileSearchTool.execute({ query: "   " }, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Query cannot be empty");
  });

  it("should work without context", async () => {
    const result = await fileSearchTool.execute({ query: "tool" });

    expect(result.success).toBe(true);
    expect(result.content).toContain("ToolResultDisplay.tsx");
  });

  it("should format compact params correctly", () => {
    const formatted = fileSearchTool.formatCompactParams!({
      query: "test search",
    });
    expect(formatted).toBe("test search");
  });

  it("should handle empty query in formatCompactParams", () => {
    const formatted = fileSearchTool.formatCompactParams!({});
    expect(formatted).toBe("");
  });
});
