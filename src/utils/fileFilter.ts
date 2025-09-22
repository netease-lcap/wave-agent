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
 * 递归查找目录中的所有 .gitignore 文件
 * @param dir 要搜索的目录
 * @param maxDepth 最大递归深度，防止过深的搜索
 * @returns .gitignore 文件路径数组
 */
const findAllGitignoreFiles = (dir: string, maxDepth: number = 5): string[] => {
  const gitignoreFiles: string[] = [];

  if (maxDepth <= 0) return gitignoreFiles;

  try {
    const items = fs.readdirSync(dir, { withFileTypes: true });

    for (const item of items) {
      const fullPath = path.join(dir, item.name);

      if (item.isFile() && item.name === ".gitignore") {
        gitignoreFiles.push(fullPath);
      } else if (item.isDirectory() && !shouldSkipDirectory(item.name)) {
        // 递归搜索子目录，但跳过一些明显不需要的目录
        gitignoreFiles.push(...findAllGitignoreFiles(fullPath, maxDepth - 1));
      }
    }
  } catch {
    // 忽略权限错误等问题
  }

  return gitignoreFiles;
};

/**
 * 判断是否应该跳过某个目录的搜索
 */
const shouldSkipDirectory = (dirName: string): boolean => {
  const skipDirs = [
    "node_modules",
    ".git",
    "dist",
    "build",
    ".next",
    "coverage",
    ".nyc_output",
    "tmp",
    "temp",
    ".cache",
  ];
  return skipDirs.includes(dirName);
};

/**
 * 解析单个 .gitignore 文件内容
 * @param gitignorePath .gitignore 文件路径
 * @param basePath 基础路径，用于计算相对路径
 * @returns 解析出的 glob 模式数组
 */
const parseGitignoreFile = (
  gitignorePath: string,
  basePath: string,
): string[] => {
  const patterns: string[] = [];

  try {
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");
      const gitignoreDir = path.dirname(gitignorePath);
      // 计算相对于基础路径的相对目录
      const relativeDirFromBase = path.relative(basePath, gitignoreDir);

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

        // 处理以 / 开头的模式（相对于当前 .gitignore 文件所在目录）
        if (pattern.startsWith("/")) {
          pattern = pattern.slice(1); // 移除开头的 /
        }

        // 如果 .gitignore 在子目录中，需要添加路径前缀
        if (relativeDirFromBase && relativeDirFromBase !== ".") {
          pattern = path.posix.join(relativeDirFromBase, pattern);
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
 * 解析工作目录及其子目录中的所有 .gitignore 文件并转换为 glob 模式
 * @param workdir 工作目录
 * @returns glob 忽略模式数组
 */
export const parseGitignoreToGlob = (workdir: string): string[] => {
  const patterns: string[] = [];

  try {
    // 查找所有 .gitignore 文件
    const gitignoreFiles = findAllGitignoreFiles(workdir);

    // 解析每个 .gitignore 文件
    for (const gitignoreFile of gitignoreFiles) {
      patterns.push(...parseGitignoreFile(gitignoreFile, workdir));
    }
  } catch {
    // 忽略搜索过程中的错误
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
