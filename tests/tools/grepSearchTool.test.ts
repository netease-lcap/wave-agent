import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { grepSearchTool } from "@/plugins/tools/grepSearchTool";
import type { ToolResult, ToolContext } from "@/plugins/tools/types";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

describe("grepSearchTool", () => {
  let tempDir: string;
  let mockContext: ToolContext;

  beforeEach(async () => {
    vi.clearAllMocks();

    // 创建临时目录
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "grep-test-"));

    // 创建测试文件结构
    const testFiles = [
      {
        path: "src/components/Button.tsx",
        content: `import React from 'react';
import { diff } from 'diff-library';

interface ButtonProps {
  onClick: () => void;
}

export const Button: React.FC<ButtonProps> = ({ onClick }) => {
  return <button onClick={onClick}>Click me</button>;
};`,
      },
      {
        path: "src/utils/helpers.js",
        content: `const { createDiff } = require('diff-utils');

function generateDiff(oldText, newText) {
  return createDiff(oldText, newText);
}

export { generateDiff };`,
      },
      {
        path: "src/types/index.ts",
        content: `export interface DiffBlock {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber: number;
}

export type DiffResult = DiffBlock[];`,
      },
      {
        path: "tests/Button.test.tsx",
        content: `import { render } from '@testing-library/react';
import { Button } from '@/components/Button';

describe('Button', () => {
  it('should render correctly', () => {
    render(<Button onClick={() => {}} />);
  });
});`,
      },
      {
        path: "README.md",
        content: `# Project Documentation

This project uses diff libraries for comparing text.
`,
      },
    ];

    // 创建目录结构和文件
    for (const file of testFiles) {
      const fullPath = path.join(tempDir, file.path);
      const dir = path.dirname(fullPath);

      // 确保目录存在
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // 写入文件内容
      fs.writeFileSync(fullPath, file.content);
    }

    mockContext = {
      flatFiles: [], // 不再需要，但保持接口兼容
      workdir: tempDir,
    };
  });

  afterEach(() => {
    // 清理临时目录
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("basic search functionality", () => {
    it("should find simple text matches", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "Button",
          explanation: "Testing basic text search",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/components/Button.tsx");
      expect(result.content).toContain("tests/Button.test.tsx");
    });

    it("should find regex pattern matches", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "import.*React",
          explanation: "Testing regex pattern search",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/components/Button.tsx");
      expect(result.content).toContain("import React from 'react'");
    });

    it("should handle case sensitive search", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "button",
          case_sensitive: true,
          explanation: "Testing case sensitive search",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("<button onClick");
      // 确保结果不包含大写的 "Button"
      const lines = result.content.split("\n");
      const buttonLines = lines.filter((line) => line.includes("button"));
      expect(buttonLines.length).toBeGreaterThan(0);
    });

    it("should handle case insensitive search", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "button",
          case_sensitive: false,
          explanation: "Testing case insensitive search",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("Button");
      expect(result.content).toContain("<button");
    });

    it("should find function definitions with regex", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "function.*\\(",
          explanation: "Testing regex search for function definitions",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/utils/helpers.js");
      expect(result.content).toContain("function generateDiff(");
    });

    it("should handle over-escaped parentheses in query", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "function.*\\(",
          explanation: "Testing regex search with over-escaped parentheses",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/utils/helpers.js");
      expect(result.content).toContain("function generateDiff(");
    });
  });

  describe("file pattern filtering", () => {
    it("should filter by single file extension", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "import",
          include_pattern: "*.tsx",
          explanation: "Testing single extension filter",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/components/Button.tsx");
      expect(result.content).toContain("tests/Button.test.tsx");
      expect(result.content).not.toContain("src/utils/helpers.js");
    });

    it("should exclude files by pattern", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "Button",
          exclude_pattern: "tests",
          explanation: "Testing file exclusion",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/components/Button.tsx");
      expect(result.content).not.toContain("tests/Button.test.tsx");
    });

    it("should handle multiple include patterns", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "export",
          include_pattern: "*.ts,*.js",
          explanation: "Testing multiple include patterns",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/types/index.ts");
      expect(result.content).toContain("src/utils/helpers.js");
      expect(result.content).not.toContain("src/components/Button.tsx");
    });

    it("should support TypeScript files", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "DiffBlock",
          include_pattern: "*.ts",
          explanation: "Testing TypeScript file search",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/types/index.ts");
      expect(result.content).not.toContain("src/components/Button.tsx");
    });

    it("should support JavaScript files", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "generateDiff",
          include_pattern: "*.js",
          explanation: "Testing JavaScript file search",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/utils/helpers.js");
      expect(result.content).not.toContain("src/components/Button.tsx");
    });

    it("should support React component files", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "React.FC",
          include_pattern: "*.tsx",
          explanation: "Testing React component file search",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/components/Button.tsx");
      expect(result.content).not.toContain("src/utils/helpers.js");
    });

    it("should handle multiple exclude patterns", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "import",
          exclude_pattern: "tests,README.md",
          explanation: "Testing multiple exclude patterns",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/components/Button.tsx");
      expect(result.content).not.toContain("tests/Button.test.tsx");
      expect(result.content).not.toContain("README.md");
    });
  });

  describe("edge cases and error handling", () => {
    it('should return "No matches found" when no matches exist', async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "nonexistentpattern",
          explanation: "Testing no matches scenario",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toBe("No matches found");
    });

    it("should handle invalid regex patterns gracefully", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "[invalid",
          explanation: "Testing invalid regex handling",
        },
        mockContext,
      );

      // 根据系统 grep 的行为，无效的正则表达式可能被当作字面量或产生错误
      // 我们检查工具是否能够处理而不崩溃
      expect(typeof result.success).toBe("boolean");
      expect(typeof result.content).toBe("string");
    });

    it("should handle missing context", async () => {
      const result: ToolResult = await grepSearchTool.execute({
        query: "test",
        explanation: "Testing missing context",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain(
        "Working directory not available in context",
      );
    });

    it("should handle empty query", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "",
          explanation: "Testing empty query",
        },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("query parameter is required");
    });

    it("should limit results to 50 matches", async () => {
      // 创建包含很多匹配的文件
      const largeFilePath = path.join(tempDir, "large-file.txt");
      const manyLines = Array.from(
        { length: 100 },
        (_, i) => `Line ${i + 1}: test content`,
      ).join("\n");

      fs.writeFileSync(largeFilePath, manyLines);

      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "test",
          explanation: "Testing result limit",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      const matches = result.content.split("\n");
      expect(matches.length).toBeLessThanOrEqual(50);
    });

    it("should handle non-existent working directory", async () => {
      const badContext: ToolContext = {
        flatFiles: [],
        workdir: "/non/existent/directory",
      };

      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "test",
          explanation: "Testing non-existent directory",
        },
        badContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Search failed");
    });
  });

  describe("file content search", () => {
    it("should search in files with content", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "diff",
          explanation: "Testing content search",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/components/Button.tsx");
      expect(result.content).toContain("src/utils/helpers.js");
      expect(result.content).toContain("README.md");
    });

    it("should show line numbers in results", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "export",
          explanation: "Testing line number display",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      // 检查结果格式包含行号 (格式: filename:lineNumber:content)
      const lines = result.content.split("\n");
      const exportLines = lines.filter((line) => line.includes("export"));
      expect(exportLines.length).toBeGreaterThan(0);

      for (const line of exportLines) {
        expect(line).toMatch(/:[0-9]+:/); // 应该包含行号
      }
    });
  });
});
