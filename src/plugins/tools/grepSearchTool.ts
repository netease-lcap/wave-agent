import type { ToolContext, ToolPlugin, ToolResult } from "./types";
import type { FileTreeNode } from "../../types/common";
import micromatch from "micromatch";

/**
 * Grep搜索工具插件 - 从内存中搜索文件内容
 */
export const grepSearchTool: ToolPlugin = {
  name: "grep_search",
  description: "Search for text patterns in files loaded in memory",
  config: {
    type: "function",
    function: {
      name: "grep_search",
      description:
        "### Instructions:\nThis is best for finding exact text matches or regex patterns.\nThis is preferred over semantic search when we know the exact symbol/function name/etc. to search in some set of directories/file types.\n\nUse this tool to run fast, exact regex searches over text files.\nTo avoid overwhelming output, the results are capped at 50 matches.\nUse the include or exclude patterns to filter the search scope by file type or specific paths.\n\n- Always escape special regex characters: ( ) [ ] { } + * ? ^ $ | . \\\n- Use `\\` to escape any of these characters when they appear in your search string.\n- Do NOT perform fuzzy or semantic matches.\n- Return only a valid regex pattern string.\n\n### Examples:\n| Literal               | Regex Pattern            |\n|-----------------------|--------------------------|\n| function(             | function\\(              |\n| value[index]          | value\\[index\\]         |\n| file.txt               | file\\.txt                |\n| user|admin            | user\\|admin             |\n| path\\to\\file         | path\\\\to\\\\file        |\n| hello world           | hello world              |\n| foo\\(bar\\)          | foo\\\\(bar\\\\)         |",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The regex pattern to search for",
          },
          include_pattern: {
            type: "string",
            description:
              "Glob pattern for files to include (e.g. '*.ts' for TypeScript files, or '*.ts,*.js,*.vue' for multiple file types)",
          },
          exclude_pattern: {
            type: "string",
            description: "Glob pattern for files to exclude",
          },
          case_sensitive: {
            type: "boolean",
            description: "Whether the search should be case sensitive",
          },
          explanation: {
            type: "string",
            description:
              "One sentence explanation as to why this tool is being used, and how it contributes to the goal.",
          },
        },
        required: ["query"],
      },
    },
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<ToolResult> => {
    const query = args.query as string;
    const includePattern = args.include_pattern as string;
    const excludePattern = args.exclude_pattern as string;
    const caseSensitive = args.case_sensitive as boolean;

    if (!query || typeof query !== "string") {
      return {
        success: false,
        content: "",
        error: "query parameter is required and must be a string",
      };
    }

    try {
      // 创建正则表达式
      const flags = caseSensitive ? "g" : "gi";
      const regex = new RegExp(query, flags);

      // 搜索结果
      const results: string[] = [];
      const maxResults = 50;

      // 从 context 中获取文件列表，如果没有则返回错误
      if (!context || !context.flatFiles) {
        return {
          success: false,
          content: "",
          error: "File context not available. Cannot search in memory.",
        };
      }

      const flatFiles = context.flatFiles as FileTreeNode[];

      // 遍历内存中的文件
      for (const file of flatFiles) {
        if (results.length >= maxResults) break;

        // 跳过没有内容的文件
        if (!file.code) continue;

        // 检查文件是否匹配包含/排除模式
        if (!shouldIncludeFile(file.path, includePattern, excludePattern)) {
          continue;
        }

        // 在文件内容中搜索
        const lines = file.code.split("\n");
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= maxResults) break;

          const line = lines[i];
          if (regex.test(line)) {
            results.push(`${file.path}:${i + 1}:${line}`);
          }
        }
      }

      if (results.length === 0) {
        return {
          success: true,
          content: "No matches found",
          shortResult: "No matches found",
        };
      }

      return {
        success: true,
        content: results.join("\n"),
        shortResult: `Found ${results.length} matches${results.length === maxResults ? " (capped)" : ""}`,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    const query = params.query as string;
    const includePattern = params.include_pattern as string;

    if (!query) return "";

    if (includePattern) {
      return `${query}, ${includePattern}`;
    }

    return query;
  },
};

/**
 * 检查文件是否应该被包含在搜索中
 */
function shouldIncludeFile(
  filePath: string,
  includePattern?: string,
  excludePattern?: string,
): boolean {
  // 如果有包含模式，检查是否匹配
  if (includePattern) {
    if (!matchesGlobPattern(filePath, includePattern)) {
      return false;
    }
  }

  // 如果有排除模式，检查是否匹配
  if (excludePattern) {
    if (matchesGlobPattern(filePath, excludePattern)) {
      return false;
    }
  }

  return true;
}

/**
 * 检查文件路径是否匹配 glob 模式
 * 使用 micromatch 库，支持花括号语法如 *.{ts,tsx}
 * 如果模式包含逗号但没有花括号，则按逗号分割处理
 */
function matchesGlobPattern(filePath: string, pattern: string): boolean {
  if (!pattern || pattern.trim() === "") {
    return false;
  }

  // 标准化路径，确保使用正斜杠
  const normalizedPath = filePath.replace(/\\/g, "/");

  // 处理模式
  let patterns: string[];

  // 如果模式包含花括号，直接使用 micromatch 处理（支持 *.{ts,tsx} 语法）
  if (pattern.includes("{") && pattern.includes("}")) {
    patterns = [pattern.trim()];
  }
  // 如果模式包含逗号但没有花括号，按逗号分割
  else if (pattern.includes(",")) {
    patterns = pattern
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
  }
  // 否则作为单个模式处理
  else {
    patterns = [pattern.trim()];
  }

  // 自动为简单模式添加 **/ 前缀以匹配任意路径深度
  const normalizedPatterns = patterns.map((p) => {
    // 如果模式不包含 / 且以 * 开头，自动添加 **/ 前缀
    if (!p.includes("/") && p.startsWith("*")) {
      return `**/${p}`;
    }
    return p;
  });

  // 使用 micromatch 进行匹配
  return micromatch.isMatch(normalizedPath, normalizedPatterns, {
    dot: true, // 匹配以点开头的文件
  });
}
