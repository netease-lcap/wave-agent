import { unlink } from "fs/promises";
import { logger } from "../utils/globalLogger.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { resolvePath, getDisplayPath } from "../utils/path.js";

/**
 * Delete file tool plugin
 */
export const deleteFileTool: ToolPlugin = {
  name: "Delete",
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
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const targetFile = args.target_file as string;

    if (!targetFile || typeof targetFile !== "string") {
      return {
        success: false,
        content: "",
        error: "target_file parameter is required and must be a string",
      };
    }

    try {
      const filePath = resolvePath(targetFile, context.workdir);

      // Permission check after validation but before real operation
      if (
        context.permissionManager &&
        context.permissionMode &&
        context.permissionMode !== "bypassPermissions"
      ) {
        if (context.permissionManager.isRestrictedTool("Delete")) {
          try {
            const permissionContext = context.permissionManager.createContext(
              "Delete",
              context.permissionMode,
              context.canUseToolCallback,
              { target_file: targetFile },
            );
            const permissionResult =
              await context.permissionManager.checkPermission(
                permissionContext,
              );

            if (permissionResult.behavior === "deny") {
              return {
                success: false,
                content: "",
                error:
                  permissionResult.message ||
                  "Delete operation denied by permission system",
              };
            }
          } catch {
            return {
              success: false,
              content: "",
              error: "Permission check failed",
            };
          }
        }
      }

      // Delete file
      await unlink(filePath);

      logger.debug(`Successfully deleted file: ${filePath}`);

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
  formatCompactParams: (
    params: Record<string, unknown>,
    context: ToolContext,
  ) => {
    const targetFile = params.target_file as string;
    return getDisplayPath(targetFile || "", context.workdir);
  },
};
