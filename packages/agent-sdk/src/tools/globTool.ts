import { glob } from "glob";
import { stat } from "fs/promises";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { resolvePath, getDisplayPath } from "../utils/path.js";
import { GLOB_TOOL_NAME } from "../constants/tools.js";
import { requireString } from "./validation.js";

/**
 * Maximum number of files returned by glob tool
 */
const MAX_GLOB_RESULTS = 100;

/**
 * Glob Tool Plugin - Fast file pattern matching
 */
export const globTool: ToolPlugin = {
  name: GLOB_TOOL_NAME,
  config: {
    type: "function",
    function: {
      name: GLOB_TOOL_NAME,
      description:
        "Fast file pattern matching tool that works with any codebase size",
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
          limit: {
            type: "number",
            description: "Maximum number of files to return. Defaults to 100.",
          },
        },
        required: ["pattern"],
      },
    },
  },
  prompt:
    () => `- Fast file pattern matching tool that works with any codebase size
- Supports glob patterns like "**/*.js" or "src/**/*.ts"
- Returns matching file paths sorted by modification time
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.`,
  validate: (args: Record<string, unknown>): ToolResult | null => {
    // Validate pattern is required and a string
    return requireString(args, "pattern");
  },
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const pattern = args.pattern as string;
    const searchPath = args.path as string;
    const limit = (args.limit as number) || MAX_GLOB_RESULTS;
    const startTime = Date.now();

    try {
      // Determine search directory
      const workdir = searchPath
        ? resolvePath(searchPath, context.workdir)
        : context.workdir;

      // Execute glob search using glob package
      const matches = await glob(pattern, {
        cwd: workdir,
        nodir: true,
        dot: true,
        ignore: ["**/.git/**"],
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
            const fullPath = resolvePath(file, workdir);
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

      const totalCount = sortedFiles.length;
      const finalFiles = sortedFiles.slice(0, limit);

      // Format output
      const output = finalFiles
        .map((file, index) => `${index + 1}. ${file}`)
        .join("\n");

      const isTruncated = totalCount > limit;
      const shortResult = isTruncated
        ? `Found ${totalCount} files (showing first ${limit})`
        : `Found ${totalCount} file${totalCount === 1 ? "" : "s"}`;

      const durationMs = Date.now() - startTime;

      return {
        success: true,
        content: output,
        shortResult,
        metadata: {
          durationMs,
          numFiles: totalCount,
          truncated: isTruncated,
        },
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
