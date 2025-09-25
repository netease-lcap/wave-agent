import type { ToolContext, ToolPlugin, ToolResult } from "./types";
import { spawn } from "child_process";
import { getGlobIgnorePatterns } from "../utils/fileFilter";
import { rgPath } from "@vscode/ripgrep";
import { getDisplayPath } from "../utils/path";

/**
 * Grep 工具插件 - 基于 ripgrep 的强大搜索工具
 */
export const grepTool: ToolPlugin = {
  name: "Grep",
  description: "A powerful search tool built on ripgrep",
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
              'Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). When unspecified, shows all results from ripgrep.',
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
    context?: ToolContext,
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

    if (!context?.workdir) {
      return {
        success: false,
        content: "",
        error: "Working directory not available in context",
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

      // 设置输出模式
      if (outputMode === "files_with_matches") {
        rgArgs.push("-l");
      } else if (outputMode === "count") {
        rgArgs.push("-c");
      }
      // content 模式是默认的，不需要特殊参数

      // 添加行号 (仅在 content 模式下有效)
      if (showLineNumbers && outputMode === "content") {
        rgArgs.push("-n");
      }

      // 添加文件名 (在 content 模式下)
      if (outputMode === "content") {
        rgArgs.push("-H");
      }

      // 大小写不敏感
      if (caseInsensitive) {
        rgArgs.push("-i");
      }

      // 多行模式
      if (multiline) {
        rgArgs.push("-U", "--multiline-dotall");
      }

      // 上下文行数 (仅在 content 模式下有效)
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

      // 文件类型过滤
      if (fileType) {
        rgArgs.push("--type", fileType);
      }

      // Glob 模式过滤
      if (globPattern) {
        const patterns = globPattern.split(",").map((p) => p.trim());
        for (const pat of patterns) {
          rgArgs.push("--glob", pat);
        }
      }

      // 获取通用忽略规则
      const ignorePatterns = getGlobIgnorePatterns(workdir);
      for (const exclude of ignorePatterns) {
        rgArgs.push("--glob", `!${exclude}`);
      }

      // 添加搜索模式
      rgArgs.push(pattern);

      // 添加搜索路径
      if (searchPath) {
        rgArgs.push(searchPath);
      } else {
        rgArgs.push(".");
      }

      const result = await executeCommand(rgPath, rgArgs, workdir);

      if (result.error && result.exitCode !== 1) {
        // rg 返回 1 表示没有匹配，不是错误
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

      // 应用 head_limit
      let finalOutput = output;
      let lines = output.split("\n");

      if (headLimit && headLimit > 0 && lines.length > headLimit) {
        lines = lines.slice(0, headLimit);
        finalOutput = lines.join("\n");
      }

      // 生成简短结果
      let shortResult: string;
      const totalLines = output.split("\n").length;

      if (outputMode === "files_with_matches") {
        shortResult = `Found ${totalLines} file${totalLines === 1 ? "" : "s"}`;
      } else if (outputMode === "count") {
        shortResult = `Match counts for ${totalLines} file${totalLines === 1 ? "" : "s"}`;
      } else {
        shortResult = `Found ${totalLines} matching line${totalLines === 1 ? "" : "s"}`;
      }

      if (headLimit && totalLines > headLimit) {
        shortResult += ` (showing first ${headLimit})`;
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
  formatCompactParams: (params: Record<string, unknown>, workdir?: string) => {
    const pattern = params.pattern as string;
    const outputMode = params.output_mode as string;
    const fileType = params.type as string;
    const path = params.path as string;

    let result = pattern || "";

    if (fileType) {
      result += ` (${fileType})`;
    }

    if (path) {
      const displayPath = getDisplayPath(path, workdir);
      result += ` in ${displayPath}`;
    }

    if (outputMode && outputMode !== "files_with_matches") {
      result += ` [${outputMode}]`;
    }

    return result;
  },
};

/**
 * 执行命令并返回结果
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
        error: code !== 0 && code !== 1, // rg 返回 1 表示没有匹配，不是错误
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
