import { open, readFile, stat } from "fs/promises";
import { extname } from "path";
import { createHash } from "crypto";
import { logger } from "../utils/globalLogger.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { resolvePath, getDisplayPath } from "../utils/path.js";
import { formatLineNumberPrefix } from "../utils/stringUtils.js";
import { estimateTokens } from "../utils/tokenEstimate.js";
import {
  isBinaryDocument,
  getBinaryDocumentError,
} from "../utils/fileFormat.js";
import { convertImageToBase64 } from "../utils/messageOperations.js";
import { isPathInside } from "../utils/pathSafety.js";
import { memoryFreshnessNote } from "../utils/memoryAge.js";
import { READ_TOOL_NAME } from "../constants/tools.js";
import { isImageFileExtension } from "../constants/images.js";

/**
 * Whether a path names an image file this tool can attach.
 *
 * The extension list is shared with the remote-control page's click targets and
 * its host-side preview gate — see `constants/images.ts`.
 */
function isImageFile(filePath: string): boolean {
  return isImageFileExtension(extname(filePath).toLowerCase().substring(1));
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

    return {
      success: true,
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
      metadata: {
        type: "image",
        mimeType,
      },
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
 * Read at most `maxBytes` from the head of a file.
 *
 * Only the byte cap uses this: a file past the cap is paged instead of being
 * refused, and paging the head never has to pull a whole multi-hundred-megabyte
 * file into memory.
 */
async function readFileHead(
  filePath: string,
  maxBytes: number,
): Promise<string> {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes);
    const { bytesRead } = await handle.read(buffer, 0, maxBytes, 0);
    const text = buffer.subarray(0, bytesRead).toString("utf-8");
    // A cut mid-character leaves a replacement char behind; drop it rather than
    // handing the model a mangled last line.
    return text.endsWith("\uFFFD") ? text.slice(0, -1) : text;
  } finally {
    await handle.close();
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
      return {
        success: false,
        content: "",
        error: getBinaryDocumentError(filePath),
        metadata: {
          type: isPdf ? "pdf" : "binary",
        },
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

      // Resource limits. Past the byte cap the read is *paged*, not refused:
      // an error here is what taught the model that Read cannot give content
      // and to go around it with `sed`/`cat` in Bash (see fs-tools spec,
      // 边界情况 · 大文件). Only the head is pulled into memory.
      const maxSizeBytes =
        context.fileReadingLimits?.maxSizeBytes ?? 0.25 * 1024 * 1024; // Default 256KB
      const sizeCapped =
        stats.size > maxSizeBytes &&
        offset === undefined &&
        limit === undefined;
      const fileContent = sizeCapped
        ? await readFileHead(actualFilePath, maxSizeBytes)
        : await readFile(actualFilePath, "utf-8");

      // Update readFileState. A size-capped read only saw the head, so it is
      // not recorded at all: its hash and content would be mistaken for the
      // whole file by Write's staleness check and by the external-change diff.
      if (context.readFileState && !sizeCapped) {
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

      // Check if file is empty
      if (fileContent.length === 0) {
        logger.warn(`File ${filePath} exists but has empty contents`);
        return {
          success: true,
          content: "System reminder: This file exists but has empty contents.",
          shortResult: "Empty file",
          metadata: {
            type: "text",
            isEmpty: true,
          },
        };
      }

      const allLines = fileContent.split("\n");
      // Lines this read can address. A size-capped read only holds the head, so
      // the file's real line count is unknown — `totalLines` stays undefined and
      // the notice says "past the read cap" instead of naming a total.
      const availableLines = allLines.length;
      const totalLines = sizeCapped ? undefined : availableLines;

      // Handle offset and limit
      let startLine = typeof offset === "number" ? Math.max(1, offset) : 1;
      let endLine = Math.min(
        availableLines,
        startLine + (typeof limit === "number" ? limit : 2000) - 1,
      );

      // Validate line number range
      if (startLine > availableLines) {
        return {
          success: false,
          content: "",
          error: sizeCapped
            ? `Start line ${startLine} is past the ${Math.floor(maxSizeBytes / 1024)}KB head this read covers (${availableLines} lines). Retry with a smaller offset.`
            : `Start line ${startLine} exceeds total lines ${availableLines}`,
        };
      }

      // Format output (cat -n format, with line numbers)
      const formatLines = (count: number): string =>
        allLines
          .slice(startLine - 1, startLine - 1 + count)
          .map(
            (line, index) =>
              `${formatLineNumberPrefix(startLine + index)}${line}`,
          )
          .join("\n");

      let keptLines = endLine - startLine + 1;
      let formattedContent = formatLines(keptLines);

      // Token budget: estimate tokens, then truncate the page to fit rather
      // than failing. Failing a plain read is what pushed the model to route
      // around Read with `sed`/`head` in Bash — a page that says how to
      // continue is both more useful and more honest.
      const maxTokens = context.fileReadingLimits?.maxTokens ?? 25000; // Default 25000 tokens
      const ext = extname(actualFilePath).toLowerCase().slice(1);
      const tokenBudget = Math.floor(maxTokens * 0.85);
      const explicitPage =
        typeof offset === "number" || typeof limit === "number";
      let estimatedTokens = estimateTokens(formattedContent, ext);
      let truncatedByTokenCap = false;
      let veryLongLine = false;

      if (estimatedTokens > maxTokens && explicitPage) {
        return {
          success: false,
          content: "",
          error: `File content (~${estimatedTokens.toLocaleString()} tokens) exceeds maximum allowed tokens (${maxTokens.toLocaleString()}). Use offset and limit parameters to read specific portions of the file, or search for specific content instead of reading the whole file.`,
          metadata: {
            type: "error_token_limit_exceeded",
            estimatedTokens,
            maxTokens,
          },
        };
      }

      if (estimatedTokens > maxTokens) {
        truncatedByTokenCap = true;
        // Start near the budget and walk down while the estimate stays over it:
        // the estimate is content-dependent, so a single arithmetic hop can
        // land on the wrong side.
        keptLines = Math.max(
          1,
          Math.min(
            keptLines,
            Math.floor((keptLines * tokenBudget) / estimatedTokens),
          ),
        );
        for (let attempt = 0; attempt < 6 && keptLines > 1; attempt++) {
          formattedContent = formatLines(keptLines);
          estimatedTokens = estimateTokens(formattedContent, ext);
          if (estimatedTokens <= tokenBudget) break;
          keptLines = Math.max(1, Math.floor(keptLines * 0.7));
        }
        formattedContent = formatLines(keptLines);
        estimatedTokens = estimateTokens(formattedContent, ext);

        // A single line can still blow the budget on its own (minified bundle,
        // one-line JSON): fall back to a character window and say so, because
        // line paging cannot reach the rest of that line.
        if (estimatedTokens > maxTokens) {
          veryLongLine = true;
          const chars = Math.max(
            1,
            Math.floor(
              (formattedContent.length * tokenBudget) / estimatedTokens,
            ),
          );
          formattedContent = formattedContent.slice(0, chars);
          const lastCode = formattedContent.charCodeAt(
            formattedContent.length - 1,
          );
          // Never split a surrogate pair in half.
          if (lastCode >= 0xd800 && lastCode <= 0xdbff) {
            formattedContent = formattedContent.slice(0, -1);
          }
          estimatedTokens = estimateTokens(formattedContent, ext);
        }
        endLine = startLine + keptLines - 1;
      }

      const truncated = sizeCapped || endLine < availableLines;
      // Same shape as Claude Code's pager notice: how much was shown, why it
      // stopped, how to continue from here.
      const shownRange =
        totalLines === undefined
          ? `showing lines ${startLine}-${endLine} of a file past the ${Math.floor(maxSizeBytes / 1024)}KB read cap`
          : `showing lines ${startLine}-${endLine} of ${totalLines} total`;
      const budgetNote = `${estimatedTokens.toLocaleString()} tokens, cap ${maxTokens.toLocaleString()}`;
      const howToContinue = veryLongLine
        ? "this file has very long lines and cannot be paged by line. Use Grep to find a specific section, or Read with offset/limit to page through it.] Do NOT answer from this excerpt alone if the answer may be elsewhere in the file."
        : `Call ${READ_TOOL_NAME} with offset=${endLine + 1} limit=${keptLines} for the next page, or Grep to find a specific section.] Do NOT answer from this page alone if the answer may be further in the file.`;
      const partialNotice =
        truncatedByTokenCap || sizeCapped
          ? `<system-reminder>[Truncated: PARTIAL view — ${filePath}: ${shownRange} (${budgetNote}). ${howToContinue}</system-reminder>\n`
          : "";

      // Add file information header. A file inside the auto-memory directory
      // gets a staleness note in front of it: memory is a point-in-time
      // observation, and a stale `file:line` citation reads as authoritative.
      // `autoMemoryDir` is unset when auto-memory is off, so the note can never
      // fire for a disabled feature.
      const memoryNote =
        context.autoMemoryDir &&
        isPathInside(actualFilePath, context.autoMemoryDir)
          ? memoryFreshnessNote(stats.mtime.getTime())
          : "";
      let content = `${memoryNote}${partialNotice}File: ${filePath}\n`;
      if (totalLines === undefined) {
        content += `Lines ${startLine}-${endLine} of a file past the ${Math.floor(maxSizeBytes / 1024)}KB read cap\n`;
      } else if (startLine > 1 || truncated) {
        content += `Lines ${startLine}-${endLine} of ${totalLines}\n`;
      } else {
        content += `Total lines: ${totalLines}\n`;
      }
      content += "─".repeat(50) + "\n";
      content += formattedContent;

      // If only showing partial content, add prompt
      if (totalLines !== undefined && endLine < totalLines) {
        content += `\n${"─".repeat(50)}\n`;
        content += `... ${totalLines - endLine} more lines not shown`;
      }

      return {
        success: true,
        content,
        shortResult: `Read ${keptLines} lines${truncated || truncatedByTokenCap ? " (truncated)" : ""}`,
        metadata: {
          type: "text",
          totalLines,
          startLine,
          endLine,
          truncated,
          ...(truncatedByTokenCap && { truncatedByTokenCap: true }),
        },
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
