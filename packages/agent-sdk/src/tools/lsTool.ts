import * as fs from "fs";
import * as path from "path";
import { minimatch } from "minimatch";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { isBinary, getDisplayPath } from "@/utils/path.js";

/**
 * LS Tool Plugin - List files and directories
 */
export const lsTool: ToolPlugin = {
  name: "LS",
  description: "Lists files and directories in a given path",
  config: {
    type: "function",
    function: {
      name: "LS",
      description:
        "Lists files and directories in a given path. The path parameter must be an absolute path, not a relative path. You can optionally provide an array of glob patterns to ignore with the ignore parameter. You should generally prefer the Glob and Grep tools, if you know which directories to search.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "The absolute path to the directory to list (must be absolute, not relative)",
          },
          ignore: {
            type: "array",
            items: {
              type: "string",
            },
            description: "List of glob patterns to ignore",
          },
        },
        required: ["path"],
      },
    },
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const targetPath = args.path as string;
    const ignorePatterns = args.ignore as string[];

    // Note: context.workdir is not used as this tool requires absolute paths
    void context.workdir;

    if (!targetPath || typeof targetPath !== "string") {
      return {
        success: false,
        content: "",
        error: "path parameter is required and must be a string",
      };
    }

    // Validate that the path is absolute
    if (!path.isAbsolute(targetPath)) {
      return {
        success: false,
        content: "",
        error: "Path must be an absolute path, not a relative path",
      };
    }

    try {
      // Check if path exists and is a directory
      const stats = await fs.promises.stat(targetPath);
      if (!stats.isDirectory()) {
        return {
          success: false,
          content: "",
          error: `Path ${targetPath} is not a directory`,
        };
      }

      // Read directory contents
      const entries = await fs.promises.readdir(targetPath, {
        withFileTypes: true,
      });

      // Process directory items
      const items: { name: string; type: string; size?: number }[] = [];

      for (const entry of entries) {
        const entryPath = path.join(targetPath, entry.name);

        // Check if it should be ignored
        if (ignorePatterns && Array.isArray(ignorePatterns)) {
          const shouldIgnore = ignorePatterns.some(
            (pattern) =>
              minimatch(entry.name, pattern) || minimatch(entryPath, pattern),
          );
          if (shouldIgnore) {
            continue;
          }
        }

        if (entry.isDirectory()) {
          items.push({
            name: entry.name,
            type: "directory",
          });
        } else if (entry.isFile()) {
          try {
            const fileStats = await fs.promises.stat(entryPath);
            items.push({
              name: entry.name,
              type: "file",
              size: fileStats.size,
            });
          } catch {
            // If file stats cannot be obtained, still add the file but do not display size
            items.push({
              name: entry.name,
              type: "file",
            });
          }
        } else if (entry.isSymbolicLink()) {
          items.push({
            name: entry.name,
            type: "symlink",
          });
        }
      }

      // Sort: directories first, then files, both alphabetically
      items.sort((a, b) => {
        if (a.type === "directory" && b.type !== "directory") return -1;
        if (a.type !== "directory" && b.type === "directory") return 1;
        return a.name.localeCompare(b.name);
      });

      let content = `Directory: ${targetPath}\n`;
      content += `Total items: ${items.length}\n\n`;

      for (const item of items) {
        let typeIndicator: string;
        switch (item.type) {
          case "directory":
            typeIndicator = "📁";
            break;
          case "symlink":
            typeIndicator = "🔗";
            break;
          default:
            typeIndicator = "📄";
        }

        const sizeInfo = item.size !== undefined ? ` (${item.size} bytes)` : "";
        const binaryInfo =
          item.type === "file" && isBinary(item.name) ? " [binary]" : "";
        content += `${typeIndicator} ${item.name}${sizeInfo}${binaryInfo}\n`;
      }

      return {
        success: true,
        content: content.trim(),
        shortResult: `${items.length} items (${items.filter((i) => i.type === "directory").length} dirs, ${items.filter((i) => i.type === "file").length} files)`,
      };
    } catch (error) {
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
    const targetPath = params.path as string;
    const ignorePatterns = params.ignore as string[];

    let result = getDisplayPath(targetPath || "", context.workdir);

    if (
      ignorePatterns &&
      Array.isArray(ignorePatterns) &&
      ignorePatterns.length > 0
    ) {
      result += ` ignore: ${ignorePatterns.join(", ")}`;
    }

    return result;
  },
};
