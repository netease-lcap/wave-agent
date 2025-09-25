import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import type { ToolPlugin, ToolResult, ToolContext } from "./types";
import { logger } from "../utils/logger";
import { resolvePath } from "../utils/path";
import { diffChars } from "diff";

/**
 * 文件写入工具插件
 */
export const writeTool: ToolPlugin = {
  name: "write_file",
  description: "Writes a file to the local filesystem",
  config: {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Writes a file to the local filesystem.\n\nUsage:\n- This tool will overwrite the existing file if there is one at the provided path.\n- If this is an existing file, you MUST use the read_file tool first to read the file's contents. This tool will fail if you did not read the file first.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.\n- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description:
              "The absolute path to the file to write (must be absolute, not relative)",
          },
          content: {
            type: "string",
            description: "The content to write to the file",
          },
        },
        required: ["file_path", "content"],
        additionalProperties: false,
      },
    },
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<ToolResult> => {
    const filePath = args.file_path as string;
    const content = args.content as string;

    // 验证必需参数
    if (!filePath || typeof filePath !== "string") {
      return {
        success: false,
        content: "",
        error: "file_path parameter is required and must be a string",
      };
    }

    if (typeof content !== "string") {
      return {
        success: false,
        content: "",
        error: "content parameter is required and must be a string",
      };
    }

    try {
      const resolvedPath = resolvePath(filePath, context?.workdir);

      // 检查文件是否已存在
      let originalContent = "";
      let isExistingFile = false;

      try {
        originalContent = await readFile(resolvedPath, "utf-8");
        isExistingFile = true;
      } catch {
        // 文件不存在，这是正常的新文件创建情况
        isExistingFile = false;
      }

      // 检查是否是覆盖现有文件但内容相同
      if (isExistingFile && originalContent === content) {
        return {
          success: true,
          content: `File ${filePath} already has the same content, no changes needed`,
          shortResult: "No changes needed",
          filePath: resolvedPath,
          originalContent,
          newContent: content,
          diffResult: [],
        };
      }

      // 确保目录存在
      const fileDir = dirname(resolvedPath);
      try {
        await mkdir(fileDir, { recursive: true });
      } catch (mkdirError) {
        // 忽略目录已存在的错误
        if (
          mkdirError instanceof Error &&
          !mkdirError.message.includes("EEXIST")
        ) {
          logger.warn(
            `Failed to create directory ${fileDir}: ${mkdirError.message}`,
          );
        }
      }

      // 写入文件
      try {
        await writeFile(resolvedPath, content, "utf-8");
      } catch (writeError) {
        return {
          success: false,
          content: "",
          error: `Failed to write file: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
        };
      }

      // 生成 diff 信息
      const diffResult = diffChars(originalContent, content);

      const shortResult = isExistingFile
        ? `Overwrote ${filePath}`
        : `Created ${filePath}`;

      const lines = content.split("\n").length;
      const chars = content.length;
      const detailedContent = `${shortResult} (${lines} lines, ${chars} characters)`;

      logger.info(`Write tool: ${shortResult}`);

      return {
        success: true,
        content: detailedContent,
        shortResult,
        filePath: resolvedPath,
        originalContent,
        newContent: content,
        diffResult,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Write tool error: ${errorMessage}`);
      return {
        success: false,
        content: "",
        error: errorMessage,
      };
    }
  },
};
