import type { ToolContext, ToolPlugin, ToolResult } from './types';
import type { FileTreeNode } from '../../types/common';

/**
 * 文件搜索工具插件 - 基于模糊匹配搜索文件路径
 */
export const fileSearchTool: ToolPlugin = {
  name: 'file_search',
  description: 'Fast file search based on fuzzy matching against file path',
  config: {
    type: 'function',
    function: {
      name: 'file_search',
      description:
        "Fast file search based on fuzzy matching against file path. Use if you know part of the file path but don't know where it's located exactly. Response will be capped to 10 results. Make your query more specific if need to filter results further.",
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Fuzzy filename to search for',
          },
          explanation: {
            type: 'string',
            description:
              'One sentence explanation as to why this tool is being used, and how it contributes to the goal.',
          },
        },
        required: ['query', 'explanation'],
      },
    },
  },
  execute: async (args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> => {
    const query = args.query as string;

    if (!query || typeof query !== 'string') {
      return {
        success: false,
        content: '',
        error: 'query parameter is required and must be a string',
      };
    }

    try {
      // 从 context 中获取文件列表，如果没有则返回错误
      if (!context || !context.flatFiles) {
        return {
          success: false,
          content: '',
          error: 'File context not available. Cannot search in memory.',
        };
      }

      const flatFiles = context.flatFiles as FileTreeNode[];

      // 进行模糊匹配
      const results = fuzzySearch(query, flatFiles);

      // 限制结果数量为10
      const limitedResults = results.slice(0, 10);

      if (limitedResults.length === 0) {
        return {
          success: true,
          content: 'No matching files found',
          shortResult: 'No files found',
        };
      }

      // 格式化输出
      const output = limitedResults
        .map((result, index) => {
          // 通过检查是否有children来判断是否为目录
          const isDirectory = result.children && result.children.length > 0;
          const fileInfo = isDirectory ? 'directory' : 'file';
          // 通过代码内容长度来估算大小
          const sizeInfo = result.code ? ` (${result.code.length} chars)` : '';
          return `${index + 1}. ${result.path} (${fileInfo})${sizeInfo}`;
        })
        .join('\n');

      return {
        success: true,
        content: output,
        shortResult: `Found ${limitedResults.length} file${limitedResults.length === 1 ? '' : 's'}${results.length > 10 ? ' (top 10)' : ''}`,
      };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: `File search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
};

/**
 * 模糊搜索文件
 */
function fuzzySearch(query: string, files: FileTreeNode[]): FileTreeNode[] {
  const normalizedQuery = query.toLowerCase();

  // 计算匹配分数的结果
  const scored = files
    .map((file) => ({
      file,
      score: calculateFuzzyScore(normalizedQuery, file.path.toLowerCase()),
    }))
    .filter((item) => item.score > 0) // 只保留有匹配的结果
    .sort((a, b) => b.score - a.score); // 按分数降序排序

  return scored.map((item) => item.file);
}

/**
 * 计算模糊匹配分数
 */
function calculateFuzzyScore(query: string, filePath: string): number {
  if (!query || !filePath) return 0;

  // 如果完全匹配，给最高分
  if (filePath === query) return 1000;

  // 如果文件名完全匹配，给高分
  const fileName = filePath.split('/').pop() || '';
  if (fileName === query) return 800;

  // 如果包含完整查询字符串，给较高分
  if (filePath.includes(query)) return 600;

  // 如果文件名包含查询字符串，给中等分数
  if (fileName.includes(query)) return 400;

  // 模糊匹配：检查查询字符串的字符是否按顺序出现在文件路径中
  let score = 0;
  let queryIndex = 0;
  let consecutiveMatches = 0;

  for (let i = 0; i < filePath.length && queryIndex < query.length; i++) {
    if (filePath[i] === query[queryIndex]) {
      queryIndex++;
      consecutiveMatches++;
      score += consecutiveMatches * 10; // 连续匹配给更高分数
    } else {
      consecutiveMatches = 0;
    }
  }

  // 如果没有完全匹配所有查询字符，降低分数
  if (queryIndex < query.length) {
    score = score * (queryIndex / query.length);
  }

  // 给较短的路径更高的分数（更相关）
  const lengthPenalty = filePath.length / 100;
  score = Math.max(0, score - lengthPenalty);

  return score;
}
