import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { spawn } from "child_process";
import { getGlobIgnorePatterns } from "../utils/fileFilter.js";
import { rgPath } from "@vscode/ripgrep";
import { getDisplayPath } from "../utils/path.js";

/**
 * Grep tool plugin - powerful search tool based on ripgrep
 */
export const grepTool: ToolPlugin = {
  name: "Grep",
  config: {
    type: "function",
    function: {
      name: "Grep",
      description:
        'A powerful search tool built on ripgrep\n\n  Usage:\n  - ALWAYS use Grep for search tasks. NEVER invoke `grep` or `rg` as a Bash command. The Grep tool has been optimized for correct permissions and access.\n  - Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")\n  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")\n  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts\n  - Use Task tool for open-ended searches requiring multiple rounds\n  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use `interface\\{\\}` to find `interface{}` in Go code)\n  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like `struct \\{[\\s\\S]*?field`, use `multiline: true`',
      parameters: {
        type: "object",
        properties: {
          pattern: {
            type: "string",
            description:
              "The regular expression pattern to search for in file contents",
          },
          path: {
            type: "string",
            description:
              "File or directory to search in (rg PATH). Defaults to current working directory.",
          },
          glob: {
            type: "string",
            description:
              'Glob pattern to filter files (e.g. "*.js", "*.{ts,tsx}") - maps to rg --glob',
          },
          output_mode: {
            type: "string",
            enum: ["content", "files_with_matches", "count"],
            description:
              'Output mode: "content" shows matching lines (supports -A/-B/-C context, -n line numbers, head_limit), "files_with_matches" shows file paths (supports head_limit), "count" shows match counts (supports head_limit). Defaults to "files_with_matches".',
          },
          "-B": {
            type: "number",
            description:
              'Number of lines to show before each match (rg -B). Requires output_mode: "content", ignored otherwise.',
          },
          "-A": {
            type: "number",
            description:
              'Number of lines to show after each match (rg -A). Requires output_mode: "content", ignored otherwise.',
          },
          "-C": {
            type: "number",
            description:
              'Number of lines to show before and after each match (rg -C). Requires output_mode: "content", ignored otherwise.',
          },
          "-n": {
            type: "boolean",
            description:
              'Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise.',
          },
          "-i": {
            type: "boolean",
            description: "Case insensitive search (rg -i)",
          },
          type: {
            type: "string",
            description:
              "File type to search (rg --type). Common types: js, py, rust, go, java, etc. More efficient than include for standard file types.",
          },
          head_limit: {
            type: "number",
            description:
              'Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to 100 to prevent excessive token usage.',
          },
          multiline: {
            type: "boolean",
            description:
              "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.",
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
    const globPattern = args.glob as string;
    const outputMode = (args.output_mode as string) || "files_with_matches";
    const contextBefore = args["-B"] as number;
    const contextAfter = args["-A"] as number;
    const contextAround = args["-C"] as number;
    const showLineNumbers = args["-n"] as boolean;
    const caseInsensitive = args["-i"] as boolean;
    const fileType = args.type as string;
    const headLimit = args.head_limit as number;
    const multiline = args.multiline as boolean;

    if (!pattern || typeof pattern !== "string") {
      return {
        success: false,
        content: "",
        error: "pattern parameter is required and must be a string",
      };
    }

    if (!rgPath) {
      return {
        success: false,
        content: "",
        error:
          "ripgrep is not available. Please install @vscode/ripgrep package.",
      };
    }

    try {
      const workdir = context.workdir;
      const rgArgs: string[] = ["--color=never"];

      // Set output mode
      if (outputMode === "files_with_matches") {
        rgArgs.push("-l");
      } else if (outputMode === "count") {
        rgArgs.push("-c");
      }
      // content mode is default, no special parameters needed

      // Add line numbers (only effective in content mode)
      if (showLineNumbers && outputMode === "content") {
        rgArgs.push("-n");
      }

      // Add file names (in content mode)
      if (outputMode === "content") {
        rgArgs.push("-H");
      }

      // Case insensitive
      if (caseInsensitive) {
        rgArgs.push("-i");
      }

      // Multiline mode
      if (multiline) {
        rgArgs.push("-U", "--multiline-dotall");
      }

      // Context lines (only effective in content mode)
      if (outputMode === "content") {
        if (contextAround) {
          rgArgs.push("-C", contextAround.toString());
        } else {
          if (contextBefore) {
            rgArgs.push("-B", contextBefore.toString());
          }
          if (contextAfter) {
            rgArgs.push("-A", contextAfter.toString());
          }
        }
      }

      // File type filtering
      if (fileType) {
        rgArgs.push("--type", fileType);
      }

      // Glob pattern filtering
      if (globPattern) {
        rgArgs.push("--glob", globPattern);
      }

      // Get common ignore rules
      const ignorePatterns = getGlobIgnorePatterns(workdir);
      for (const exclude of ignorePatterns) {
        rgArgs.push("--glob", `!${exclude}`);
      }

      // Add search pattern - use -e parameter to avoid patterns starting with - being mistaken as command line options
      rgArgs.push("-e", pattern);

      // Add search path
      if (searchPath) {
        rgArgs.push(searchPath);
      } else {
        rgArgs.push(".");
      }

      const result = await executeCommand(rgPath, rgArgs, workdir);

      if (result.error && result.exitCode !== 1) {
        // rg returns 1 for no matches, not an error
        return {
          success: false,
          content: "",
          error: `ripgrep failed: ${result.stderr}`,
        };
      }

      const output = result.stdout.trim();
      if (!output) {
        return {
          success: true,
          content: "No matches found",
          shortResult: "No matches found",
        };
      }

      // Apply head_limit with default fallback
      let finalOutput = output;
      let lines = output.split("\n");

      // Set default head_limit if not specified to prevent excessive token usage
      const effectiveHeadLimit = headLimit || 100;

      if (lines.length > effectiveHeadLimit) {
        lines = lines.slice(0, effectiveHeadLimit);
        finalOutput = lines.join("\n");
      }

      // Generate short result
      let shortResult: string;
      const totalLines = output.split("\n").length;

      if (outputMode === "files_with_matches") {
        shortResult = `Found ${totalLines} file${totalLines === 1 ? "" : "s"}`;
      } else if (outputMode === "count") {
        shortResult = `Match counts for ${totalLines} file${totalLines === 1 ? "" : "s"}`;
      } else {
        shortResult = `Found ${totalLines} matching line${totalLines === 1 ? "" : "s"}`;
      }

      if (effectiveHeadLimit && totalLines > effectiveHeadLimit) {
        shortResult += ` (showing first ${effectiveHeadLimit})`;
      }

      return {
        success: true,
        content: finalOutput,
        shortResult,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  formatCompactParams: (
    params: Record<string, unknown>,
    context: ToolContext,
  ) => {
    const pattern = params.pattern as string;
    const outputMode = params.output_mode as string;
    const fileType = params.type as string;
    const path = params.path as string;

    let result = pattern || "";

    if (fileType) {
      result += ` ${fileType}`;
    }

    if (path) {
      const displayPath = getDisplayPath(path, context.workdir);
      result += ` in ${displayPath}`;
    }

    if (outputMode && outputMode !== "files_with_matches") {
      result += ` [${outputMode}]`;
    }

    return result;
  },
};

/**
 * Execute command and return result
 */
function executeCommand(
  command: string,
  args: string[],
  cwd: string,
): Promise<{
  stdout: string;
  stderr: string;
  exitCode: number | null;
  error: boolean;
}> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd,
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
      resolve({
        stdout,
        stderr,
        exitCode: code,
        error: code !== 0 && code !== 1, // rg returns 1 for no matches, not an error
      });
    });

    child.on("error", (err) => {
      resolve({
        stdout,
        stderr: err.message,
        exitCode: null,
        error: true,
      });
    });
  });
}
