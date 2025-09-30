import { readFile } from "fs/promises";
import type { ToolPlugin, ToolResult } from "./types";
import { logger } from "../utils/logger";
import { resolvePath, getDisplayPath } from "../utils/path";

/**
 * Read 工具插件 - 读取文件内容
 */
export const readTool: ToolPlugin = {
  name: "Read",
  description: "Reads a file from the local filesystem",
  config: {
    type: "function",
    function: {
      name: "Read",
      description:
        "Reads a file from the local filesystem. You can access any file directly by using this tool.\nAssume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.\n\nUsage:\n- The file_path parameter must be an absolute path, not a relative path\n- By default, it reads up to 2000 lines starting from the beginning of the file\n- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters\n- Any lines longer than 2000 characters will be truncated\n- Results are returned using cat -n format, with line numbers starting at 1\n- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.\n- This tool can read PDF files (.pdf). PDFs are processed page by page, extracting both text and visual content for analysis.\n- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.\n- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.\n- You will regularly be asked to read screenshots. If the user provides a path to a screenshot ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths like /var/folders/123/abc/T/TemporaryItems/NSIRD_screencaptureui_ZfB1tD/Screenshot.png\n- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute path to the file to read",
          },
          offset: {
            type: "number",
            description:
              "The line number to start reading from. Only provide if the file is too large to read at once",
          },
          limit: {
            type: "number",
            description:
              "The number of lines to read. Only provide if the file is too large to read at once.",
          },
        },
        required: ["file_path"],
      },
    },
  },
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const filePath = args.file_path as string;
    const offset = args.offset as number;
    const limit = args.limit as number;

    if (!filePath || typeof filePath !== "string") {
      return {
        success: false,
        content: "",
        error: "file_path parameter is required and must be a string",
      };
    }

    try {
      // 注意：新的 Read 工具要求绝对路径，所以我们不使用 resolvePath
      // 但为了保持兼容性，如果不是绝对路径，我们仍然尝试解析
      const actualFilePath = filePath.startsWith("/")
        ? filePath
        : resolvePath(filePath);

      const fileContent = await readFile(actualFilePath, "utf-8");

      // 检查文件是否为空
      if (fileContent.length === 0) {
        logger.warn(`File ${filePath} exists but has empty contents`);
        return {
          success: true,
          content:
            "⚠️ System reminder: This file exists but has empty contents.",
          shortResult: "Empty file",
        };
      }

      const lines = fileContent.split("\n");
      const totalLines = lines.length;

      // 处理偏移和限制
      let startLine = 1;
      let endLine = Math.min(totalLines, 2000); // 默认最多读取 2000 行

      if (typeof offset === "number") {
        startLine = Math.max(1, offset);
      }

      if (typeof limit === "number") {
        endLine = Math.min(totalLines, startLine + limit - 1);
      }

      // 如果没有指定偏移和限制，读取整个文件（最多2000行）
      if (typeof offset !== "number" && typeof limit !== "number") {
        startLine = 1;
        endLine = Math.min(totalLines, 2000);
      }

      // 验证行号范围
      if (startLine > totalLines) {
        return {
          success: false,
          content: "",
          error: `Start line ${startLine} exceeds total lines ${totalLines}`,
        };
      }

      // 提取指定行范围
      const selectedLines = lines.slice(startLine - 1, endLine);

      // 格式化输出 (cat -n 格式，带行号)
      const formattedContent = selectedLines
        .map((line, index) => {
          const lineNumber = startLine + index;
          // 截断超长行
          const truncatedLine =
            line.length > 2000 ? line.substring(0, 2000) + "..." : line;
          return `${lineNumber.toString().padStart(6)}\t${truncatedLine}`;
        })
        .join("\n");

      // 添加文件信息头部
      let content = `File: ${filePath}\n`;
      if (startLine > 1 || endLine < totalLines) {
        content += `Lines ${startLine}-${endLine} of ${totalLines}\n`;
      } else {
        content += `Total lines: ${totalLines}\n`;
      }
      content += "─".repeat(50) + "\n";
      content += formattedContent;

      // 如果只显示了部分内容，添加提示
      if (endLine < totalLines) {
        content += `\n${"─".repeat(50)}\n`;
        content += `... ${totalLines - endLine} more lines not shown`;
      }

      return {
        success: true,
        content,
        shortResult: `Read ${selectedLines.length} lines${totalLines > 2000 ? " (truncated)" : ""}`,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    const filePath = params.file_path as string;
    const offset = params.offset as number;
    const limit = params.limit as number;

    let displayPath = getDisplayPath(filePath || "");

    if (typeof offset === "number" || typeof limit === "number") {
      const offsetStr = typeof offset === "number" ? offset.toString() : "1";
      const limitStr = typeof limit === "number" ? limit.toString() : "2000";
      displayPath += ` ${offsetStr}:${limitStr}`;
    }

    return displayPath;
  },
};
