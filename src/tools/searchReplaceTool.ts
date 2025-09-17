import { writeFile, readFile } from "fs/promises";
import { diffLines } from "diff";
import type { ToolPlugin, ToolResult, ToolContext } from "./types";
import { logger } from "../utils/logger";
import { resolvePath } from "../utils/path";

/**
 * 搜索替换工具插件
 */
export const searchReplaceTool: ToolPlugin = {
  name: "search_replace",
  description:
    "Use this tool to propose a search and replace operation on an existing file.",
  config: {
    type: "function",
    function: {
      name: "search_replace",
      description: `Use this tool to propose a search and replace operation on an existing file.

The tool will replace ONE occurrence of old_string with new_string in the specified file.

CRITICAL REQUIREMENTS FOR USING THIS TOOL:

1. UNIQUENESS: The old_string MUST uniquely identify the specific instance you want to change. This means:
   - Include AT LEAST 3-5 lines of context BEFORE the change point
   - Include AT LEAST 3-5 lines of context AFTER the change point
   - Include all whitespace, indentation, and surrounding code exactly as it appears in the file

2. SINGLE INSTANCE: This tool can only change ONE instance at a time. If you need to change multiple instances:
   - Make separate calls to this tool for each instance
   - Each call must uniquely identify its specific instance using extensive context

3. VERIFICATION: Before using this tool:
   - If multiple instances exist, gather enough context to uniquely identify each one
   - Plan separate tool calls for each instance`,
      parameters: {
        type: "object",
        properties: {
          file_path: {
            type: "string",
            description:
              "The path to the file you want to search and replace in. You can use either a relative path in the workspace or an absolute path. If an absolute path is provided, it will be preserved as is.",
          },
          old_string: {
            type: "string",
            description:
              "The text to replace (must be unique within the file, and must match the file contents exactly, including all whitespace and indentation)",
          },
          new_string: {
            type: "string",
            description:
              "The edited text to replace the old_string (must be different from the old_string)",
          },
        },
        required: ["file_path", "old_string", "new_string"],
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

    if (!filePath || typeof filePath !== "string") {
      return {
        success: false,
        content: "",
        error: "file_path parameter is required and must be a string",
      };
    }

    if (!oldString || typeof oldString !== "string") {
      return {
        success: false,
        content: "",
        error: "old_string parameter is required and must be a string",
      };
    }

    if (
      newString === undefined ||
      newString === null ||
      typeof newString !== "string"
    ) {
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
      const fileContent = await readFile(resolvedPath, "utf-8");

      // 检查old_string是否存在
      if (!fileContent.includes(oldString)) {
        return {
          success: false,
          content: "",
          error: "old_string not found in file",
        };
      }

      // 检查old_string是否唯一
      const occurrences = fileContent.split(oldString).length - 1;
      if (occurrences > 1) {
        return {
          success: false,
          content: "",
          error: `old_string appears ${occurrences} times in the file. It must be unique. Please include more context to make it unique.`,
        };
      }

      // 执行替换
      const newContent = fileContent.replace(oldString, newString);

      // 写入文件
      await writeFile(resolvedPath, newContent, "utf-8");

      logger.info(`Successfully replaced content in ${filePath}`);

      // 生成 diff 信息
      const diffResult = diffLines(fileContent, newContent);
      const oldLines = oldString.split("\n").length;
      const newLines = newString.split("\n").length;

      return {
        success: true,
        content: `Successfully replaced 1 occurrence in ${filePath}`,
        originalContent: fileContent,
        newContent: newContent,
        diffResult: diffResult,
        filePath: filePath,
        shortResult: `Replaced ${oldLines} line${oldLines === 1 ? "" : "s"} with ${newLines} line${newLines === 1 ? "" : "s"}`,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    const filePath = params.file_path as string;
    return filePath || "";
  },
};
