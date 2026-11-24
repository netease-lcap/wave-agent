import { isAbsolute, join } from "path";
import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { resolvePath, getDisplayPath } from "../utils/path.js";
import { GLOB_TOOL_NAME } from "../constants/tools.js";
import { getRgPath } from "../utils/ripgrep.js";
import { ensureRuntimeDeps } from "../utils/runtimeDeps.js";
import { runCommand } from "../utils/runCommand.js";
import {
  buildGlobArgs,
  extractGlobBaseDirectory,
} from "../utils/globSearch.js";
import { logger } from "../utils/globalLogger.js";
import {
  renderGlobResultData,
  type GlobResultData,
} from "./resultData/glob.js";

/**
 * Maximum number of files returned by glob tool
 */
const MAX_GLOB_RESULTS = 100;

/**
 * Glob Tool Plugin - Fast file pattern matching
 */
export const globTool: ToolPlugin = {
  name: GLOB_TOOL_NAME,
  searchHint: "find files by name pattern",
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
- Returns matching file paths sorted by modification time (oldest first)
- Use this tool when you need to find files by name patterns
- When you are doing an open ended search that may require multiple rounds of globbing and grepping, use the Agent tool instead
- You can call multiple tools in a single response. It is always better to speculatively perform multiple searches in parallel if they are potentially useful.`,
  leanPrompt: `Fast file pattern matching. Supports glob patterns like "**/*.js" or "src/**/*.ts". Returns matching file paths sorted by modification time (oldest first), up to \`limit\` files (default ${MAX_GLOB_RESULTS}).`,
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const pattern = args.pattern as string;
    const searchPath = args.path as string;
    const limit = (args.limit as number) || MAX_GLOB_RESULTS;
    const startTime = Date.now();

    if (!pattern || typeof pattern !== "string") {
      return {
        success: false,
        content: "",
        error: "pattern parameter is required and must be a string",
      };
    }

    // Resolved per call, not at import time: the CLI installs this dependency
    // itself, possibly after the module graph has been evaluated.
    const rgPath = getRgPath();
    if (!rgPath) {
      // Cover the entry points that do not await the installer at startup.
      void ensureRuntimeDeps();
      return {
        success: false,
        content: "",
        error:
          "ripgrep is not available. Please install @vscode/ripgrep package.",
      };
    }

    try {
      // The walk root. `path` wins when given; an absolute pattern points
      // somewhere of its own and overrides it, since only the part below the
      // walk root can be a glob.
      let searchDir = searchPath
        ? resolvePath(searchPath, context.workdir)
        : context.workdir;
      let relativePattern = pattern;

      if (isAbsolute(pattern)) {
        const { baseDir, relativePattern: remainder } =
          extractGlobBaseDirectory(pattern);
        if (baseDir) {
          searchDir = baseDir;
          relativePattern = remainder;
        }
      }

      const result = await runCommand(
        rgPath,
        buildGlobArgs(relativePattern),
        searchDir,
      );

      // A null exit code is a spawn failure; anything above 1 means the walk
      // itself reported a problem (a walk root that does not exist, say) and
      // must not be reported as "no files".
      if (
        result.exitCode === null ||
        (result.exitCode > 1 && !result.stdout.trim())
      ) {
        return {
          success: false,
          content: "",
          error: `Glob search failed: ${result.stderr.trim() || "ripgrep exited with an error"}`,
        };
      }

      if (result.exitCode > 1) {
        logger.debug(
          `ripgrep exited with code ${result.exitCode}, keeping partial results: ${result.stderr.trim()}`,
        );
      }

      // ripgrep answers with paths relative to the walk root; make them absolute
      // first so display can decide between relative and absolute, exactly as
      // the other file tools do.
      const absoluteFiles = result.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .map((file) => (isAbsolute(file) ? file : join(searchDir, file)));

      if (absoluteFiles.length === 0) {
        const data: GlobResultData = {
          durationMs: Date.now() - startTime,
          numFiles: 0,
          filenames: [],
          truncated: false,
        };
        return {
          success: true,
          data,
          content: renderGlobResultData(data),
          shortResult: "No files found",
        };
      }

      const totalCount = absoluteFiles.length;
      const isTruncated = totalCount > limit;
      // 相对路径（CC 的 `toRelativePath`）：渲染与脚本用同一份，不另存绝对路径。
      const filenames = absoluteFiles
        .slice(0, limit)
        .map((file) => getDisplayPath(file, context.workdir));
      const data: GlobResultData = {
        durationMs: Date.now() - startTime,
        numFiles: filenames.length,
        filenames,
        truncated: isTruncated,
      };

      return {
        success: true,
        data,
        content: renderGlobResultData(data),
        shortResult: isTruncated
          ? `Found ${totalCount} files (showing first ${limit})`
          : `Found ${totalCount} file${totalCount === 1 ? "" : "s"}`,
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
