import { readFile, stat } from "fs/promises";
import { extname } from "path";
import { logger } from "../utils/globalLogger.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { resolvePath, getDisplayPath } from "../utils/path.js";
import {
  isBinaryDocument,
  getBinaryDocumentError,
} from "../utils/fileFormat.js";
import { convertImageToBase64 } from "../utils/messageOperations.js";
import { READ_TOOL_NAME } from "../constants/tools.js";

/**
 * Supported image file extensions
 */
const SUPPORTED_IMAGE_EXTENSIONS = [
  "png",
  "jpeg",
  "jpg",
  "gif",
  "webp",
] as const;

/**
 * Check if a file path represents an image file
 * @param filePath - Path to the file
 * @returns true if the file is a supported image format
 */
function isImageFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase().substring(1);
  return (SUPPORTED_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Validate image file size
 * @param filePath - Path to the image file
 * @param maxSizeBytes - Maximum allowed file size in bytes (default: 20MB)
 * @returns Promise<boolean> - true if file size is within limit
 */
async function validateImageFileSize(
  filePath: string,
  maxSizeBytes: number = 20 * 1024 * 1024,
): Promise<boolean> {
  try {
    const stats = await stat(filePath);
    return stats.size <= maxSizeBytes;
  } catch {
    return false;
  }
}

/**
 * Get MIME type for image file based on extension
 * @param filePath - Path to the image file
 * @returns MIME type string
 */
function getImageMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase().substring(1);
  switch (ext) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "gif":
      return "image/gif";
    case "webp":
      return "image/webp";
    default:
      return "image/png"; // Default fallback
  }
}

/**
 * Process an image file and return ToolResult with image data
 * @param filePath - Path to the image file
 * @param context - Tool execution context
 * @returns Promise<ToolResult> with image data
 */
async function processImageFile(
  filePath: string,
  context: ToolContext,
): Promise<ToolResult> {
  try {
    // Resolve path
    const actualFilePath = filePath.startsWith("/")
      ? filePath
      : resolvePath(filePath, context.workdir);

    // Validate file size
    const isValidSize = await validateImageFileSize(actualFilePath);
    if (!isValidSize) {
      const stats = await stat(actualFilePath);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      return {
        success: false,
        content: "",
        error: `Image file exceeds 20MB limit (actual: ${sizeMB}MB)`,
      };
    }

    // Convert image to base64
    const imageDataUrl = convertImageToBase64(actualFilePath);
    const mimeType = getImageMimeType(actualFilePath);

    // Extract base64 data from data URL (remove data:image/type;base64, prefix)
    const base64Data = imageDataUrl.split(",")[1] || "";

    return {
      success: true,
      content: `Image file processed: ${getDisplayPath(filePath, context.workdir)}\nFormat: ${mimeType}\nSize: Available for AI processing`,
      shortResult: `Image processed (${mimeType})`,
      images: [
        {
          data: base64Data,
          mediaType: mimeType,
        },
      ],
    };
  } catch (error) {
    return {
      success: false,
      content: "",
      error: `Failed to process image: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Read Tool Plugin - Read file content
 */
export const readTool: ToolPlugin = {
  name: READ_TOOL_NAME,
  prompt:
    () => `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- You can optionally specify a line offset and limit (especially handy for long files), but it's recommended to read the whole file by not providing these parameters
- Any lines longer than 2000 characters will be truncated
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Agent to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Agent is a multimodal LLM.
- This tool can read Jupyter notebooks (.ipynb files) and returns all cells with their outputs, combining code, text, and visualizations.
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths like /var/folders/123/abc/T/TemporaryItems/NSIRD_screencaptureui_ZfB1tD/Screenshot.png
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.
- Binary document formats (PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX) are not supported and will return an error.`,
  config: {
    type: "function",
    function: {
      name: READ_TOOL_NAME,
      description: "Read a file from the local filesystem.",
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

    // Check permissions
    if (context.permissionManager) {
      const permissionContext = context.permissionManager.createContext(
        READ_TOOL_NAME,
        context.permissionMode || "default",
        context.canUseToolCallback,
        args,
      );
      const decision =
        await context.permissionManager.checkPermission(permissionContext);
      if (decision.behavior === "deny") {
        return {
          success: false,
          content: "",
          error: decision.message || "Permission denied",
        };
      }
    }

    // Check if this is an image file
    if (isImageFile(filePath)) {
      return processImageFile(filePath, context);
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
