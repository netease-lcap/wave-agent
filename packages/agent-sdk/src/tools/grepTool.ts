import type { ToolPlugin, ToolResult, ToolContext } from "./types.js";
import { getRgPath } from "../utils/ripgrep.js";
import { ensureRuntimeDeps } from "../utils/runtimeDeps.js";
import { getDisplayPath } from "../utils/path.js";
import { runCommand } from "../utils/runCommand.js";
import { VCS_DIRECTORIES } from "../utils/vcsDirectories.js";
import { logger } from "../utils/globalLogger.js";
import {
  cwdRecoveryNote,
  grepOutputSchema,
  renderGrepResultData,
  type CwdRecovery,
  type GrepOutputMode,
  type GrepResultData,
} from "./resultData/grep.js";
import {
  GREP_TOOL_NAME,
  BASH_TOOL_NAME,
  AGENT_TOOL_NAME,
} from "../constants/tools.js";

/**
 * `count` 模式的合计（CC 在 `GrepTool.ts:500-512` 现算）：每行 `路径:计数`，行数
 * 即文件数、计数相加即匹配总数。算的是**当前页**——CC 也是在 head_limit / offset
 * 之后才统计，摘要里的数字必须与正文列出的行对得上。
 */
function countTotals(lines: string[]): {
  numMatches: number;
  numFiles: number;
} {
  let numMatches = 0;
  let numFiles = 0;
  for (const line of lines) {
    // 只认最后一个冒号：Windows 盘符 `C:\...` 里也有冒号。
    const colon = line.lastIndexOf(":");
    if (colon <= 0) continue;
    const count = Number.parseInt(line.slice(colon + 1), 10);
    if (Number.isNaN(count)) continue;
    numMatches += count;
    numFiles += 1;
  }
  return { numMatches, numFiles };
}

/**
 * 把 ripgrep 的输出折成 `Grep` 的 `data`（形状见 `resultData/grep.ts`）。三个模式
 * 的空壳字段照 CC 填：`content` 模式 `numFiles: 0` + `filenames: []`，`count` 模式
 * `filenames: []`。
 */
function buildResultData(
  mode: GrepOutputMode,
  lines: string[],
  /** 只在这一页真的被 head_limit 截短时才给（CC 的 `applyHeadLimit`）。 */
  appliedLimit: number | undefined,
  /** 0 表示没跳过；渲染器同样按真假判。 */
  appliedOffset: number,
  cwdRecovery: CwdRecovery | null | undefined,
): GrepResultData {
  let data: GrepResultData;
  if (mode === "files_with_matches") {
    data = { mode, numFiles: lines.length, filenames: lines };
  } else if (mode === "count") {
    const totals = countTotals(lines);
    data = {
      mode,
      numFiles: totals.numFiles,
      filenames: [],
      content: lines.join("\n"),
      numMatches: totals.numMatches,
    };
  } else {
    data = {
      mode,
      numFiles: 0,
      filenames: [],
      content: lines.join("\n"),
      numLines: lines.length,
    };
  }

  // 分页字段只在真的生效时出现，否则模型会以为还有下一页可翻。
  if (appliedLimit !== undefined) data.appliedLimit = appliedLimit;
  if (appliedOffset > 0) data.appliedOffset = appliedOffset;
  if (cwdRecovery) data.cwdRecovery = cwdRecovery;
  return data;
}

/**
 * Grep tool plugin - powerful search tool based on ripgrep
 */
export const grepTool: ToolPlugin = {
  name: GREP_TOOL_NAME,
  searchHint: "search file contents with regex (ripgrep)",
  outputSchema: grepOutputSchema,
  config: {
    type: "function",
    function: {
      name: GREP_TOOL_NAME,
      description: "A powerful search tool built on ripgrep",
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
              'Show line numbers in output (rg -n). Requires output_mode: "content", ignored otherwise. Defaults to true.',
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
              'Limit output to first N lines/entries, equivalent to "| head -N". Works across all output modes: content (limits output lines), files_with_matches (limits file paths), count (limits count entries). Defaults to 0 (unlimited).',
          },
          multiline: {
            type: "boolean",
            description:
              "Enable multiline mode where . matches newlines and patterns can span lines (rg -U --multiline-dotall). Default: false.",
          },
          offset: {
            type: "number",
            description: "The number of matches to skip.",
          },
          context: {
            type: "number",
            description:
              'Alias for -C. Number of lines to show before and after each match. Requires output_mode: "content", ignored otherwise.',
          },
        },
        required: ["pattern"],
      },
    },
  },
  prompt: () => `A powerful search tool built on ripgrep

  Usage:
  - ALWAYS use ${GREP_TOOL_NAME} for search tasks. NEVER invoke \`grep\` or \`rg\` as a ${BASH_TOOL_NAME} command. The ${GREP_TOOL_NAME} tool has been optimized for correct permissions and access.
  - Supports full regex syntax (e.g., "log.*Error", "function\\s+\\w+")
  - Filter files with glob parameter (e.g., "*.js", "**/*.tsx") or type parameter (e.g., "js", "py", "rust")
  - Output modes: "content" shows matching lines, "files_with_matches" shows only file paths (default), "count" shows match counts
  - Use ${AGENT_TOOL_NAME} tool for open-ended searches requiring multiple rounds
  - Pattern syntax: Uses ripgrep (not grep) - literal braces need escaping (use \`interface\\{\\}\` to find \`interface{}\` in Go code)
  - Multiline matching: By default patterns match within single lines only. For cross-line patterns like \`struct \\{[\\s\\S]*?field\`, use \`multiline: true\`
`,
  leanPrompt: `Content search built on ripgrep. Prefer this over \`grep\`/\`rg\` via ${BASH_TOOL_NAME} — results integrate with the permission UI and file links.

- Full regex syntax (e.g. "log.*Error", "function\\s+\\w+"). Ripgrep, not grep — escape literal braces (\`interface\\{\\}\`).
- Filter with \`glob\` (e.g. "**/*.tsx") or \`type\` (e.g. "js", "py", "rust").
- \`output_mode\`: "content" (matching lines), "files_with_matches" (paths only, default), or "count".
- \`-B\` / \`-A\` / \`-C\` add context lines around each match; \`context\` is an alias for \`-C\`.
- \`multiline: true\` for patterns that span lines.`,
  execute: async (
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> => {
    const pattern = args.pattern as string;
    const searchPath = args.path as string;
    const globPattern = args.glob as string;
    // 三档模式的类型化版本：缺省与非法值都落到 `files_with_matches`（原来的
    // `|| "files_with_matches"`），这样 rg 参数与 `data.mode` 不会各说一套。
    const outputMode: GrepOutputMode =
      args.output_mode === "content" || args.output_mode === "count"
        ? args.output_mode
        : "files_with_matches";
    const contextBefore = args["-B"] as number;
    const contextAfter = args["-A"] as number;
    const contextAround = args["-C"] as number;
    const showLineNumbers = args["-n"] !== false;
    const caseInsensitive = args["-i"] as boolean;
    const fileType = args.type as string;
    const headLimit = args.head_limit as number;
    const multiline = args.multiline as boolean;
    const offset = args.offset as number;
    const contextArg = args.context as number;

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
      const workdir = context.workdir;

      // If the session cwd was auto-recovered (e.g. the previous worktree
      // directory was removed manually via `git worktree remove`), surface
      // the notice in this tool's result so the model is aware of the switch.
      const cwdRecovery = context.aiManager?.consumeCwdRecovery?.();
      const rgArgs: string[] = [
        "--color=never",
        "--max-columns=500",
        // Search hidden files/directories by default (aligns with Claude Code).
        // --hidden does NOT disable .gitignore; only --no-ignore would.
        "--hidden",
      ];

      // Exclude VCS directories to avoid noise from version control metadata.
      // --hidden above would otherwise traverse .git/.svn/etc.
      for (const dir of VCS_DIRECTORIES) {
        rgArgs.push("--glob", `!${dir}`);
      }

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
        const effectiveContext = contextArg ?? contextAround;
        if (effectiveContext) {
          rgArgs.push("-C", effectiveContext.toString());
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

      // Add search pattern - use -e parameter to avoid patterns starting with - being mistaken as command line options
      rgArgs.push("-e", pattern);

      // Add search path
      if (searchPath) {
        rgArgs.push(searchPath);
      } else {
        rgArgs.push(".");
      }

      const result = await runCommand(rgPath, rgArgs, workdir);

      // Only a process-level spawn failure (exitCode null) is a hard error.
      // rg exit 2 means some files were unreadable (e.g. device-name files
      // like "nul" on Windows); stdout still holds usable partial results.
      if (result.exitCode === null) {
        return {
          success: false,
          content: "",
          error:
            `${cwdRecoveryNote(cwdRecovery)}ripgrep failed: ${result.stderr}`.trim(),
        };
      }

      if (result.exitCode !== 0 && result.exitCode !== 1) {
        logger.debug(
          `ripgrep exited with code ${result.exitCode}, keeping partial results: ${result.stderr.trim()}`,
        );
      }

      const output = result.stdout.trim();
      if (!output) {
        // Nothing matched is not an error: the renderer answers with CC's own
        // sentence for this mode ("No files found" / "No matches found" / the
        // "Found 0 total occurrences across 0 files." summary).
        const page = buildResultData(outputMode, [], undefined, 0, cwdRecovery);
        // `numMatches` 是短结果与宿主卡片用的匹配数（原来是
        // `ToolResult.metadata.numMatches`），一条都没命中就是 0。
        const data: GrepResultData = { ...page, numMatches: 0 };
        return {
          success: true,
          data,
          content: renderGrepResultData(data),
          shortResult: "No matches found",
        };
      }

      let lines = output.split("\n");
      const totalMatches = lines.length;

      // Apply offset
      const effectiveOffset = offset || 0;
      if (effectiveOffset > 0) {
        lines = lines.slice(effectiveOffset);
      }

      // Apply head_limit
      const effectiveHeadLimit = headLimit || 0;
      let truncated = false;
      if (effectiveHeadLimit > 0 && lines.length > effectiveHeadLimit) {
        lines = lines.slice(0, effectiveHeadLimit);
        truncated = true;
      }

      // Generate short result
      let shortResult: string;
      const numMatches = lines.length;

      if (outputMode === "files_with_matches") {
        shortResult = `Found ${numMatches} file${numMatches === 1 ? "" : "s"}`;
      } else if (outputMode === "count") {
        shortResult = `Match counts for ${numMatches} file${numMatches === 1 ? "" : "s"}`;
      } else {
        shortResult = `Found ${numMatches} matching line${numMatches === 1 ? "" : "s"}`;
      }

      if (effectiveOffset > 0 || truncated) {
        shortResult += ` (showing ${numMatches} of ${totalMatches})`;
      }

      const page = buildResultData(
        outputMode,
        lines,
        truncated ? effectiveHeadLimit : undefined,
        effectiveOffset,
        cwdRecovery,
      );
      // 短结果与宿主卡片用的匹配数与截断标记（原来是
      // `ToolResult.metadata.numMatches` / `.truncated`）；`appliedLimit` 与
      // `appliedOffset` 本来就在 `data` 里，不重复。`count` 模式的
      // `data.numMatches` 是各文件计数之和，不能被这里的行数盖掉。
      const data: GrepResultData =
        outputMode === "count"
          ? { ...page, truncated }
          : { ...page, numMatches: totalMatches, truncated };

      return {
        success: true,
        data,
        content: renderGrepResultData(data),
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
