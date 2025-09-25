import { readFile, writeFile } from "fs/promises";
import type { ToolPlugin, ToolResult, ToolContext } from "./types";
import { logger } from "../utils/logger";
import { resolvePath } from "../utils/path";
import { diffLines } from "diff";

/**
 * 单文件编辑工具插件
 */
export const editTool: ToolPlugin = {
  name: "edit_file",
  description: "Performs exact string replacements in files",
  config: {
    type: "function",
    function: {
      name: "edit_file",
      description:
        "Performs exact string replacements in files. \n\nUsage:\n- You must use your `read_file` tool at least once in the conversation before editing. This tool will error if you attempt an edit without reading the file. \n- When editing text from read_file tool output, ensure you preserve the exact indentation (tabs/spaces) as it appears AFTER the line number prefix. The line number prefix format is: spaces + line number + tab. Everything after that tab is the actual file content to match. Never include any part of the line number prefix in the old_string or new_string.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- Only use emojis if the user explicitly requests it. Avoid adding emojis to files unless asked.\n- The edit will FAIL if `old_string` is not unique in the file. Either provide a larger string with more surrounding context to make it unique or use `replace_all` to change every instance of `old_string`. \n- Use `replace_all` for replacing and renaming strings across the file. This parameter is useful if you want to rename a variable for instance.",
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description: "The absolute path to the file to modify",
          },
          old_string: {
            type: "string",
            description: "The text to replace",
          },
          new_string: {
            type: "string",
            description:
              "The text to replace it with (must be different from old_string)",
          },
          replace_all: {
            type: "boolean",
            default: false,
            description: "Replace all occurences of old_string (default false)",
          },
        },
        required: ["file_path", "old_string", "new_string"],
        additionalProperties: false,
      },
    },
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<ToolResult> => {
    const filePath = args.file_path as string;
    const oldString = args.old_string as string;
    const newString = args.new_string as string;
    const replaceAll = (args.replace_all as boolean) || false;

    // 验证必需参数
    if (!filePath || typeof filePath !== "string") {
      return {
        success: false,
        content: "",
        error: "file_path parameter is required and must be a string",
      };
    }

    if (typeof oldString !== "string") {
      return {
        success: false,
        content: "",
        error: "old_string parameter is required and must be a string",
      };
    }

    if (typeof newString !== "string") {
      return {
        success: false,
        content: "",
        error: "new_string parameter is required and must be a string",
      };
    }

    if (oldString === newString) {
      return {
        success: false,
        content: "",
        error: "old_string and new_string must be different",
      };
    }

    try {
      const resolvedPath = resolvePath(filePath, context?.workdir);

      // 读取文件内容
      let originalContent: string;
      try {
        originalContent = await readFile(resolvedPath, "utf-8");
      } catch (readError) {
        return {
          success: false,
          content: "",
          error: `Failed to read file: ${readError instanceof Error ? readError.message : String(readError)}`,
        };
      }

      // 检查 old_string 是否存在
      if (!originalContent.includes(oldString)) {
        return {
          success: false,
          content: "",
          error: `old_string not found in file`,
        };
      }

      let newContent: string;
      let replacementCount: number;

      if (replaceAll) {
        // 替换所有匹配项
        const regex = new RegExp(escapeRegExp(oldString), "g");
        newContent = originalContent.replace(regex, newString);
        replacementCount = (originalContent.match(regex) || []).length;
      } else {
        // 只替换第一个匹配项，但首先检查是否唯一
        const matches = originalContent.split(oldString).length - 1;
        if (matches > 1) {
          return {
            success: false,
            content: "",
            error: `old_string appears ${matches} times in the file. Either provide a larger string with more surrounding context to make it unique or use replace_all=true to change every instance.`,
          };
        }

        newContent = originalContent.replace(oldString, newString);
        replacementCount = 1;
      }

      // 写入文件
      try {
        await writeFile(resolvedPath, newContent, "utf-8");
      } catch (writeError) {
        return {
          success: false,
          content: "",
          error: `Failed to write file: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
        };
      }

      // 生成 diff 信息
      const diffResult = diffLines(originalContent, newContent);

      const shortResult = replaceAll
        ? `Replaced ${replacementCount} instances in ${filePath}`
        : `Successfully replaced text in ${filePath}`;

      logger.info(`Edit tool: ${shortResult}`);

      return {
        success: true,
        content: shortResult,
        shortResult,
        filePath: resolvedPath,
        originalContent,
        newContent,
        diffResult,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Edit tool error: ${errorMessage}`);
      return {
        success: false,
        content: "",
        error: errorMessage,
      };
    }
  },
};

/**
 * 转义正则表达式特殊字符
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
