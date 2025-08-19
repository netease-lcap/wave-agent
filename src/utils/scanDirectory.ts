import * as fs from "fs";
import * as path from "path";
import type { FileTreeNode } from "../types/common";
import { isBinary } from "../types/common";
import type { FileFilter } from "./fileFilter";
import { logger } from "./logger";

/**
 * 文件扫描上下文
 */
interface ScanContext {
  fileCount: number;
  maxFileCount: number;
  maxFileSize: number;
}

/**
 * 扫描目录并构建文件树
 * @param dirPath 目录路径
 * @param fileFilter 文件过滤器
 * @param relativePath 相对路径
 * @param context 扫描上下文（包含计数器和限制）
 * @returns 文件树节点数组
 */
export const scanDirectory = async (
  dirPath: string,
  fileFilter: FileFilter,
  relativePath = "",
  context?: ScanContext,
): Promise<FileTreeNode[]> => {
  const items: FileTreeNode[] = [];

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const entryRelativePath = relativePath
        ? `${relativePath}/${entry.name}`
        : entry.name;

      // Check if file/directory should be ignored using file filter
      if (fileFilter.shouldIgnore(fullPath, entry.isDirectory())) {
        continue;
      }

      if (entry.isDirectory()) {
        const children = await scanDirectory(
          fullPath,
          fileFilter,
          entryRelativePath,
          context,
        );
        if (children.length > 0) {
          items.push({
            label: entry.name,
            path: entryRelativePath,
            children,
          });
        }
      } else {
        // 文件数量限制检查
        if (context) {
          context.fileCount++;
          if (context.fileCount > context.maxFileCount) {
            throw new Error(
              `FILE_COUNT_LIMIT: Directory contains more than ${context.maxFileCount} files. Please select a smaller directory or add more ignore patterns.`,
            );
          }
        }

        try {
          // 获取文件大小
          const stats = await fs.promises.stat(fullPath);
          const fileSize = stats.size;

          // 文件大小限制检查 - 改为警告而非错误
          if (context && fileSize > context.maxFileSize) {
            const fileSizeMB = (fileSize / (1024 * 1024)).toFixed(2);
            const limitSizeMB = (context.maxFileSize / (1024 * 1024)).toFixed(
              2,
            );

            // 记录警告日志
            logger.warn(
              `FILE_SIZE_LIMIT: File "${entryRelativePath}" (${fileSizeMB}MB) exceeds size limit of ${limitSizeMB}MB. Content will be empty.`,
            );

            // 添加文件节点但不读取内容
            items.push({
              label: entry.name,
              path: entryRelativePath,
              children: [],
              isBinary: isBinary(entry.name),
              fileSize: fileSize,
              oversized: true, // 标记为超大文件
            });
            continue; // 跳过后续处理
          }

          // 添加文件节点但不读取内容
          items.push({
            label: entry.name,
            path: entryRelativePath,
            children: [],
            isBinary: isBinary(entry.name),
            fileSize: fileSize,
          });
        } catch (error) {
          // FILE_COUNT_LIMIT错误需要重新抛出
          if (
            error instanceof Error &&
            error.message.startsWith("FILE_COUNT_LIMIT:")
          ) {
            throw error;
          }
          // FILE_SIZE_LIMIT错误已经在上面处理，不再重新抛出
          // Skip files that can't be read
          continue;
        }
      }
    }
  } catch (error) {
    // FILE_COUNT_LIMIT错误需要重新抛出
    if (
      error instanceof Error &&
      error.message.startsWith("FILE_COUNT_LIMIT:")
    ) {
      throw error;
    }
    // FILE_SIZE_LIMIT错误已经在上面处理，不再重新抛出
    logger.error(`Error scanning directory ${dirPath}:`, error);
  }

  return items;
};
