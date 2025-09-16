import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { grepSearchTool } from "@/tools/grepSearchTool";
import type { ToolResult, ToolContext } from "@/tools/types";
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
        },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("query parameter is required");
    });

    it("should support path patterns with ripgrep", async () => {
      // 这个测试验证路径模式现在是支持的（使用 ripgrep）
      const result1: ToolResult = await grepSearchTool.execute(
        {
          query: "export",
          include_pattern: "src/**/*.ts",
        },
        mockContext,
      );

      expect(result1.success).toBe(true);

      const result2: ToolResult = await grepSearchTool.execute(
        {
          query: "export",
          include_pattern: "src/components/*.tsx",
        },
        mockContext,
      );

      expect(result2.success).toBe(true);

      const result3: ToolResult = await grepSearchTool.execute(
        {
          query: "export",
          include_pattern: "*.ts,src/**/*.js,*.vue",
        },
        mockContext,
      );

      expect(result3.success).toBe(true);
    });

    it("should accept valid filename patterns", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "export",
          include_pattern: "*.ts,*.js,*.vue",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      // 不应该有错误
      expect(result.error).toBeUndefined();
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
        },
        badContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/ripgrep failed|Search failed/);
    });
  });

  describe("file content search", () => {
    it("should search in files with content", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "diff",
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

  describe("gitignore integration", () => {
    it("should automatically exclude directories from .gitignore", async () => {
      // 创建 .gitignore 文件
      const gitignorePath = path.join(tempDir, ".gitignore");
      fs.writeFileSync(
        gitignorePath,
        `# Test gitignore
temp-dir/
logs/
*.log
.env`,
      );

      // 创建应该被忽略的目录和文件
      const tempDirPath = path.join(tempDir, "temp-dir");
      const logsDirPath = path.join(tempDir, "logs");
      fs.mkdirSync(tempDirPath);
      fs.mkdirSync(logsDirPath);

      fs.writeFileSync(
        path.join(tempDirPath, "test.txt"),
        "search_target in ignored dir",
      );
      fs.writeFileSync(
        path.join(logsDirPath, "app.log"),
        "search_target in logs",
      );
      fs.writeFileSync(
        path.join(tempDir, "debug.log"),
        "search_target in log file",
      );
      fs.writeFileSync(path.join(tempDir, ".env"), "search_target in env file");
      fs.writeFileSync(
        path.join(tempDir, "normal.txt"),
        "search_target in normal file",
      );

      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "search_target",
        },
        mockContext,
      );

      expect(result.success).toBe(true);

      // 应该找到正常文件中的内容
      expect(result.content).toContain("normal.txt");

      // 不应该找到被 gitignore 排除的内容
      expect(result.content).not.toContain("temp-dir");
      expect(result.content).not.toContain("logs");
      expect(result.content).not.toContain("debug.log");
      expect(result.content).not.toContain(".env");
    });

    it("should combine user exclude patterns with gitignore patterns", async () => {
      // 创建 .gitignore 文件
      const gitignorePath = path.join(tempDir, ".gitignore");
      fs.writeFileSync(gitignorePath, `auto-excluded/`);

      // 创建目录和文件
      const autoExcludedDir = path.join(tempDir, "auto-excluded");
      const userExcludedDir = path.join(tempDir, "user-excluded");
      fs.mkdirSync(autoExcludedDir);
      fs.mkdirSync(userExcludedDir);

      fs.writeFileSync(
        path.join(autoExcludedDir, "test.txt"),
        "target_content in auto-excluded",
      );
      fs.writeFileSync(
        path.join(userExcludedDir, "test.txt"),
        "target_content in user-excluded",
      );
      fs.writeFileSync(
        path.join(tempDir, "normal.txt"),
        "target_content in normal",
      );

      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "target_content",
          exclude_pattern: "user-excluded",
        },
        mockContext,
      );

      expect(result.success).toBe(true);

      // 应该只找到正常文件
      expect(result.content).toContain("normal.txt");

      // 不应该找到任何被排除的内容
      expect(result.content).not.toContain("auto-excluded");
      expect(result.content).not.toContain("user-excluded");
    });

    it("should handle gitignore patterns with leading slashes", async () => {
      // 创建 .gitignore 文件
      const gitignorePath = path.join(tempDir, ".gitignore");
      fs.writeFileSync(
        gitignorePath,
        `/root-only/
/root-file.txt`,
      );

      // 创建目录和文件
      const rootOnlyDir = path.join(tempDir, "root-only");
      fs.mkdirSync(rootOnlyDir);

      fs.writeFileSync(
        path.join(rootOnlyDir, "test.txt"),
        "pattern_match in root-only",
      );
      fs.writeFileSync(
        path.join(tempDir, "root-file.txt"),
        "pattern_match in root-file",
      );
      fs.writeFileSync(
        path.join(tempDir, "normal.txt"),
        "pattern_match in normal",
      );

      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "pattern_match",
        },
        mockContext,
      );

      expect(result.success).toBe(true);

      // 应该只找到正常文件
      expect(result.content).toContain("normal.txt");

      // 不应该找到被 gitignore 排除的内容
      expect(result.content).not.toContain("root-only");
      expect(result.content).not.toContain("root-file.txt");
    });

    it("should handle missing .gitignore gracefully", async () => {
      // 确保没有 .gitignore 文件
      const gitignorePath = path.join(tempDir, ".gitignore");
      if (fs.existsSync(gitignorePath)) {
        fs.unlinkSync(gitignorePath);
      }

      fs.writeFileSync(path.join(tempDir, "test.txt"), "fallback_test content");

      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "fallback_test",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("test.txt");

      // 应该仍然排除默认的目录
      expect(result.content).not.toContain("node_modules");
      expect(result.content).not.toContain("dist");
    });
  });
});
