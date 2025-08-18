import { describe, it, expect, vi, beforeEach } from "vitest";
import { grepSearchTool } from "@/plugins/tools/grepSearchTool";
import type { ToolResult, ToolContext } from "@/plugins/tools/types";
import type { FileTreeNode } from "@/types/common";

describe("grepSearchTool", () => {
  let mockContext: ToolContext;
  let mockFiles: FileTreeNode[];

  beforeEach(() => {
    vi.clearAllMocks();

    // 创建模拟文件数据
    mockFiles = [
      {
        path: "src/components/Button.tsx",
        code: `import React from 'react';
import { diff } from 'diff-library';

interface ButtonProps {
  onClick: () => void;
}

export const Button: React.FC<ButtonProps> = ({ onClick }) => {
  return <button onClick={onClick}>Click me</button>;
};`,
        label: "Button.tsx",
        children: [],
      },
      {
        path: "src/utils/helpers.js",
        code: `const { createDiff } = require('diff-utils');

function generateDiff(oldText, newText) {
  return createDiff(oldText, newText);
}

export { generateDiff };`,
        label: "helpers.js",
        children: [],
      },
      {
        path: "src/types/index.ts",
        code: `export interface DiffBlock {
  type: 'added' | 'removed' | 'unchanged';
  content: string;
  lineNumber: number;
}

export type DiffResult = DiffBlock[];`,
        label: "index.ts",
        children: [],
      },
      {
        path: "tests/Button.test.tsx",
        code: `import { render } from '@testing-library/react';
import { Button } from '@/components/Button';

describe('Button', () => {
  it('should render correctly', () => {
    render(<Button onClick={() => {}} />);
  });
});`,
        label: "Button.test.tsx",
        children: [],
      },
      {
        path: "README.md",
        code: `# Project Documentation

This project uses diff libraries for comparing text.
`,
        label: "README.md",
        children: [],
      },
    ];

    mockContext = {
      flatFiles: mockFiles,
    };
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
      expect(result.content).toContain(
        "src/components/Button.tsx:1:import React from 'react';",
      );
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
      // 只检查行内容不包含 Button，而不是整个结果
      const lines = result.content.split("\n");
      const buttonLine = lines.find((line) => line.includes("<button onClick"));
      expect(buttonLine).toBeDefined();
      expect(buttonLine!.split(":").slice(2).join(":")).not.toContain("Button");
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
          exclude_pattern: "*.test.*",
          explanation: "Testing file exclusion",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/components/Button.tsx");
      expect(result.content).not.toContain("tests/Button.test.tsx");
    });

    it("should handle complex glob patterns with comma separation", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "diff",
          include_pattern: "src/**/*.ts,src/**/*.tsx,src/**/*.js",
          explanation: "Testing complex glob pattern with comma separation",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/components/Button.tsx");
      expect(result.content).toContain("src/utils/helpers.js");
      expect(result.content).not.toContain("tests/Button.test.tsx");
    });

    it("should support comma-separated file extensions", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "export",
          include_pattern: "*.ts,*.js",
          explanation: "Testing comma-separated extensions pattern",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/types/index.ts");
      expect(result.content).toContain("src/utils/helpers.js");
      expect(result.content).not.toContain("src/components/Button.tsx");
      expect(result.content).not.toContain("README.md");
    });

    it("should support brace expansion syntax like *.{ts,tsx}", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "export",
          include_pattern: "src/**/*.{ts,tsx}",
          explanation: "Testing brace expansion syntax",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/components/Button.tsx");
      expect(result.content).toContain("src/types/index.ts");
      expect(result.content).not.toContain("src/utils/helpers.js"); // .js file should be excluded
      expect(result.content).not.toContain("tests/Button.test.tsx"); // not in src/**
    });

    it("should support complex brace expansion with directories", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "Button",
          include_pattern: "{src,tests}/**/*.{ts,tsx}",
          explanation: "Testing complex brace expansion with directories",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/components/Button.tsx");
      expect(result.content).toContain("tests/Button.test.tsx");
      expect(result.content).not.toContain("src/utils/helpers.js"); // .js file should be excluded
    });

    it("should handle patterns with commas but no braces by splitting", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "function",
          include_pattern: "*.js,*.ts",
          explanation: "Testing comma-separated patterns without braces",
        },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("src/utils/helpers.js");
      expect(result.content).not.toContain("src/components/Button.tsx"); // .tsx should be excluded
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

    it("should handle invalid regex patterns", async () => {
      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "[invalid regex",
          explanation: "Testing invalid regex handling",
        },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Search failed");
    });

    it("should handle missing context", async () => {
      const result: ToolResult = await grepSearchTool.execute({
        query: "test",
        explanation: "Testing missing context",
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain("File context not available");
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
      const manyMatchesFile: FileTreeNode = {
        path: "large-file.txt",
        code: Array.from(
          { length: 100 },
          (_, i) => `Line ${i + 1}: test content`,
        ).join("\n"),
        label: "large-file.txt",
        children: [],
      };

      const contextWithManyMatches: ToolContext = {
        flatFiles: [manyMatchesFile],
      };

      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "test",
          explanation: "Testing result limit",
        },
        contextWithManyMatches,
      );

      expect(result.success).toBe(true);
      const matches = result.content.split("\n");
      expect(matches.length).toBeLessThanOrEqual(50);
    });
  });

  describe("file content without code property", () => {
    it("should skip files without code content", async () => {
      const contextWithEmptyFiles: ToolContext = {
        flatFiles: [
          {
            path: "empty-file.txt",
            label: "empty-file.txt",
            children: [],
            code: "",
            // no code property
          },
          {
            path: "file-with-content.txt",
            code: "This file has content to search",
            label: "file-with-content.txt",
            children: [],
          },
        ],
      };

      const result: ToolResult = await grepSearchTool.execute(
        {
          query: "content",
          explanation: "Testing files without code property",
        },
        contextWithEmptyFiles,
      );

      expect(result.success).toBe(true);
      expect(result.content).toContain("file-with-content.txt");
      expect(result.content).not.toContain("empty-file.txt");
    });
  });
});
