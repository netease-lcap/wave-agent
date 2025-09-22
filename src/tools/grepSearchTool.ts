import type { ToolContext, ToolPlugin, ToolResult } from "./types";
import { spawn } from "child_process";
import { getGlobIgnorePatterns } from "../utils/fileFilter";
import { rgPath } from "vscode-ripgrep";

/**
 * Grep搜索工具插件 - 使用 ripgrep
 */
export const grepSearchTool: ToolPlugin = {
  name: "grep_search",
  description: "Search for text patterns in files using ripgrep",
  config: {
    type: "function",
    function: {
      name: "grep_search",
      description:
        "### Instructions:\nThis tool uses extended regex mode for powerful pattern matching.\nThis is best for finding exact text matches or regex patterns.\nThis is preferred over semantic search when we know the exact symbol/function name/etc. to search in some set of directories/file types.\n\nUse this tool to run fast, exact regex searches over text files.\nTo avoid overwhelming output, the results are capped at 50 matches.\nUse the include or exclude patterns to filter the search scope by file type or specific paths.\n\n- With -E mode, use standard extended regex syntax\n- For literal parentheses in patterns, escape them: \\( \\)\n- Other regex characters: . * + ? ^ $ | [ ] { } may need escaping depending on context\n- Do NOT perform fuzzy or semantic matches.\n- Return only a valid regex pattern string.\n\n### Examples:\n| Literal               | Regex Pattern            |\n|-----------------------|--------------------------|\n| function(             | function\\(              |\n| value[index]          | value\\[index\\]         |\n| file.txt               | file\\.txt                |\n| user OR admin         | user\\|admin             |\n| path\\to\\file         | path\\\\to\\\\file        |\n| hello world           | hello world              |",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The regex pattern to search for",
          },
          include_pattern: {
            type: "string",
            description:
              "Glob pattern for files to include (e.g. '*.ts' for TypeScript files, '*.ts,*.js,*.vue' for multiple file types, or 'src/**/*.ts' for path patterns).",
          },
          exclude_pattern: {
            type: "string",
            description: "Glob pattern for files to exclude",
          },
          case_sensitive: {
            type: "boolean",
            description: "Whether the search should be case sensitive",
          },
        },
        required: ["query"],
      },
    },
  },
  execute: async (
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<ToolResult> => {
    const query = args.query as string;
    const includePattern = args.include_pattern as string;
    const excludePattern = args.exclude_pattern as string;
    const caseSensitive = args.case_sensitive as boolean;

    if (!query || typeof query !== "string") {
      return {
        success: false,
        content: "",
        error: "query parameter is required and must be a string",
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
          "ripgrep is not available. Please install vscode-ripgrep package.",
      };
    }

    try {
      const workdir = context.workdir;
      const args = ["-n", "-H", "--color=never"]; // -n 显示行号, -H 显示文件名, --color=never 禁用颜色

      if (!caseSensitive) {
        args.push("-i");
      }

      // 添加包含模式
      if (includePattern) {
        const patterns = includePattern.split(",").map((p) => p.trim());
        for (const pattern of patterns) {
          args.push("--glob", pattern);
        }
      }

      // 获取通用忽略规则（包含 gitignore）
      const ignorePatterns = getGlobIgnorePatterns(workdir);

      // 添加排除模式
      const allExcludes = [...ignorePatterns];
      if (excludePattern) {
        const patterns = excludePattern.split(",").map((p) => p.trim());
        allExcludes.push(...patterns);
      }

      for (const exclude of allExcludes) {
        args.push("--glob", `!${exclude}`);
      }

      // 添加搜索模式
      args.push(query);

      // 添加搜索路径
      args.push(".");

      const result = await executeCommand(rgPath, args, workdir);

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

      // 限制结果数量
      const lines = output.split("\n");
      const maxResults = 50;
      const limitedLines = lines.slice(0, maxResults);

      return {
        success: true,
        content: limitedLines.join("\n"),
        shortResult: `Found ${lines.length} matches${lines.length > maxResults ? ` (showing first ${maxResults})` : ""}`,
      };
    } catch (error) {
      return {
        success: false,
        content: "",
        error: `Search failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  },
  formatCompactParams: (params: Record<string, unknown>) => {
    const query = params.query as string;
    const includePattern = params.include_pattern as string;

    if (!query) return "";

    if (includePattern) {
      return `${query}, ${includePattern}`;
    }

    return query;
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
        stdout: "",
        stderr: err.message,
        exitCode: null,
        error: true,
      });
    });
  });
}
