import { spawn } from "child_process";
import { rgPath } from "@vscode/ripgrep";
import { stat } from "fs/promises";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { resolvePath, getDisplayPath } from "../utils/path.js";
import { getAllIgnorePatterns } from "../utils/fileFilter.js";
import { GLOB_TOOL_NAME } from "../constants/tools.js";

/**
 * Maximum number of files returned by glob tool
 */
const MAX_GLOB_RESULTS = 1000;

/**
 * Execute ripgrep to find files matching a pattern
 */
async function runRipgrep(pattern: string, workdir: string): Promise<string[]> {
  if (!rgPath) {
    throw new Error("ripgrep is not available");
  }

  const ignorePatterns = getAllIgnorePatterns();
  const rgArgs = ["--files", "--color=never", "--hidden", "--glob", pattern];

  for (const ignorePattern of ignorePatterns) {
    rgArgs.push("--glob", `!${ignorePattern}`);
  }

  return new Promise<string[]>((resolve, reject) => {
    const child = spawn(rgPath, rgArgs, {
      cwd: workdir,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";

    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code !== 0 && code !== 1) {
        reject(
          new Error(
            `ripgrep failed with code ${code}: ${stderr || "Unknown error"}`,
          ),
        );
        return;
      }
      const files = stdout
        .trim()
        .split("\n")
        .filter((f) => f.length > 0)
        .map((f) => f.replace(/\\/g, "/")); // Normalize to forward slashes
      resolve(files);
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

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

      // Execute glob search using ripgrep
      const matches = await runRipgrep(pattern, workdir);

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
      const finalFiles = sortedFiles.slice(0, MAX_GLOB_RESULTS);

      // Format output
      const output = finalFiles
        .map((file, index) => `${index + 1}. ${file}`)
        .join("\n");

      const isTruncated = totalCount > MAX_GLOB_RESULTS;
      const shortResult = isTruncated
        ? `Found ${totalCount} files (showing first ${MAX_GLOB_RESULTS})`
        : `Found ${totalCount} file${totalCount === 1 ? "" : "s"}`;

      return {
        success: true,
        content: output,
        shortResult,
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
