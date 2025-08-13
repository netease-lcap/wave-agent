import type { ToolContext, ToolPlugin, ToolResult } from "./types";
import type { FileTreeNode } from "../../types/common";
import { fuzzySearchFiles } from "../../utils/fileScoring";

/**
 * 文件搜索工具插件 - 基于模糊匹配搜索文件路径
 */
export const fileSearchTool: ToolPlugin = {
  name: "file_search",
  description: "Fast file search based on fuzzy matching against file path",
  config: {
    type: "function",
    function: {
      name: "file_search",
      description:
        "Fast file search based on fuzzy matching against file path. Use if you know part of the file path but don't know where it's located exactly. Response will be capped to 10 results. Make your query more specific if need to filter results further.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Fuzzy filename to search for",
          },
          explanation: {
            type: "string",
            description:
              "One sentence explanation as to why this tool is being used, and how it contributes to the goal.",
          },
        },
        required: ["query", "explanation"],
      },
    },
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<ToolResult> => {
    const query = args.query as string;

    if (!query || typeof query !== "string") {
      return {
        success: false,
        content: "",
        error: "query parameter is required and must be a string",
      };
    }

    try {
      // 从 context 中获取文件列表，如果没有则返回错误
      if (!context || !context.flatFiles) {
        return {
          success: false,
          content: "",
          error: "File context not available. Cannot search in memory.",
        };
      }

      const flatFiles = context.flatFiles as FileTreeNode[];

      // 进行模糊匹配
      const results = fuzzySearchFiles(query, flatFiles);

      // 限制结果数量为10
      const limitedResults = results.slice(0, 10);

      if (limitedResults.length === 0) {
        return {
          success: true,
          content: "No matching files found",
          shortResult: "No files found",
        };
      }

      // 格式化输出
      const output = limitedResults
        .map((result, index) => {
          // 通过检查是否有children来判断是否为目录
          const isDirectory = result.children && result.children.length > 0;
          const fileInfo = isDirectory ? "directory" : "file";
          // 通过代码内容长度来估算大小
          const sizeInfo = result.code ? ` (${result.code.length} chars)` : "";
          return `${index + 1}. ${result.path} (${fileInfo})${sizeInfo}`;
        })
        .join("\n");

      return {
        success: true,
        content: output,
        shortResult: `Found ${limitedResults.length} file${limitedResults.length === 1 ? "" : "s"}${results.length > 10 ? " (top 10)" : ""}`,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: `File search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};
