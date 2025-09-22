import { glob } from "glob";
import type { ToolContext, ToolPlugin, ToolResult } from "./types";
import { resolvePath } from "../utils/path";
import { getGlobIgnorePatterns } from "../utils/fileFilter";

/**
 * 文件搜索工具插件 - 使用 glob 进行快速文件搜索
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

    if (!query || typeof query !== "string") {
      return {
        success: false,
        content: "",
        error: "query parameter is required and must be a string",
      };
    }

    try {
      const workdir = resolvePath(".", context?.workdir);

      // 预处理查询字符串
      const cleanQuery = query.trim().toLowerCase();
      const queryParts = cleanQuery
        .split(/\s+/)
        .filter((part) => part.length > 0);

      // 如果是空查询，返回错误
      if (queryParts.length === 0) {
        return {
          success: false,
          content: "",
          error: "Query cannot be empty",
        };
      }

      // 构建搜索模式
      const patterns = [];

      // 对于单个查询词，创建基本模式
      if (queryParts.length === 1) {
        const term = queryParts[0];
        patterns.push(
          `**/*${term}*`, // 包含查询字符串的文件
          `**/${term}`, // 精确匹配文件名
          `**/${term}.*`, // 匹配带扩展名的文件
          `**/*.${term}`, // 匹配扩展名
        );
      } else {
        // 对于多个查询词，为每个词创建模式
        for (const term of queryParts) {
          patterns.push(`**/*${term}*`);
        }
      }

      const allMatches = new Set<string>();

      // 对每个模式进行搜索
      for (const pattern of patterns) {
        try {
          const matches = await glob(pattern, {
            cwd: workdir,
            ignore: getGlobIgnorePatterns(workdir),
            dot: false,
            absolute: false,
            nocase: true, // 不区分大小写
          });

          matches.forEach((match) => allMatches.add(match));
        } catch {
          // 忽略单个模式的错误，继续其他模式
          continue;
        }
      }

      // 转换为数组并排序
      const results = Array.from(allMatches).sort();

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
          return `${index + 1}. ${result}`;
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
  formatCompactParams: (params: Record<string, unknown>) => {
    const query = params.query as string;
    return query || "";
  },
};
