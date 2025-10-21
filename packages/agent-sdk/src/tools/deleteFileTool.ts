import { unlink } from "fs/promises";
import type { ToolPlugin, ToolResult } from "./types.js";
import { resolvePath, getDisplayPath } from "../utils/path.js";

/**
 * 删除文件工具插件
 */
export const deleteFileTool: ToolPlugin = {
  name: "Delete",
  description: "Deletes a file at the specified path.",
  config: {
    type: "function",
    function: {
      name: "Delete",
      description: `Deletes a file at the specified path. The operation will fail gracefully if:
    - The file doesn't exist
    - The operation is rejected for security reasons
    - The file cannot be deleted`,
      parameters: {
        type: "object",
        properties: {
          target_file: {
            type: "string",
            description:
              "The path of the file to delete, relative to the workspace root.",
          },
        },
        required: ["target_file"],
      },
    },
  },
  execute: async (args: Record<string, unknown>): Promise<ToolResult> => {
    const targetFile = args.target_file as string;

    if (!targetFile || typeof targetFile !== "string") {
      return {
        success: false,
        content: "",
        error: "target_file parameter is required and must be a string",
      };
    }

    try {
      const filePath = resolvePath(targetFile);

      // 删除文件
      await unlink(filePath);

      // logger.info(`Successfully deleted file: ${filePath}`);

      return {
        success: true,
        content: `Successfully deleted file: ${targetFile}`,
        shortResult: "File deleted",
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {
          success: false,
          content: "",
          error: `File does not exist: ${targetFile}`,
        };
      }

      return {
        success: false,
        content: "",
        error: error instanceof Error ? error.message : String(error),
      };
    }
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    const targetFile = params.target_file as string;
    return getDisplayPath(targetFile || "");
  },
};
