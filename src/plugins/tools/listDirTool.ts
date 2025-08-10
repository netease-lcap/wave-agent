import * as fs from 'fs';
import * as path from 'path';
import type { ToolPlugin, ToolResult, ToolContext } from './types';
import { isBinary } from '../../types/common';

/**
 * 列出目录内容工具插件
 */
export const listDirTool: ToolPlugin = {
  name: 'list_dir',
  description: 'List the contents of a directory',
  config: {
    type: 'function',
    function: {
      name: 'list_dir',
      description:
        'List the contents of a directory. The quick tool to use for discovery, before using more targeted tools like semantic search or file reading. Useful to try to understand the file structure before diving deeper into specific files. Can be used to explore the codebase.',
      parameters: {
        type: 'object',
        properties: {
          relative_workspace_path: {
            type: 'string',
            description: 'Path to list contents of, relative to the workspace root.',
          },
          explanation: {
            type: 'string',
            description:
              'One sentence explanation as to why this tool is being used, and how it contributes to the goal.',
          },
        },
        required: ['relative_workspace_path'],
      },
    },
  },
  execute: async (args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> => {
    const relativePath = args.relative_workspace_path as string;

    if (!relativePath || typeof relativePath !== 'string') {
      return {
        success: false,
        content: '',
        error: 'relative_workspace_path parameter is required and must be a string',
      };
    }

    if (!context?.workdir) {
      return {
        success: false,
        content: '',
        error: 'Context with workdir is required',
      };
    }

    try {
      // 构建完整路径
      const fullPath = path.resolve(context.workdir, relativePath === '.' ? '' : relativePath);

      // 检查路径是否存在且是目录
      const stats = await fs.promises.stat(fullPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          content: '',
          error: `Path ${relativePath} is not a directory`,
        };
      }

      // 读取目录内容
      const entries = await fs.promises.readdir(fullPath, { withFileTypes: true });

      // 处理目录项
      const items: { name: string; type: string; size?: number }[] = [];

      for (const entry of entries) {
        const entryPath = path.join(fullPath, entry.name);

        if (entry.isDirectory()) {
          items.push({
            name: entry.name,
            type: 'directory',
          });
        } else if (entry.isFile()) {
          try {
            const fileStats = await fs.promises.stat(entryPath);
            items.push({
              name: entry.name,
              type: 'file',
              size: fileStats.size,
            });
          } catch {
            // 如果无法获取文件统计信息，仍然添加文件但不显示大小
            items.push({
              name: entry.name,
              type: 'file',
            });
          }
        }
      }

      // Sort: directories first, then files, both alphabetically
      items.sort((a, b) => {
        if (a.type === 'directory' && b.type !== 'directory') return -1;
        if (a.type !== 'directory' && b.type === 'directory') return 1;
        return a.name.localeCompare(b.name);
      });

      let content = `Directory: ${relativePath}\n`;
      content += `Total items: ${items.length}\n\n`;

      for (const item of items) {
        const typeIndicator = item.type === 'directory' ? '📁' : '📄';
        const sizeInfo = item.size !== undefined ? ` (${item.size} bytes)` : '';
        const binaryInfo = item.type === 'file' && isBinary(item.name) ? ' [binary]' : '';
        content += `${typeIndicator} ${item.name}${sizeInfo}${binaryInfo}\n`;
      }

      return {
        success: true,
        content: content.trim(),
        shortResult: `${items.length} items (${items.filter((i) => i.type === 'directory').length} dirs, ${items.filter((i) => i.type === 'file').length} files)`,
      };
    } catch (error) {
      return {
        success: false,
        content: '',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
};
