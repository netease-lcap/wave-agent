import * as fs from "fs";
import * as path from "path";
import ignore from "ignore";

export interface FileFilter {
  shouldIgnore: (filePath: string, isDirectory?: boolean) => boolean;
}

/**
 * 递归收集所有目录中的 .gitignore 文件内容
 * @param dir 要搜索的目录
 * @param ignoreInstance ignore 实例
 * @param rootDir 根目录，用于计算相对路径
 */
export const collectGitignoreFiles = (
  dir: string,
  ignoreInstance: ReturnType<typeof ignore>,
  rootDir: string,
): void => {
  try {
    const gitignorePath = path.join(dir, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");

      // 如果不是根目录的 .gitignore，需要添加路径前缀
      if (dir !== rootDir) {
        const relativeDirPath = path.relative(rootDir, dir);
        const normalizedDirPath = relativeDirPath.replace(/\\/g, "/");

        // 为每个规则添加目录前缀
        const prefixedRules = gitignoreContent
          .split("\n")
          .map((line) => line.trim())
          .filter((line) => line && !line.startsWith("#"))
          .map((rule) => {
            // 如果规则以 / 开头，表示相对于当前 .gitignore 所在目录
            if (rule.startsWith("/")) {
              return `${normalizedDirPath}${rule}`;
            }
            // 否则在规则前添加目录路径
            return `${normalizedDirPath}/${rule}`;
          });

        if (prefixedRules.length > 0) {
          ignoreInstance.add(prefixedRules);
        }
      } else {
        // 根目录的 .gitignore 直接添加
        ignoreInstance.add(gitignoreContent);
      }
    }

    // 递归搜索子目录
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const subDir = path.join(dir, entry.name);

        // 跳过一些明显不需要搜索的目录
        if (
          entry.name === ".git" ||
          entry.name === "node_modules" ||
          entry.name === "dist" ||
          entry.name === "build"
        ) {
          continue;
        }

        collectGitignoreFiles(subDir, ignoreInstance, rootDir);
      }
    }
  } catch {
    // 忽略读取错误，继续处理其他目录
  }
};

/**
 * 创建文件过滤器，用于处理文件和目录的忽略逻辑
 * @param workdir 工作目录
 * @returns 文件过滤器对象
 */
export const createFileFilter = (workdir: string): FileFilter => {
  const defaultIgnorePatterns = [
    ".git",
    "node_modules",
    ".DS_Store",
    "*~",
    "dist",
    "build",
  ];
  const ignoreInstance = ignore().add(defaultIgnorePatterns);

  // 递归收集所有 .gitignore 文件
  collectGitignoreFiles(workdir, ignoreInstance, workdir);

  return {
    shouldIgnore: (filePath: string, isDirectory = false): boolean => {
      // Convert absolute path to relative path
      const relativePath = path.relative(workdir, filePath);

      // Skip empty or invalid paths
      if (!relativePath || relativePath === ".") {
        return false;
      }

      // Normalize path separators for cross-platform compatibility
      const normalizedPath = relativePath.replace(/\\/g, "/");

      // Check if file should be ignored
      if (isDirectory && !normalizedPath.endsWith("/")) {
        return (
          ignoreInstance.ignores(normalizedPath) ||
          ignoreInstance.ignores(normalizedPath + "/")
        );
      }

      return ignoreInstance.ignores(normalizedPath);
    },
  };
};

/**
 * 解析 .gitignore 文件并转换为适合 grep 命令的排除参数
 * @param workdir 工作目录
 * @returns 适合 grep --exclude-dir 和 --exclude 参数的模式数组
 */
export const parseGitignoreForGrep = (
  workdir: string,
): {
  excludeDirs: string[];
  excludeFiles: string[];
} => {
  const excludeDirs: string[] = [];
  const excludeFiles: string[] = [];

  // 默认排除的目录
  const defaultExcludeDirs = ["node_modules", ".git", "dist", "build"];
  excludeDirs.push(...defaultExcludeDirs);

  try {
    const gitignorePath = path.join(workdir, ".gitignore");
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, "utf8");

      const lines = gitignoreContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));

      for (const line of lines) {
        // 跳过否定规则（以 ! 开头），grep 不支持
        if (line.startsWith("!")) {
          continue;
        }

        // 移除开头的 /，因为 grep 的 exclude 参数不支持
        const pattern = line.startsWith("/") ? line.slice(1) : line;

        // 如果是目录模式（以 / 结尾）
        if (pattern.endsWith("/")) {
          excludeDirs.push(pattern.slice(0, -1)); // 移除结尾的 /
        }
        // 以点开头的目录（如 .git, .nyc_output），但不是文件名（不包含文件扩展名特征）
        else if (
          pattern.startsWith(".") &&
          !pattern.includes("*") &&
          !pattern.includes("/")
        ) {
          // 判断是否是隐藏文件（包含明显的文件扩展名或常见文件名）
          const commonHiddenFiles = [
            ".env",
            ".DS_Store",
            ".npmrc",
            ".gitignore",
            ".eslintrc",
          ];
          const hasFileExtension = /\.[a-zA-Z0-9]+$/.test(pattern.slice(1)); // 去掉开头的点后检查扩展名

          if (commonHiddenFiles.includes(pattern) || hasFileExtension) {
            excludeFiles.push(pattern);
          } else {
            excludeDirs.push(pattern);
          }
        }
        // 常见的目录模式（不包含扩展名且没有通配符的模式）
        else if (
          !pattern.includes(".") &&
          !pattern.includes("*") &&
          !pattern.includes("/")
        ) {
          excludeDirs.push(pattern);
        }
        // 包含通配符的模式
        else if (pattern.includes("*")) {
          excludeFiles.push(pattern);
        }
        // 具体的文件名或扩展名模式
        else {
          excludeFiles.push(pattern);
        }
      }
    }
  } catch {
    // 忽略读取错误，继续使用默认排除模式
  }

  return { excludeDirs, excludeFiles };
};
