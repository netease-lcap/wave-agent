import { readFile, stat } from "fs/promises";
import { extname } from "path";
import { createHash } from "crypto";
import { logger } from "../utils/globalLogger.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { resolvePath, getDisplayPath } from "../utils/path.js";
import { estimateTokens } from "../utils/tokenEstimate.js";
import {
  isBinaryDocument,
  getBinaryDocumentError,
} from "../utils/fileFormat.js";
import { convertImageToBase64 } from "../utils/messageOperations.js";
import { isPathInside } from "../utils/pathSafety.js";
import { READ_TOOL_NAME } from "../constants/tools.js";
import { isImageFileExtension } from "../constants/images.js";
import {
  recordReadMemoryMtime,
  renderReadTextResultData,
  type ReadImageResultData,
  type ReadTextResultData,
  type ReadTokenLimitResultData,
  type ReadUnreadableResultData,
} from "./resultData/read.js";

/**
 * Whether a path names an image file this tool can attach.
 *
 * The extension list is shared with the remote-control page's click targets and
 * its host-side preview gate — see `constants/images.ts`.
 */
function isImageFile(filePath: string): boolean {
  return isImageFileExtension(extname(filePath).toLowerCase().substring(1));
}

/** `1234 bytes` / `1.2KB` / `3MB`, same ladder as Claude Code's `formatFileSize`. */
function formatFileSize(sizeInBytes: number): string {
  if (sizeInBytes < 1024) return `${sizeInBytes} bytes`;
  const kb = sizeInBytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1).replace(/\.0$/, "")}KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1).replace(/\.0$/, "")}MB`;
  return `${(mb / 1024).toFixed(1).replace(/\.0$/, "")}GB`;
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
    if (!imageDataUrl) {
      // Unreadable, empty or unknown-format file: fail instead of handing the
      // model an empty image payload.
      return {
        success: false,
        content: "",
        error: `Failed to process image: ${getDisplayPath(filePath, context.workdir)} is empty or not a readable image file`,
      };
    }
    const mimeType = getImageMimeType(actualFilePath);

    // Extract base64 data from data URL (remove data:image/type;base64, prefix)
    const base64Data = imageDataUrl.split(",")[1] || "";

    const data: ReadImageResultData = {
      type: "image",
      file: {
        base64: base64Data,
        type: mimeType,
        originalSize: (await stat(actualFilePath)).size,
      },
    };

    return {
      success: true,
      data,
      // CC 把图片渲成一个 image block、不带文本；我方的 tool_result 走「文本 +
      // images[]」，所以这里仍给一行说明。这是本工具唯一与 CC 渲染不一致的分支。
      content: `Image file processed: ${getDisplayPath(filePath, context.workdir)}\nFormat: ${mimeType}\nSize: Available for AI processing`,
      shortResult: `Image processed (${mimeType})`,
      images: [
        {
          data: base64Data,
          mediaType: mimeType,
          // The original already lives on disk: point at it instead of letting
          // the ingest budget (utils/toolImageIngest.ts) persist a second copy,
          // and so a shrunk image still has a path back to the full-size file.
          path: actualFilePath,
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
  searchHint: "read files, images, PDFs, notebooks",
  prompt:
    () => `Reads a file from the local filesystem. You can access any file directly by using this tool.
Assume this tool is able to read all files on the machine. If the User provides a path to a file assume that path is valid. It is okay to read a file that does not exist; an error will be returned.

Usage:
- The file_path parameter must be an absolute path, not a relative path
- By default, it reads up to 2000 lines starting from the beginning of the file
- When you already know which part of the file you need, only read that part. This can be important for larger files.
- Results are returned using cat -n format, with line numbers starting at 1
- This tool allows Agent to read images (eg PNG, JPG, etc). When reading an image file the contents are presented visually as Agent is a multimodal LLM.
- You have the capability to call multiple tools in a single response. It is always better to speculatively read multiple files as a batch that are potentially useful.
- You will regularly be asked to read screenshots. If the user provides a path to a screenshot ALWAYS use this tool to view the file at the path. This tool will work with all temporary file paths like /var/folders/123/abc/T/TemporaryItems/NSIRD_screencaptureui_ZfB1tD/Screenshot.png
- If you read a file that exists but has empty contents you will receive a system reminder warning in place of file contents.
- Binary document formats (PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX) are not supported and will return an error.
- Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed, and the harness tracks file state for you.`,
  leanPrompt: `Reads a file from the local filesystem. You can access any file directly by using this tool, and a path the user provides can be assumed valid.

- \`file_path\` must be an absolute path.
- Reads up to 2000 lines by default; use \`offset\` and \`limit\` for a long file instead of reading all of it.
- When you already know which part of the file you need, only read that part.
- Results come back in \`cat -n\` format, line numbers starting at 1.
- Reads images (PNG, JPG, …) and presents them visually. Binary document formats (PDF, DOC, DOCX, XLSX, PPT, PPTX) are not supported.
- Reading a file that exists but is empty returns a system reminder instead of content.
- Do NOT re-read a file you just edited to verify — Edit/Write would have errored if the change failed.`,
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

    // Trigger conditional rule loading for this file. Resolved like the read
    // itself so rule matching never depends on a relative path's base.
    context.messageManager?.triggerFileRead(
      resolvePath(filePath, context.workdir),
    );

    // Check for binary document formats
    if (isBinaryDocument(filePath)) {
      const isPdf = filePath.toLowerCase().endsWith(".pdf");
      // 读不了的文件也交一份 `data`（只有判别键）：宿主卡片按它分两种提示，
      // 原来是 `ToolResult.metadata.type`。
      const data: ReadUnreadableResultData = {
        type: isPdf ? "pdf" : "binary",
      };
      return {
        success: false,
        data,
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

      const stats = await stat(actualFilePath);

      // Resource limits, aligned with Claude Code: a read without an explicit
      // `limit` past the byte cap is refused and the model is told to page with
      // offset/limit, instead of handing back a head-only slice it would mistake
      // for the whole file.
      const maxSizeBytes =
        context.fileReadingLimits?.maxSizeBytes ?? 0.25 * 1024 * 1024; // Default 256KB
      if (stats.size > maxSizeBytes && limit === undefined) {
        return {
          success: false,
          content: "",
          error: `File content (${formatFileSize(stats.size)}) exceeds maximum allowed size (${formatFileSize(maxSizeBytes)}). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.`,
        };
      }
      const fileContent = await readFile(actualFilePath, "utf-8");

      if (context.readFileState) {
        const hash = createHash("sha256").update(fileContent).digest("hex");
        context.readFileState.set(actualFilePath, {
          mtime: stats.mtime.getTime(),
          hash,
          source: "read",
          offset, // undefined for full reads
          limit, // undefined for full reads
          // Retain the raw content only for full reads: it is the diff baseline
          // for the external-change notification, and partial entries are
          // excluded from that comparison anyway.
          ...(offset === undefined && limit === undefined
            ? { content: fileContent }
            : {}),
        });
      }

      // A successful read may pull in the memory files of its ancestor
      // directories (see `collectNestedMemoryFiles`) and the skills that live
      // next to them (`<dir>/.wave/skills`); only Read triggers the former,
      // while Read/Write/Edit all trigger the latter.
      context.messageManager?.triggerNestedMemory(actualFilePath);
      context.messageManager?.triggerSkillDiscovery(actualFilePath);

      const allLines = fileContent.split("\n");
      const availableLines = allLines.length;
      const startLine = typeof offset === "number" ? Math.max(1, offset) : 1;

      // Empty file, or an offset past the end: CC answers with an empty body plus
      // a warning that says why, instead of an error the model has to interpret.
      if (fileContent.length === 0 || startLine > availableLines) {
        if (fileContent.length === 0) {
          logger.warn(`File ${filePath} exists but has empty contents`);
        }
        const data: ReadTextResultData = {
          type: "text",
          file: {
            filePath: actualFilePath,
            content: "",
            numLines: 0,
            startLine,
            totalLines: fileContent.length === 0 ? 0 : availableLines,
          },
        };
        return {
          success: true,
          data,
          content: renderReadTextResultData(data),
          shortResult:
            fileContent.length === 0
              ? "Empty file"
              : `Start line ${startLine} past EOF`,
        };
      }

      const endLine = Math.min(
        availableLines,
        startLine + (typeof limit === "number" ? limit : 2000) - 1,
      );
      const numLines = endLine - startLine + 1;
      const content = allLines
        .slice(startLine - 1, startLine - 1 + numLines)
        .join("\n");

      // Token budget: CC refuses instead of truncating (`validateContentTokens`
      // throws `MaxFileReadTokenExceededError`), so there is no partial-page
      // notice and nothing to say how to continue — the model pages itself with
      // offset/limit.
      const maxTokens = context.fileReadingLimits?.maxTokens ?? 25000; // Default 25000 tokens
      const ext = extname(actualFilePath).toLowerCase().slice(1);
      const estimatedTokens = estimateTokens(content, ext);
      if (estimatedTokens > maxTokens) {
        // 被拒的这次也带 `data`（只有诊断数）：宿主卡片据此说清「多少 token、
        // 上限多少」，原来是 `ToolResult.metadata`。
        const limitData: ReadTokenLimitResultData = {
          type: "error_token_limit_exceeded",
          estimatedTokens,
          maxTokens,
        };
        return {
          success: false,
          data: limitData,
          content: "",
          error: `File content (${estimatedTokens} tokens) exceeds maximum allowed tokens (${maxTokens}). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.`,
        };
      }

      const data: ReadTextResultData = {
        type: "text",
        file: {
          filePath: actualFilePath,
          content,
          numLines,
          startLine,
          totalLines: availableLines,
        },
      };

      // A file inside the auto-memory directory gets a freshness note in front of
      // it: memory is a point-in-time observation, and a stale `file:line`
      // citation reads as authoritative. The mtime rides a side channel so it
      // never lands in `data` (see resultData/read.ts).
      if (
        context.autoMemoryDir &&
        isPathInside(actualFilePath, context.autoMemoryDir)
      ) {
        recordReadMemoryMtime(data, stats.mtime.getTime());
      }

      return {
        success: true,
        data,
        content: renderReadTextResultData(data),
        shortResult: `Read ${numLines} lines`,
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
