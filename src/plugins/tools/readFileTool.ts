import { readFile } from 'fs/promises';
import { resolve } from 'path';
import type { ToolPlugin, ToolResult, ToolContext } from './types';
import { logger } from '../../utils/logger';

/**
 * 读取文件工具插件
 */
export const readFileTool: ToolPlugin = {
  name: 'read_file',
  description: 'Read the contents of a file',
  config: {
    type: 'function',
    function: {
      name: 'read_file',
      description:
        "Read the contents of a file. the output of this tool call will be the 1-indexed file contents from start_line_one_indexed to end_line_one_indexed_inclusive, together with a summary of the lines outside start_line_one_indexed and end_line_one_indexed_inclusive.\nNote that this call can view at most 250 lines at a time and 200 lines minimum.\n\nWhen using this tool to gather information, it's your responsibility to ensure you have the COMPLETE context. Specifically, each time you call this command you should:\n1) Assess if the contents you viewed are sufficient to proceed with your task.\n2) Take note of where there are lines not shown.\n3) If the file contents you have viewed are insufficient, and you suspect they may be in lines not shown, proactively call the tool again to view those lines.\n4) When in doubt, call this tool again to gather more information. Remember that partial file views may miss critical dependencies, imports, or functionality.\n\nIn some cases, if reading a range of lines is not enough, you may choose to read the entire file.\nReading entire files is often wasteful and slow, especially for large files (i.e. more than a few hundred lines). So you should use this option sparingly.\nReading the entire file is not allowed in most cases. You are only allowed to read the entire file if it has been edited or manually attached to the conversation by the user.",
      parameters: {
        type: 'object',
        properties: {
          target_file: {
            type: 'string',
            description:
              'The path of the file to read. You can use either a relative path in the workspace or an absolute path. If an absolute path is provided, it will be preserved as is.',
          },
          should_read_entire_file: {
            type: 'boolean',
            description: 'Whether to read the entire file. Defaults to false.',
          },
          start_line_one_indexed: {
            type: 'integer',
            description: 'The one-indexed line number to start reading from (inclusive).',
          },
          end_line_one_indexed_inclusive: {
            type: 'integer',
            description: 'The one-indexed line number to end reading at (inclusive).',
          },
          explanation: {
            type: 'string',
            description:
              'One sentence explanation as to why this tool is being used, and how it contributes to the goal.',
          },
        },
        required: ['target_file'],
      },
    },
  },
  execute: async (args: Record<string, unknown>, context?: ToolContext): Promise<ToolResult> => {
    const targetFile = args.target_file as string;
    const shouldReadEntireFile = args.should_read_entire_file as boolean;
    const startLine = args.start_line_one_indexed as number;
    const endLine = args.end_line_one_indexed_inclusive as number;

    if (!targetFile || typeof targetFile !== 'string') {
      return {
        success: false,
        content: '',
        error: 'target_file parameter is required and must be a string',
      };
    }

    // 为 should_read_entire_file 设置默认值
    const actualShouldReadEntireFile = typeof shouldReadEntireFile === 'boolean' ? shouldReadEntireFile : false;

    // 当不读取整个文件时，如果没有提供行号参数，则使用默认值
    let actualStartLine = startLine;
    let actualEndLine = endLine;

    // 当不读取整个文件时，验证和处理行号参数
    if (!actualShouldReadEntireFile) {
      // 检查是否提供了任何行号参数
      const hasStartLine = typeof startLine === 'number';
      const hasEndLine = typeof endLine === 'number';

      if (!hasStartLine && !hasEndLine) {
        // 如果没有提供任何行号参数，先读取文件以获取总行数来设置默认值
        try {
          const filePath = context?.workdir ? resolve(context.workdir, targetFile) : resolve(targetFile);
          const fileContent = await readFile(filePath, 'utf-8');
          const lines = fileContent.split('\n');
          const totalLines = lines.length;

          // 设置默认值：从第1行开始，读取200行或到文件末尾
          actualStartLine = 1;
          actualEndLine = Math.min(200, totalLines);

          logger.warn(`Line numbers not provided, using default range: ${actualStartLine}-${actualEndLine}`);
        } catch (error) {
          return {
            success: false,
            content: '',
            error: `Failed to read file for default line calculation: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      } else {
        // 至少提供了一个行号参数，需要读取文件来确定总行数
        try {
          const filePath = context?.workdir ? resolve(context.workdir, targetFile) : resolve(targetFile);
          const fileContent = await readFile(filePath, 'utf-8');
          const lines = fileContent.split('\n');
          const totalLines = lines.length;

          // 根据提供的参数设置实际的开始和结束行
          if (hasStartLine && hasEndLine) {
            // 两个参数都提供了
            actualStartLine = startLine;
            actualEndLine = endLine;
          } else if (hasStartLine && !hasEndLine) {
            // 只提供了开始行，读取到文件末尾（但不超过250行限制）
            actualStartLine = startLine;
            actualEndLine = Math.min(startLine + 249, totalLines); // 最多读取250行
          } else if (!hasStartLine && hasEndLine) {
            // 只提供了结束行，从第1行开始读取
            actualStartLine = 1;
            actualEndLine = endLine;
          }
        } catch (error) {
          return {
            success: false,
            content: '',
            error: `Failed to read file for line range calculation: ${error instanceof Error ? error.message : String(error)}`,
          };
        }
      }
    }

    try {
      const filePath = context?.workdir ? resolve(context.workdir, targetFile) : resolve(targetFile);
      const fileContent = await readFile(filePath, 'utf-8');
      const lines = fileContent.split('\n');
      const totalLines = lines.length;

      if (actualShouldReadEntireFile) {
        const lines = fileContent.split('\n');
        return {
          success: true,
          content: fileContent,
          shortResult: `Read entire file (${lines.length} lines)`,
        };
      }

      // Validate and adjust line numbers
      if (actualStartLine < 1 || actualStartLine > totalLines) {
        return {
          success: false,
          content: '',
          error: `Invalid start line number. File has ${totalLines} lines, start line must be between 1 and ${totalLines}`,
        };
      }

      if (actualEndLine < 1) {
        return {
          success: false,
          content: '',
          error: `Invalid end line number. End line must be greater than 0`,
        };
      }

      // Auto-adjust end line if it exceeds file length
      const adjustedEndLine = Math.min(actualEndLine, totalLines);
      if (actualEndLine > totalLines) {
        logger.warn(`End line ${actualEndLine} exceeds file length ${totalLines}, adjusted to ${adjustedEndLine}`);
      }

      if (actualStartLine > adjustedEndLine) {
        return {
          success: false,
          content: '',
          error: 'start_line_one_indexed must be less than or equal to end_line_one_indexed_inclusive',
        };
      }

      // Check line range limits
      const requestedLines = adjustedEndLine - actualStartLine + 1;
      if (requestedLines > 250) {
        return {
          success: false,
          content: '',
          error: 'Cannot view more than 250 lines at a time',
        };
      }

      // 处理200行最小限制的逻辑
      // 只有在没有明确指定行范围时才应用200行最小限制
      const hasSpecificRange = typeof startLine === 'number' && typeof endLine === 'number';

      if (requestedLines < 200 && !actualShouldReadEntireFile && !hasSpecificRange) {
        // 如果文件总行数少于或等于200行，直接返回整个文件
        if (totalLines <= 200) {
          return {
            success: true,
            content: fileContent,
            shortResult: `Read entire file (${totalLines} lines)`,
          };
        }

        // 如果文件总行数大于200行，但请求的行数少于200行，扩展到200行
        const finalEndLine = Math.min(actualStartLine + 199, totalLines);
        const finalRequestedLines = finalEndLine - actualStartLine + 1;

        // 如果从起始行开始无法获取200行（比如起始行太靠后），尝试向前扩展起始行
        if (finalRequestedLines < 200) {
          const adjustedStartLine = Math.max(1, totalLines - 199);
          const adjustedFinalEndLine = totalLines;

          // 使用调整后的范围
          const adjustedSelectedLines = lines.slice(adjustedStartLine - 1, adjustedFinalEndLine);
          let result = adjustedSelectedLines.join('\n');

          // 添加调整提示和行数摘要
          let summary = `[Adjusted range to meet 200 lines minimum: ${adjustedStartLine}-${adjustedFinalEndLine}]\n`;
          if (adjustedStartLine > 1) {
            summary += `[Lines 1-${adjustedStartLine - 1} not shown]\n`;
          }

          result = result + '\n' + summary;

          return {
            success: true,
            content: result,
            shortResult: `Lines ${adjustedStartLine}-${adjustedFinalEndLine} (${adjustedFinalEndLine - adjustedStartLine + 1} lines, adjusted)`,
          };
        }

        // 使用调整后的范围
        const adjustedSelectedLines = lines.slice(actualStartLine - 1, finalEndLine);
        let result = adjustedSelectedLines.join('\n');

        // 添加调整提示和行数摘要
        let summary = `[Adjusted range to meet 200 lines minimum: ${actualStartLine}-${finalEndLine}]\n`;
        if (actualStartLine > 1) {
          summary += `[Lines 1-${actualStartLine - 1} not shown]\n`;
        }
        if (finalEndLine < totalLines) {
          summary += `[Lines ${finalEndLine + 1}-${totalLines} not shown]\n`;
        }

        result = result + '\n' + summary;

        return {
          success: true,
          content: result,
          shortResult: `Lines ${actualStartLine}-${finalEndLine} (${finalEndLine - actualStartLine + 1} lines, adjusted to 200)`,
        };
      }

      // Extract the requested lines (convert to 0-indexed)
      const selectedLines = lines.slice(actualStartLine - 1, adjustedEndLine);
      let result = selectedLines.join('\n');

      // Add summary of lines outside the range
      let summary = '';
      if (actualStartLine > 1) {
        summary += `[Lines 1-${actualStartLine - 1} not shown]\n`;
      }
      if (adjustedEndLine < totalLines) {
        summary += `[Lines ${adjustedEndLine + 1}-${totalLines} not shown]\n`;
      }

      if (summary) {
        result = result + '\n' + summary;
      }

      return {
        success: true,
        content: result,
        shortResult: `Lines ${actualStartLine}-${adjustedEndLine} (${adjustedEndLine - actualStartLine + 1} lines)`,
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
