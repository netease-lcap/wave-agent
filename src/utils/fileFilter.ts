import * as fs from 'fs';
import * as path from 'path';
import ignore from 'ignore';

export interface FileFilter {
  shouldIgnore: (filePath: string, isDirectory?: boolean) => boolean;
}

/**
 * 创建文件过滤器，用于处理文件和目录的忽略逻辑
 * @param workdir 工作目录
 * @param ignorePatterns 额外的忽略模式
 * @returns 文件过滤器对象
 */
export const createFileFilter = (workdir: string, ignorePatterns?: string[]): FileFilter => {
  const defaultIgnorePatterns = ['.git', 'node_modules', '.DS_Store', '*~', 'dist', 'build'];
  const ignoreInstance = ignore().add(defaultIgnorePatterns);
  
  // Add additional ignore patterns if provided
  if (ignorePatterns && ignorePatterns.length > 0) {
    ignoreInstance.add(ignorePatterns);
  }

  // Try to read .gitignore if it exists
  try {
    const gitignorePath = path.join(workdir, '.gitignore');
    if (fs.existsSync(gitignorePath)) {
      const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
      ignoreInstance.add(gitignoreContent);
    }
  } catch {
    // Ignore errors reading .gitignore
  }

  return {
    shouldIgnore: (filePath: string, isDirectory = false): boolean => {
      // Convert absolute path to relative path
      const relativePath = path.relative(workdir, filePath);
      
      // Skip empty or invalid paths
      if (!relativePath || relativePath === '.') {
        return false;
      }

      // Normalize path separators for cross-platform compatibility
      const normalizedPath = relativePath.replace(/\\/g, '/');
      
      // Check if file should be ignored
      if (isDirectory && !normalizedPath.endsWith('/')) {
        return ignoreInstance.ignores(normalizedPath) || ignoreInstance.ignores(normalizedPath + '/');
      }
      
      return ignoreInstance.ignores(normalizedPath);
    }
  };
};