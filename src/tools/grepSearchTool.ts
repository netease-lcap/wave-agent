import type { ToolContext, ToolPlugin, ToolResult } from "./types";
import { spawn } from "child_process";
import { parseGitignoreForGrep } from "../utils/fileFilter";

/**
 * 检查模式是否包含路径分隔符
 */
function containsPathSeparator(pattern: string): boolean {
  // 检查是否包含 / 或 \ 或 ** (glob 路径模式)
  return (
    pattern.includes("/") || pattern.includes("\\") || pattern.includes("**")
  );
}

/**
 * Grep搜索工具插件 - 使用系统的 grep 命令
 */
export const grepSearchTool: ToolPlugin = {
  name: "grep_search",
  description: "Search for text patterns in files using system grep command",
  config: {
    type: "function",
    function: {
      name: "grep_search",
      description:
        "### Instructions:\nThis tool uses extended regex mode (grep -E) for powerful pattern matching.\nThis is best for finding exact text matches or regex patterns.\nThis is preferred over semantic search when we know the exact symbol/function name/etc. to search in some set of directories/file types.\n\nUse this tool to run fast, exact regex searches over text files.\nTo avoid overwhelming output, the results are capped at 50 matches.\nUse the include or exclude patterns to filter the search scope by file type or specific paths.\n\n- With -E mode, use standard extended regex syntax\n- For literal parentheses in patterns, escape them: \\( \\)\n- Other regex characters: . * + ? ^ $ | [ ] { } may need escaping depending on context\n- Do NOT perform fuzzy or semantic matches.\n- Return only a valid regex pattern string.\n\n### Examples:\n| Literal               | Regex Pattern            |\n|-----------------------|--------------------------|\n| function(             | function\\(              |\n| value[index]          | value\\[index\\]         |\n| file.txt               | file\\.txt                |\n| user OR admin         | user\\|admin             |\n| path\\to\\file         | path\\\\to\\\\file        |\n| hello world           | hello world              |",
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
              "Glob pattern for FILENAMES to include (e.g. '*.ts' for TypeScript files, or '*.ts,*.js,*.vue' for multiple file types). Note: Only filename patterns are supported, not path patterns like 'src/**/*.ts'.",
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

    // 验证 include_pattern 是否包含路径
    if (includePattern) {
      const patterns = includePattern.split(",").map((p) => p.trim());
      const invalidPatterns = patterns.filter(containsPathSeparator);

      if (invalidPatterns.length > 0) {
        return {
          success: false,
          content: "",
          error: `Invalid include_pattern: "${invalidPatterns.join('", "')}" contains path separators. The include_pattern only supports filename patterns like "*.ts", "*.js", not path patterns like "src/**/*.ts". Use exclude_pattern to filter directories instead.`,
        };
      }
    }

    try {
      const workdir = context.workdir;

      // 统一使用系统 grep，避免 git grep 只搜索已跟踪文件的限制
      const command = "grep";
      const args = ["-E", "-r", "-n", "-H"]; // -E 启用扩展正则, -r 递归, -n 显示行号, -H 显示文件名

      if (!caseSensitive) {
        args.push("-i");
      }

      // 获取 gitignore 中的排除规则
      const { excludeDirs, excludeFiles } = parseGitignoreForGrep(workdir);

      // 添加用户指定的排除模式
      if (excludePattern) {
        const patterns = excludePattern.split(",").map((p) => p.trim());
        for (const pattern of patterns) {
          excludeDirs.push(pattern);
        }
      }

      // 添加目录排除参数
      for (const dir of excludeDirs) {
        args.push("--exclude-dir=" + dir);
      }

      // 添加文件排除参数
      for (const file of excludeFiles) {
        args.push("--exclude=" + file);
      }

      // 添加包含模式
      if (includePattern) {
        const patterns = includePattern.split(",").map((p) => p.trim());
        for (const pattern of patterns) {
          args.push("--include=" + pattern);
        }
      }

      // 添加搜索模式
      args.push(query);

      // 添加搜索路径
      args.push(".");

      // 执行命令
      const result = await executeCommand(command, args, workdir);

      if (result.error && result.stderr.includes("command not found")) {
        return {
          success: false,
          content: "",
          error: `Command 'grep' not found. Please install grep.`,
        };
      }

      if (result.error && result.exitCode !== 1) {
        // grep 返回 1 表示没有匹配，不是错误
        return {
          success: false,
          content: "",
          error: `Search failed: ${result.stderr}`,
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
        error: code !== 0 && code !== 1, // grep 返回 1 表示没有匹配，不是错误
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
