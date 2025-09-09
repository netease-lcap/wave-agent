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
 * 计算模糊匹配分数 - 支持空格分词和乱序匹配
 */
export function calculateFuzzyScore(query: string, filePath: string): number {
  if (!query || !filePath) return 0;

  // 预处理：分词并过滤空字符串
  const keywords = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const lowerFilePath = filePath.toLowerCase();
  const fileName = filePath.split("/").pop() || "";
  const lowerFileName = fileName.toLowerCase();

  // 如果没有关键词，返回0分
  if (keywords.length === 0) return 0;

  // 检查是否所有关键词都存在于文件路径中（必要条件）
  const allKeywordsMatch = keywords.every((keyword) =>
    lowerFilePath.includes(keyword),
  );
  if (!allKeywordsMatch) return 0;

  let score = 0;

  // 1. 完全匹配奖励
  if (keywords.length === 1 && lowerFilePath === keywords[0]) {
    score += 1000;
  }

  // 2. 文件名完全匹配奖励
  if (keywords.length === 1 && lowerFileName === keywords[0]) {
    score += 800;
  }

  // 3. 连续匹配奖励（原查询字符串完整出现）
  if (keywords.length > 1 && lowerFilePath.includes(query.toLowerCase())) {
    score += 600;
  }

  // 4. 文件名包含所有关键词奖励
  const fileNameContainsAll = keywords.every((keyword) =>
    lowerFileName.includes(keyword),
  );
  if (fileNameContainsAll) {
    score += 400;
  }

  // 5. 关键词匹配基础分数
  keywords.forEach((keyword) => {
    // 文件名中的匹配权重更高
    if (lowerFileName.includes(keyword)) {
      score += 100;

      // 如果在文件名开头匹配，额外加分
      if (lowerFileName.startsWith(keyword)) {
        score += 50;
      }
    } else if (lowerFilePath.includes(keyword)) {
      score += 50;

      // 如果在路径开头匹配，额外加分
      if (lowerFilePath.startsWith(keyword)) {
        score += 25;
      }
    }
  });

  // 6. 连续字符匹配奖励（类似VSCode的fuzzy matching）
  keywords.forEach((keyword) => {
    const consecutiveScore = calculateConsecutiveMatchScore(
      keyword,
      lowerFilePath,
    );
    score += consecutiveScore;
  });

  // 7. 长度惩罚：较短的路径更相关
  const lengthPenalty = lowerFilePath.length / 200;
  score = Math.max(0, score - lengthPenalty);

  // 8. 关键词数量奖励：匹配更多关键词的文件分数更高
  score += keywords.length * 10;

  return score;
}

/**
 * 计算连续字符匹配分数
 */
function calculateConsecutiveMatchScore(keyword: string, text: string): number {
  let score = 0;
  let keywordIndex = 0;
  let consecutiveMatches = 0;
  let maxConsecutiveMatches = 0;

  for (let i = 0; i < text.length && keywordIndex < keyword.length; i++) {
    if (text[i] === keyword[keywordIndex]) {
      keywordIndex++;
      consecutiveMatches++;
      maxConsecutiveMatches = Math.max(
        maxConsecutiveMatches,
        consecutiveMatches,
      );
    } else {
      consecutiveMatches = 0;
    }
  }

  // 如果完全匹配了关键词，给予分数
  if (keywordIndex === keyword.length) {
    score += maxConsecutiveMatches * 5; // 连续匹配的字符越多，分数越高
    score += (keywordIndex / keyword.length) * 20; // 完整匹配奖励
  }

  return score;
}
