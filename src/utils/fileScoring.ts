import type { FileTreeNode } from "../types/common";

/**
 * 文件评分结果
 */
export interface FileScoringResult {
  file: FileTreeNode;
  score: number;
}

/**
 * 模糊搜索文件并按相关性评分排序
 */
export function fuzzySearchFiles(
  query: string,
  files: FileTreeNode[],
): FileTreeNode[] {
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
 * 对文件列表进行评分排序（不过滤，仅排序）
 */
export function scoreAndSortFiles(
  query: string,
  files: FileTreeNode[],
): FileScoringResult[] {
  if (!query.trim()) {
    // 如果没有查询，返回原始顺序，分数为0
    return files.map((file) => ({ file, score: 0 }));
  }

  const normalizedQuery = query.toLowerCase();

  return files
    .map((file) => ({
      file,
      score: calculateFuzzyScore(normalizedQuery, file.path.toLowerCase()),
    }))
    .sort((a, b) => b.score - a.score); // 按分数降序排序
}

/**
 * 计算模糊匹配分数
 */
export function calculateFuzzyScore(query: string, filePath: string): number {
  if (!query || !filePath) return 0;

  // 如果完全匹配，给最高分
  if (filePath === query) return 1000;

  // 如果文件名完全匹配，给高分
  const fileName = filePath.split("/").pop() || "";
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

  // 如果没有完全匹配所有查询字符，返回0分（严格过滤）
  if (queryIndex < query.length) {
    return 0;
  }

  // 给较短的路径更高的分数（更相关）
  const lengthPenalty = filePath.length / 100;
  score = Math.max(0, score - lengthPenalty);

  return score;
}
