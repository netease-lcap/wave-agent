import * as fs from 'fs';
import * as path from 'path';
import type { FileTreeNode } from '../types/common';
import { isBinary } from '../types/common';
import type { FileFilter } from './fileFilter';
import { logger } from './logger';

/**
 * 扫描目录并构建文件树
 * @param dirPath 目录路径
 * @param fileFilter 文件过滤器
 * @param relativePath 相对路径
 * @returns 文件树节点数组
 */
export const scanDirectory = async (
  dirPath: string,
  fileFilter: FileFilter,
  relativePath = '',
): Promise<FileTreeNode[]> => {
  const items: FileTreeNode[] = [];

  try {
    const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const entryRelativePath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

      // Check if file/directory should be ignored using file filter
      if (fileFilter.shouldIgnore(fullPath, entry.isDirectory())) {
        continue;
      }

      if (entry.isDirectory()) {
        const children = await scanDirectory(fullPath, fileFilter, entryRelativePath);
        if (children.length > 0) {
          items.push({
            label: entry.name,
            path: entryRelativePath,
            children,
            code: '',
          });
        }
      } else {
        try {
          if (isBinary(entry.name)) {
            // 对于二进制文件，不读取内容，但添加文件节点
            items.push({
              label: entry.name,
              path: entryRelativePath,
              code: '',
              children: [],
              isBinary: true,
            });
          } else {
            // 对于文本文件，读取内容
            const content = await fs.promises.readFile(fullPath, 'utf-8');
            items.push({
              label: entry.name,
              path: entryRelativePath,
              code: content,
              children: [],
            });
          }
        } catch {
          // Skip files that can't be read
          continue;
        }
      }
    }
  } catch (error) {
    logger.error(`Error scanning directory ${dirPath}:`, error);
  }

  return items;
};
