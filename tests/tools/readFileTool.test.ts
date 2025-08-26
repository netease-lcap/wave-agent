import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileTool } from "@/plugins/tools/readFileTool";
import type { ToolResult } from "@/plugins/tools/types";

// Mock fs/promises module
vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    readFile: vi.fn(),
  };
});

// Mock fs module for existsSync
vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    default: {
      ...actual,
      existsSync: vi.fn(),
    },
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  };
});

// Mock path module
vi.mock("path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("path")>();
  return {
    ...actual,
    resolve: vi.fn((path: string) => path),
  };
});

const mockReadFile = vi.mocked(await import("fs/promises")).readFile;

describe("readFileTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should read specific lines from a file with explanation", async () => {
    // 模拟文件内容（300行代码，这样可以测试真正的行范围选择）
    const mockFileContent = Array.from(
      { length: 300 },
      (_, i) => `Line ${i + 1}: Some code content here`,
    ).join("\n");

    // Mock fs methods
    mockReadFile.mockResolvedValue(mockFileContent);

    const result: ToolResult = await readFileTool.execute({
      target_file: "test-file.ts",
      start_line_one_indexed: 5,
      end_line_one_indexed_inclusive: 10,
    });

    // 验证 fs 方法被正确调用
    expect(mockReadFile).toHaveBeenCalledWith("test-file.ts", "utf-8");

    // 验证结果
    expect(result.success).toBe(true);
    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe("string");
    expect(result.content.length).toBeGreaterThan(0);
    expect(result.error).toBeUndefined();

    // 验证 shortResult 存在且格式正确
    expect(result.shortResult).toBeDefined();
    expect(result.shortResult).toBe("Lines 5-10 (6 lines)");

    // 现在应该返回用户指定的行范围（5-10行）
    expect(result.content).toContain("Line 5:");
    expect(result.content).toContain("Line 6:");
    expect(result.content).toContain("Line 10:");

    // 验证不包含范围外的行
    expect(result.content).not.toContain("Line 4:");
    expect(result.content).not.toContain("Line 11:");

    // 验证包含行号范围摘要信息
    expect(result.content).toContain("[Lines 1-4 not shown]");
    expect(result.content).toContain("[Lines 11-300 not shown]");
  });

  it("should handle file not found error", async () => {
    // Mock file read error
    mockReadFile.mockRejectedValue(
      new Error("ENOENT: no such file or directory"),
    );

    const result: ToolResult = await readFileTool.execute({
      target_file: "non-existent-file.ts",
    });

    // 验证 fs 方法被调用
    expect(mockReadFile).toHaveBeenCalledWith("non-existent-file.ts", "utf-8");

    // 验证错误结果
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("ENOENT");
  });

  it("should read entire file when should_read_entire_file is true", async () => {
    const mockFileContent = "Line 1\nLine 2\nLine 3";

    mockReadFile.mockResolvedValue(mockFileContent);

    const result: ToolResult = await readFileTool.execute({
      target_file: "test-file.ts",
      should_read_entire_file: true,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe(mockFileContent);
  });

  it("should handle fs readFile error", async () => {
    mockReadFile.mockRejectedValue(new Error("Permission denied"));

    const result: ToolResult = await readFileTool.execute({
      target_file: "test-file.ts",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Permission denied");
  });

  it("should handle invalid line range", async () => {
    const mockFileContent = "Line 1\nLine 2\nLine 3";

    mockReadFile.mockResolvedValue(mockFileContent);

    const result: ToolResult = await readFileTool.execute({
      target_file: "test-file.ts",
      start_line_one_indexed: 5,
      end_line_one_indexed_inclusive: 10,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("Invalid start line number");
  });

  it("should use default line range when line numbers not provided", async () => {
    const mockFileContent = Array.from(
      { length: 300 },
      (_, i) => `Line ${i + 1}`,
    ).join("\n");

    mockReadFile.mockResolvedValue(mockFileContent);

    const result: ToolResult = await readFileTool.execute({
      target_file: "test-file.ts",
    });

    expect(result.success).toBe(true);
    expect(result.content).toBeDefined();
    // 应该包含前200行的内容
    expect(result.content).toContain("Line 1");
    expect(result.content).toContain("Line 200");
    expect(result.content).not.toContain("Line 201");
  });

  it("should apply 200-line minimum only when no specific range is provided", async () => {
    const mockFileContent = Array.from(
      { length: 300 },
      (_, i) => `Line ${i + 1}`,
    ).join("\n");

    mockReadFile.mockResolvedValue(mockFileContent);

    // 当没有指定行范围时，应该使用默认的200行
    const result1: ToolResult = await readFileTool.execute({
      target_file: "test-file.ts",
    });

    expect(result1.success).toBe(true);
    expect(result1.content).toContain("Line 1");
    expect(result1.content).toContain("Line 200");
    expect(result1.content).not.toContain("Line 201");

    // 当指定了行范围时，应该返回指定的范围，即使少于200行
    const result2: ToolResult = await readFileTool.execute({
      target_file: "test-file.ts",
      start_line_one_indexed: 250,
      end_line_one_indexed_inclusive: 260,
    });

    expect(result2.success).toBe(true);
    expect(result2.content).toContain("Line 250");
    expect(result2.content).toContain("Line 260");
    expect(result2.content).not.toContain("Line 249");
    expect(result2.content).not.toContain("Line 261");
  });

  it("should return entire file when file has fewer than 200 lines", async () => {
    const mockFileContent = Array.from(
      { length: 50 },
      (_, i) => `Line ${i + 1}`,
    ).join("\n");

    mockReadFile.mockResolvedValue(mockFileContent);

    const result: ToolResult = await readFileTool.execute({
      target_file: "test-file.ts",
      start_line_one_indexed: 10,
      end_line_one_indexed_inclusive: 20,
    });

    expect(result.success).toBe(true);
    // 对于小文件，应该返回指定的行范围，而不是整个文件
    expect(result.content).toContain("Line 10");
    expect(result.content).toContain("Line 20");
    expect(result.content).not.toContain("Line 9");
    expect(result.content).not.toContain("Line 21");

    // 验证包含行号范围摘要信息
    expect(result.content).toContain("[Lines 1-9 not shown]");
    expect(result.content).toContain("[Lines 21-50 not shown]");
  });

  it("should read specific line range from d2c store file", async () => {
    // 模拟一个1000行的 TypeScript 文件内容，专门针对 d2c store 场景
    const mockFileLines = Array.from({ length: 1000 }, (_, i) => {
      const lineNum = i + 1;

      // 在关键行附近添加一些有意义的代码内容
      if (lineNum === 860) return "  // 开始处理 d2c 转换逻辑";
      if (lineNum === 876)
        return "  const processD2CConversion = async (data: any) => {";
      if (lineNum === 877) return "    // 核心转换逻辑在这里";
      if (lineNum === 878)
        return "    return await convertDataToComponent(data);";
      if (lineNum === 879) return "  };";
      if (lineNum === 900) return "  // d2c 转换逻辑结束";

      // 其他行的通用内容
      return `  Line ${lineNum}: // Some TypeScript code content`;
    });

    const mockFileContent = mockFileLines.join("\n");

    mockReadFile.mockResolvedValue(mockFileContent);

    const result: ToolResult = await readFileTool.execute({
      target_file: "packages/ide-essential/src/stores/d2c/index.ts",
      start_line_one_indexed: 860,
      end_line_one_indexed_inclusive: 900,
    });

    // 验证 fs 方法被正确调用
    expect(mockReadFile).toHaveBeenCalledWith(
      "packages/ide-essential/src/stores/d2c/index.ts",
      "utf-8",
    );

    // 验证结果成功
    expect(result.success).toBe(true);
    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe("string");
    expect(result.error).toBeUndefined();

    // 验证包含关键行的内容
    expect(result.content).toContain("开始处理 d2c 转换逻辑"); // 第860行
    expect(result.content).toContain(
      "const processD2CConversion = async (data: any) => {",
    ); // 第876行
    expect(result.content).toContain("核心转换逻辑在这里"); // 第877行
    expect(result.content).toContain(
      "return await convertDataToComponent(data);",
    ); // 第878行
    expect(result.content).toContain("d2c 转换逻辑结束"); // 第900行

    // 验证不包含范围外的行
    expect(result.content).not.toContain("Line 859:");
    expect(result.content).not.toContain("Line 901:");

    // 验证包含行号范围摘要信息
    expect(result.content).toContain("[Lines 1-859 not shown]");
    expect(result.content).toContain("[Lines 901-1000 not shown]");

    // 验证内容应该包含41行（860-900，包含首尾）
    const lines = result.content.split("\n");
    // 过滤掉摘要行，只计算实际内容行
    const contentLines = lines.filter(
      (line) =>
        !line.startsWith("[Lines") &&
        !line.startsWith("[Adjusted range") &&
        line.trim() !== "",
    );
    expect(contentLines.length).toBe(41); // 860到900共41行

    // 验证返回的是指定范围的内容，而不是整个文件
    // 构建期望的内容（第860-900行）
    const expectedLines = mockFileLines.slice(859, 900); // 转换为0索引
    const expectedContent = expectedLines.join("\n");
    const expectedWithSummary = `${expectedContent}\n[Lines 1-859 not shown]\n[Lines 901-1000 not shown]\n`;

    expect(result.content).toBe(expectedWithSummary);
  });

  it("🔧 read_file ✅ Success Parameters: should read from line 200 to end of file when no end line specified", async () => {
    // 模拟一个450行的测试文件内容，测试从第200行开始读取到文件末尾的处理
    const mockFileLines = Array.from({ length: 450 }, (_, i) => {
      const lineNum = i + 1;
      return `Line ${lineNum}: Test content for grep search tool functionality`;
    });

    const mockFileContent = mockFileLines.join("\n");

    mockReadFile.mockResolvedValue(mockFileContent);

    const result: ToolResult = await readFileTool.execute({
      target_file: "packages/code/tests/tools/grepSearchTool.test.ts",
      start_line_one_indexed: 200,
    });

    // 验证 fs 方法被正确调用
    expect(mockReadFile).toHaveBeenCalledWith(
      "packages/code/tests/tools/grepSearchTool.test.ts",
      "utf-8",
    );

    // 验证结果成功
    expect(result.success).toBe(true);
    expect(result.content).toBeDefined();
    expect(typeof result.content).toBe("string");
    expect(result.error).toBeUndefined();

    // 验证包含从第200行开始的内容
    expect(result.content).toContain("Line 200:");
    expect(result.content).toContain("Line 300:");
    expect(result.content).toContain("Line 400:");
    expect(result.content).toContain("Line 449:"); // 受250行限制，最后一行是449

    // 验证不包含第199行和第450行（因为250行限制）
    expect(result.content).not.toContain("Line 199:");
    expect(result.content).not.toContain("Line 450:"); // 超出250行限制

    // 验证包含行号范围摘要信息
    expect(result.content).toContain("[Lines 1-199 not shown]");
    expect(result.content).toContain("[Lines 450-450 not shown]"); // 第450行被截断

    // 验证返回的行数应该是从200到449（250行限制），共250行
    const lines = result.content.split("\n");
    const contentLines = lines.filter(
      (line) =>
        !line.startsWith("[Lines") &&
        !line.startsWith("[Adjusted range") &&
        line.trim() !== "",
    );
    expect(contentLines.length).toBe(250); // 200到449共250行

    // 验证读取从第200行到第449行的内容（受250行限制）
    const expectedLines = mockFileLines.slice(199, 449); // 第200-449行（转换为0索引）
    const expectedContent = expectedLines.join("\n");
    const expectedWithSummary = `${expectedContent}\n[Lines 1-199 not shown]\n[Lines 450-450 not shown]\n`;

    expect(result.content).toBe(expectedWithSummary);
  });
});
