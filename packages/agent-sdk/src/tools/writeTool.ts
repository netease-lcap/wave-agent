import { readFile, writeFile, mkdir } from "fs/promises";
import { dirname } from "path";
import { logger } from "../utils/globalLogger.js";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { resolvePath, getDisplayPath } from "../utils/path.js";

/**
 * File Write Tool Plugin
 */
export const writeTool: ToolPlugin = {
  name: "Write",
  config: {
    type: "function",
    function: {
      name: "Write",
      description:
        "Writes a file to the local filesystem.\n\nUsage:\n- This tool will overwrite the existing file if there is one at the provided path.\n- If this is an existing file, you MUST use the Read tool first to read the file's contents. This tool will fail if you did not read the file first.\n- ALWAYS prefer editing existing files in the codebase. NEVER write new files unless explicitly required.\n- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested by the User.\n- Only use emojis if the user explicitly requests it. Avoid writing emojis to files unless asked.\n- IMPORTANT: Always provide file_path parameter before content parameter when calling this tool.",
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
    context: ToolContext,
  ): Promise<ToolResult> => {
    const filePath = args.file_path as string;
    const content = args.content as string;

    // Validate required parameters
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
      const resolvedPath = resolvePath(filePath, context.workdir);

      // Check if file already exists
      let originalContent = "";
      let isExistingFile = false;

      try {
        originalContent = await readFile(resolvedPath, "utf-8");
        isExistingFile = true;
      } catch {
        // File doesn't exist, this is normal for new file creation
        isExistingFile = false;
      }

      // Check if overwriting existing file but content is the same
      if (isExistingFile && originalContent === content) {
        return {
          success: true,
          content: `File ${filePath} already has the same content, no changes needed`,
          shortResult: "No changes needed",
          filePath: resolvedPath,
        };
      }

      // Ensure directory exists
      const fileDir = dirname(resolvedPath);
      try {
        await mkdir(fileDir, { recursive: true });
      } catch (mkdirError) {
        // Ignore directory already exists error
        if (
          mkdirError instanceof Error &&
          !mkdirError.message.includes("EEXIST")
        ) {
          logger.warn(
            `Failed to create directory ${fileDir}: ${mkdirError.message}`,
          );
        }
      }

      // Permission check after validation but before real operation
      if (
        context.permissionManager &&
        context.permissionMode &&
        context.permissionMode !== "bypassPermissions"
      ) {
        if (context.permissionManager.isRestrictedTool("Write")) {
          try {
            const permissionContext = context.permissionManager.createContext(
              "Write",
              context.permissionMode,
              context.canUseToolCallback,
              { file_path: filePath, content },
            );
            const permissionResult =
              await context.permissionManager.checkPermission(
                permissionContext,
              );

            if (permissionResult.behavior === "deny") {
              return {
                success: false,
                content: "",
                error: `Write operation denied by user, reason: ${permissionResult.message || "No reason provided"}`,
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

      // Write file
      try {
        await writeFile(resolvedPath, content, "utf-8");
      } catch (writeError) {
        return {
          success: false,
          content: "",
          error: `Failed to write file: ${writeError instanceof Error ? writeError.message : String(writeError)}`,
        };
      }

      const shortResult = isExistingFile ? "File overwritten" : "File created";

      const lines = content.split("\n").length;
      const chars = content.length;
      const detailedContent = `${shortResult} (${lines} lines, ${chars} characters)`;

      logger.debug(`Write tool: ${shortResult}`);

      return {
        success: true,
        content: detailedContent,
        shortResult,
        filePath: resolvedPath,
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
  formatCompactParams: (
    params: Record<string, unknown>,
    context: ToolContext,
  ) => {
    const filePath = params.file_path as string;
    const content = params.content as string;

    let displayPath = getDisplayPath(filePath || "", context.workdir);

    if (content) {
      const lines = content.split("\n").length;
      const chars = content.length;
      displayPath += ` ${lines} lines, ${chars} chars`;
    }

    return displayPath;
  },
};
