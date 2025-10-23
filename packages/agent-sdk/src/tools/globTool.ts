import { glob } from "glob";
import { stat } from "fs/promises";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { resolvePath, getDisplayPath } from "../utils/path.js";
import { getGlobIgnorePatterns } from "../utils/fileFilter.js";

/**
 * Glob Tool Plugin - Fast file pattern matching
 */
export const globTool: ToolPlugin = {
  name: "Glob",
  description:
    "Fast file pattern matching tool that works with any codebase size",
  config: {
    type: "function",
    function: {
      name: "Glob",
      description:
        '- Fast file pattern matching tool that works with any codebase size\n- Supports glob patterns like "**/*.js" or "src/**/*.ts"\n- Returns matching file paths sorted by modification time\n- Use this tool when you need to find files by name patterns\n- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead\n- You have the capability to call multiple tools in a single response. It is always better to speculatively perform multiple searches as a batch that are potentially useful.',
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description: "The glob pattern to match files against",
          },
          path: {
            type: "string",
            description:
              'The directory to search in. If not specified, the current working directory will be used. IMPORTANT: Omit this field to use the default directory. DO NOT enter "undefined" or "null" - simply omit it for the default behavior. Must be a valid directory path if provided.',
          },
        },
        required: ["pattern"],
      },
    },
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const pattern = args.pattern as string;
    const searchPath = args.path as string;

    if (!pattern || typeof pattern !== "string") {
      return {
        success: false,
        content: "",
        error: "pattern parameter is required and must be a string",
      };
    }

    try {
      // Determine search directory
      const workdir = searchPath
        ? resolvePath(searchPath, context.workdir)
        : context.workdir;

      // Execute glob search
      const matches = await glob(pattern, {
        cwd: workdir,
        ignore: getGlobIgnorePatterns(workdir),
        dot: false,
        absolute: false,
        nocase: false, // Keep case sensitive
      });

      if (matches.length === 0) {
        return {
          success: true,
          content: "No files match the pattern",
          shortResult: "No matches found",
        };
      }

      // Get file modification time and sort
      const filesWithStats = await Promise.allSettled(
        matches.map(async (file) => {
          try {
            const fullPath = resolvePath(file, context.workdir);
            const stats = await stat(fullPath);
            return {
              path: file,
              mtime: stats.mtime,
            };
          } catch {
            // If unable to get file stats, use current time
            return {
              path: file,
              mtime: new Date(),
            };
          }
        }),
      );

      // Filter successful results and sort by modification time
      const sortedFiles = filesWithStats
        .filter((result) => result.status === "fulfilled")
        .map(
          (result) =>
            (result as PromiseFulfilledResult<{ path: string; mtime: Date }>)
              .value,
        )
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime()) // Most recently modified files first
        .map((item) => item.path);

      // Format output
      const output = sortedFiles
        .map((file, index) => `${index + 1}. ${file}`)
        .join("\n");

      return {
        success: true,
        content: output,
        shortResult: `Found ${sortedFiles.length} file${sortedFiles.length === 1 ? "" : "s"}`,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: `Glob search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  formatCompactParams: (
    params: Record<string, unknown>,
    context: ToolContext,
  ) => {
    const pattern = params.pattern as string;
    const path = params.path as string;

    if (path) {
      const displayPath = getDisplayPath(path, context.workdir);
      return `${pattern} in ${displayPath}`;
    }
    return pattern || "";
  },
};
