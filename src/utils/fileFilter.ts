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
