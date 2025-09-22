import * as fs from "fs";
import * as path from "path";

/**
 * 通用的忽略目录和文件模式
 * 可以被多个工具复用（glob, ripgrep, 等）
 */
export const COMMON_IGNORE_PATTERNS = {
  // 依赖和构建目录
  dependencies: [
    "node_modules/**",
    ".git/**",
    "dist/**",
    "build/**",
    ".next/**",
    "coverage/**",
    ".nyc_output/**",
    "tmp/**",
    "temp/**",
  ],

  // 缓存和临时文件
  cache: ["*.log", "*.cache", ".DS_Store", "Thumbs.db", "*~", "*.swp", "*.swo"],

  // 编辑器和 IDE 文件
  editor: [".vscode/**", ".idea/**", "*.sublime-*"],

  // 操作系统相关
  os: [".DS_Store", "Thumbs.db", "desktop.ini"],
};

/**
 * 获取所有通用忽略模式的扁平数组
 */
export const getAllIgnorePatterns = (): string[] => {
  return [
    ...COMMON_IGNORE_PATTERNS.dependencies,
    ...COMMON_IGNORE_PATTERNS.cache,
    ...COMMON_IGNORE_PATTERNS.editor,
    ...COMMON_IGNORE_PATTERNS.os,
  ];
};

/**
 * 解析 .gitignore 文件并转换为 glob 模式
 * @param workdir 工作目录
 * @returns glob 忽略模式数组
 */
export const parseGitignoreToGlob = (workdir: string): string[] => {
  const patterns: string[] = [];

  try {
    const gitignorePath = path.join(workdir, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");

      const lines = gitignoreContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));

      for (const line of lines) {
        // 跳过否定规则（以 ! 开头）
        if (line.startsWith("!")) {
          continue;
        }

        let pattern = line;

        // 处理以 / 开头的模式（相对于根目录）
        if (pattern.startsWith("/")) {
          pattern = pattern.slice(1); // 移除开头的 /
        }

        // 如果是目录模式（以 / 结尾）
        if (pattern.endsWith("/")) {
          patterns.push(`${pattern.slice(0, -1)}/**`); // 目录及其所有子内容
        } else {
          // 文件模式
          patterns.push(pattern);
          // 如果没有通配符且不包含扩展名，也作为目录处理
          if (!pattern.includes("*") && !pattern.includes(".")) {
            patterns.push(`${pattern}/**`);
          }
        }
      }
    }
  } catch {
    // 忽略读取 .gitignore 文件时的错误
  }

  return patterns;
};

/**
 * 获取用于 glob 搜索的忽略模式
 * @param workdir 工作目录，用于解析 .gitignore 文件
 */
export const getGlobIgnorePatterns = (workdir?: string): string[] => {
  const patterns = getAllIgnorePatterns();

  // 如果提供了工作目录，解析 .gitignore 文件
  if (workdir) {
    patterns.push(...parseGitignoreToGlob(workdir));
  }

  return patterns;
};
