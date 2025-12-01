import { readFile } from "fs/promises";
import { logger } from "../utils/globalLogger.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { resolvePath, getDisplayPath } from "../utils/path.js";
import {
  isBinaryDocument,
  getBinaryDocumentError,
} from "../utils/fileFormat.js";

/**
 * Read Tool Plugin - Read file content
 */
export const readTool: ToolPlugin = {
  name: "Read",
  config: {
    type: "function",
    function: {
      name: "Read",
      description:
        "Reads a file from the local filesystem. You can access any file directly by using this tool.\nAssume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.\n\nUsage:\n- The file_path parameter must be an absolute path, not a relative path\n- By default, it reads up to 2000 lines starting from the beginning of the file\n- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters\n- Any lines longer than 2000 characters will be truncated\n- Results are returned using cat -n format, with line numbers starting at 1\n- This tool allows Claude Code to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Claude Code is a multimodal LLM.\n- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.\n- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.\n- You will regularly be asked to read screenshots. If the user provides a path to a screenshot ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths like /var/folders/123/abc/T/TemporaryItems/NSIRD_screencaptureui_ZfB1tD/Screenshot.png\n- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.\n- Binary document formats (PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX) are not supported and will return an error.",
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
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
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

    // Check for binary document formats
    if (isBinaryDocument(filePath)) {
      return {
        success: false,
        content: "",
        error: getBinaryDocumentError(filePath),
      };
    }

    try {
      // Note: New Read tool requires absolute paths, so we don't use resolvePath
      // But for compatibility, if it's not an absolute path, we still try to resolve
      const actualFilePath = filePath.startsWith("/")
        ? filePath
        : resolvePath(filePath, context.workdir);

      const fileContent = await readFile(actualFilePath, "utf-8");

      // Check if file is empty
      if (fileContent.length === 0) {
        logger.warn(`File ${filePath} exists but has empty contents`);
        return {
          success: true,
          content:
            "⚠️ System reminder: This file exists but has empty contents.",
          shortResult: "Empty file",
        };
      }

      // Check content size limit (100KB)
      const MAX_CONTENT_SIZE = 100 * 1024; // 100KB
      let contentToProcess = fileContent;
      let contentTruncated = false;

      if (fileContent.length > MAX_CONTENT_SIZE) {
        contentToProcess = fileContent.substring(0, MAX_CONTENT_SIZE);
        contentTruncated = true;
      }

      const lines = contentToProcess.split("\n");
      const totalLines = lines.length;
      const originalTotalLines = fileContent.split("\n").length;

      // Handle offset and limit
      let startLine = 1;
      let endLine = Math.min(totalLines, 2000); // Default maximum read 2000 lines

      if (typeof offset === "number") {
        startLine = Math.max(1, offset);
      }

      if (typeof limit === "number") {
        endLine = Math.min(totalLines, startLine + limit - 1);
      }

      // If no offset and limit specified, read entire file (maximum 2000 lines)
      if (typeof offset !== "number" && typeof limit !== "number") {
        startLine = 1;
        endLine = Math.min(totalLines, 2000);
      }

      // Validate line number range
      if (startLine > totalLines) {
        return {
          success: false,
          content: "",
          error: `Start line ${startLine} exceeds total lines ${totalLines}`,
        };
      }

      // Extract specified line range
      const selectedLines = lines.slice(startLine - 1, endLine);

      // Format output (cat -n format, with line numbers)
      const formattedContent = selectedLines
        .map((line, index) => {
          const lineNumber = startLine + index;
          // Truncate overly long lines
          const truncatedLine =
            line.length > 2000 ? line.substring(0, 2000) + "..." : line;
          return `${lineNumber.toString().padStart(6)}\t${truncatedLine}`;
        })
        .join("\n");

      // Add file information header
      let content = `File: ${filePath}\n`;
      if (contentTruncated) {
        content += `Content truncated at ${MAX_CONTENT_SIZE} bytes\n`;
        content += `Lines ${startLine}-${endLine} of ${totalLines} (original file: ${originalTotalLines} lines)\n`;
      } else if (startLine > 1 || endLine < totalLines) {
        content += `Lines ${startLine}-${endLine} of ${totalLines}\n`;
      } else {
        content += `Total lines: ${totalLines}\n`;
      }
      content += "─".repeat(50) + "\n";
      content += formattedContent;

      // If only showing partial content, add prompt
      if (endLine < totalLines || contentTruncated) {
        content += `\n${"─".repeat(50)}\n`;
        if (contentTruncated) {
          content += `... content truncated due to size limit (${MAX_CONTENT_SIZE} bytes)`;
          if (endLine < totalLines) {
            content += ` and ${totalLines - endLine} more lines not shown`;
          }
        } else {
          content += `... ${totalLines - endLine} more lines not shown`;
        }
      }

      return {
        success: true,
        content,
        shortResult: `Read ${selectedLines.length} lines${totalLines > 2000 || contentTruncated ? " (truncated)" : ""}`,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  formatCompactParams: (
    params: Record<string, unknown>,
    context: ToolContext,
  ) => {
    const filePath = params.file_path as string;
    const offset = params.offset as number;
    const limit = params.limit as number;

    let displayPath = getDisplayPath(filePath || "", context.workdir);

    if (typeof offset === "number" || typeof limit === "number") {
      const offsetStr = typeof offset === "number" ? offset.toString() : "1";
      const limitStr = typeof limit === "number" ? limit.toString() : "2000";
      displayPath += ` ${offsetStr}:${limitStr}`;
    }

    return displayPath;
  },
};
