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
  const normalizedQuery = query.toLowerCase().trim();

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

  const normalizedQuery = query.toLowerCase().trim();

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

  // 将查询拆分为多个关键词（去除空格并过滤空字符串）
  const keywords = query.split(/\s+/).filter((keyword) => keyword.length > 0);

  if (keywords.length === 0) return 0;

  // 如果只有一个关键词，使用原来的逻辑
  if (keywords.length === 1) {
    return calculateSingleKeywordScore(keywords[0], filePath);
  }

  // 多关键词匹配
  return calculateMultiKeywordScore(keywords, filePath);
}

/**
 * 计算单个关键词的匹配分数
 */
function calculateSingleKeywordScore(query: string, filePath: string): number {
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

/**
 * 计算多个关键词的匹配分数
 */
function calculateMultiKeywordScore(
  keywords: string[],
  filePath: string,
): number {
  const fileName = filePath.split("/").pop() || "";
  let totalScore = 0;
  let matchedKeywords = 0;

  for (const keyword of keywords) {
    let keywordScore = 0;

    // 检查文件名中的完全匹配
    if (fileName === keyword) {
      keywordScore = 800;
    }
    // 检查文件路径中的完全匹配
    else if (filePath.includes(keyword)) {
      keywordScore = 600;
    }
    // 检查文件名中的包含匹配
    else if (fileName.includes(keyword)) {
      keywordScore = 400;
    }
    // 模糊匹配
    else {
      keywordScore = calculateFuzzyMatch(keyword, filePath);
    }

    if (keywordScore > 0) {
      matchedKeywords++;
      totalScore += keywordScore;
    }
  }

  // 必须所有关键词都匹配才返回分数，否则返回0
  if (matchedKeywords !== keywords.length) {
    return 0;
  }

  // 奖励匹配所有关键词的结果
  totalScore += 100; // 完全匹配奖励

  // 给较短的路径更高的分数（更相关）
  const lengthPenalty = filePath.length / 100;
  totalScore = Math.max(0, totalScore - lengthPenalty);

  return totalScore;
}

/**
 * 计算单个关键词的模糊匹配分数
 */
function calculateFuzzyMatch(keyword: string, filePath: string): number {
  let score = 0;
  let keywordIndex = 0;
  let consecutiveMatches = 0;

  for (let i = 0; i < filePath.length && keywordIndex < keyword.length; i++) {
    if (filePath[i] === keyword[keywordIndex]) {
      keywordIndex++;
      consecutiveMatches++;
      score += consecutiveMatches * 5; // 连续匹配给分数，但比单关键词低一些
    } else {
      consecutiveMatches = 0;
    }
  }

  // 如果没有完全匹配所有字符，返回0分
  if (keywordIndex < keyword.length) {
    return 0;
  }

  return score;
}
