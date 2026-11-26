import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import type { CustomSlashCommandConfig } from "../types/index.js";
import {
  SKILL_BASH_MAX_OUTPUT_BYTES,
  PREVIEW_SIZE_BYTES,
} from "../constants/toolLimits.js";
import { exceedsUtf8Bytes } from "./utf8Bytes.js";
import { logger } from "./globalLogger.js";
import { execFileAsyncHidden } from "./execFileHidden.js";
import { parseFrontmatterYaml, splitFrontmatter } from "./frontmatterYaml.js";
import { resolveSessionShell } from "./shell/shellToolGate.js";
import { POWERSHELL_SPAWN_FLAGS } from "./shell/powershellProvider.js";

interface ParsedMarkdownFile {
  content: string;
  config?: CustomSlashCommandConfig;
}

/**
 * Parse YAML frontmatter from markdown content.
 *
 * Value parsing is shared with skills, subagents and memory files — see
 * `frontmatterYaml.ts` (spec `ui/slash-commands` 场景 3,
 * `core/memory-management` 场景 4/13).
 */
export function parseFrontmatter(
  content: string,
  sourcePath?: string,
): {
  frontmatter?: Record<string, unknown>;
  content: string;
} {
  const { yaml, body } = splitFrontmatter(content);

  if (yaml === null) {
    return { content };
  }

  // `sourcePath` only reaches the log line: a memory rule whose frontmatter does
  // not parse loses its `paths` scope and is then applied to every file, which is
  // exactly the kind of silent widening the file name has to make traceable.
  return {
    frontmatter: parseFrontmatterYaml(yaml, sourcePath),
    content: body,
  };
}

/**
 * Parse markdown file and extract config and content
 */
export function parseMarkdownFile(filePath: string): ParsedMarkdownFile {
  try {
    const fileContent = readFileSync(filePath, "utf-8");
    const { frontmatter, content } = parseFrontmatter(fileContent, filePath);

    let config: CustomSlashCommandConfig | undefined;

    if (frontmatter) {
      config = {};

      if (frontmatter.model && typeof frontmatter.model === "string") {
        config.model = frontmatter.model;
      }

      if (
        frontmatter.description &&
        typeof frontmatter.description === "string"
      ) {
        config.description = frontmatter.description;
      }

      if (frontmatter["allowed-tools"]) {
        if (Array.isArray(frontmatter["allowed-tools"])) {
          config.allowedTools = frontmatter["allowed-tools"].filter(
            (item): item is string => typeof item === "string",
          );
        } else if (typeof frontmatter["allowed-tools"] === "string") {
          config.allowedTools = frontmatter["allowed-tools"]
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s.length > 0);
        }
      }

      // `argument-hint` 是 UI 文案（`[path]`、`<file>`），原样保留：修掉首尾空白即可，
      // 不做大小写或括号规范化，作者写什么菜单下就显示什么。
      const argumentHint = frontmatter["argument-hint"];
      if (typeof argumentHint === "string" && argumentHint.trim()) {
        config.argumentHint = argumentHint.trim();
      }
    }

    return {
      content: content.trim(),
      config,
    };
  } catch (error) {
    throw new Error(
      `Failed to parse markdown file ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Parse and execute bash commands in markdown content
 */
export interface BashCommandResult {
  command: string;
  output: string;
  exitCode: number;
}

/**
 * Block syntax pattern: ```! command ```
 */
const BLOCK_BASH_REGEX = /```!\s*\n?([\s\S]*?)\n?```/g;

/**
 * Inline syntax pattern: !`command`
 *
 * The lookbehind requires start-of-line or whitespace before the `!`, matching
 * Claude Code's `INLINE_PATTERN` (`promptShellExecution.ts`). Without it a
 * document that merely mentions an error code in a code span — `` `#REF!`: `` —
 * parses as an injected command, and since a denied injected command aborts the
 * whole skill, prose would break the skill rather than be ignored.
 */
const INLINE_BASH_REGEX = /(?<=^|\s)!`([^`]+)`/gm;

export function parseBashCommands(content: string): {
  commands: string[];
  processedContent: string;
} {
  // Performance gate: skip expensive regex if no bash pattern exists
  // Covers the common case where 93% of skills have no bash substitution
  if (!content.includes("!`") && !content.includes("```!")) {
    return { commands: [], processedContent: content };
  }

  const commands: string[] = [];

  // Extract block commands
  let blockMatch;
  const blockRegex = new RegExp(
    BLOCK_BASH_REGEX.source,
    BLOCK_BASH_REGEX.flags,
  );
  while ((blockMatch = blockRegex.exec(content)) !== null) {
    const cmd = blockMatch[1].trim();
    if (cmd) {
      commands.push(cmd);
    }
  }

  // Extract inline commands
  let inlineMatch;
  const inlineRegex = new RegExp(
    INLINE_BASH_REGEX.source,
    INLINE_BASH_REGEX.flags,
  );
  while ((inlineMatch = inlineRegex.exec(content)) !== null) {
    const cmd = inlineMatch[1].trim();
    if (cmd) {
      commands.push(cmd);
    }
  }

  // For now, return the content as-is. The actual command execution
  // will be handled by the slash command manager
  return {
    commands,
    processedContent: content,
  };
}

/**
 * Truncate output if it exceeds the size limit.
 * Writes to a temp file and returns a preview + file path if truncated.
 */
export function truncateOutput(output: string): string {
  if (!exceedsUtf8Bytes(output, SKILL_BASH_MAX_OUTPUT_BYTES)) {
    return output;
  }

  const preview = output.slice(0, PREVIEW_SIZE_BYTES);
  const tempDir = join(tmpdir(), "wave-skill-bash");
  mkdirSync(tempDir, { recursive: true });

  const tempFile = join(
    tempDir,
    `output-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.txt`,
  );
  writeFileSync(tempFile, output, "utf-8");

  return `${preview}\n\n[Output truncated (${output.length} chars). Full output saved to: ${tempFile}]`;
}

/**
 * Format a bash command result for inclusion in skill content.
 * Failed commands (non-zero exit code) are wrapped with an error indicator.
 */
function formatBashResult(result: BashCommandResult): string {
  const output = truncateOutput(result.output);
  if (result.exitCode !== 0) {
    return `<error>Command failed (exit code ${result.exitCode}): ${output}</error>`;
  }
  return output;
}

/**
 * Replace bash command placeholders with their outputs.
 * Uses function replacer to avoid $$, $&, $' corruption in shell output.
 * Handles both inline (!`cmd`) and block (```! cmd ```) syntax.
 */
export function replaceBashCommandsWithOutput(
  content: string,
  results: BashCommandResult[],
): string {
  let processedContent = content;
  let commandIndex = 0;

  // Replace block syntax first: ```! command ```
  processedContent = processedContent.replace(BLOCK_BASH_REGEX, () => {
    if (commandIndex < results.length) {
      const result = results[commandIndex++];
      return formatBashResult(result);
    }
    return "";
  });

  // Replace inline syntax: !`command`
  processedContent = processedContent.replace(INLINE_BASH_REGEX, () => {
    if (commandIndex < results.length) {
      const result = results[commandIndex++];
      return formatBashResult(result);
    }
    return "";
  });

  return processedContent;
}

/**
 * Gate consulted before an injected command runs.
 *
 * Deliberately a structural interface instead of an import of
 * `PermissionManager`: this module must stay free of SDK-internal imports so it
 * keeps zero import-time side effects (SDK surface rules, see AGENTS.md).
 * Callers (skill / custom-command loading) inject an implementation that
 * delegates to the very same `PermissionManager` the Bash tool uses, so both
 * paths judge by one rule set.
 */
export interface BashCommandGate {
  check(
    command: string,
    workdir: string,
  ): Promise<{ behavior: "allow" } | { behavior: "deny"; message?: string }>;
}

/**
 * Thrown when an injected command is denied. Aborts the whole skill / command
 * invocation so the body never reaches the model, and carries the user-facing
 * text (spec `ecosystem/agent-skills` / 注入命令执行前的权限校验).
 */
export class BashCommandPermissionError extends Error {
  constructor(
    public readonly command: string,
    public readonly reason?: string,
  ) {
    super(
      `Shell command permission check failed for pattern "${command}": ${
        reason || "Permission denied"
      }`,
    );
    this.name = "BashCommandPermissionError";
  }
}

/**
 * Execute bash commands and return results
 */
export async function executeBashCommands(
  commands: string[],
  workdir: string,
  timeout: number = 30000,
  gate?: BashCommandGate,
): Promise<BashCommandResult[]> {
  const results: BashCommandResult[] = [];

  for (const originalCommand of commands) {
    if (gate) {
      const decision = await gate.check(originalCommand, workdir);
      if (decision.behavior === "deny") {
        throw new BashCommandPermissionError(originalCommand, decision.message);
      }
    }

    const command = originalCommand;

    // Skill templates (e.g. !`gh pr view ... 2>/dev/null || echo '{}'`) are
    // written in bash: `2>/dev/null`, `&&`, `$VAR`. cmd.exe mis-parses all of
    // them, and its localized "path not found" message for `/dev/null` arrives
    // as mojibake (GBK bytes decoded as UTF-8). The command therefore runs in
    // the session's own shell — the same decision that runs hooks and registered
    // the shell tool (`utils/shell/shellToolGate.ts`). A machine with neither
    // shell says so instead of silently degrading to cmd.exe.
    const sessionShell = resolveSessionShell(workdir);
    if ("problem" in sessionShell) {
      throw new Error(sessionShell.problem);
    }
    const spawnArgs =
      sessionShell.kind === "bash"
        ? // Passed through unchanged, as before: a skill author writes a bash
          // command and already writes it in POSIX form.
          ["-c", command]
        : [...POWERSHELL_SPAWN_FLAGS, command];

    try {
      // argv form, not `exec`: the shell is chosen explicitly (bash `-c` /
      // PowerShell `-Command`), so the command never reaches cmd.exe's parser.
      // The wrapper forces `windowsHide` — the desktop main process has no
      // console, so without it every skill-injected command allocates a visible
      // console window.
      const { stdout, stderr } = await execFileAsyncHidden(
        sessionShell.shellPath,
        spawnArgs,
        { cwd: workdir, timeout },
      );
      results.push({
        command,
        output: (stdout + (stderr || "")).trim(),
        exitCode: 0,
      });
    } catch (error: unknown) {
      const execError = error as {
        stdout?: string;
        stderr?: string;
        message?: string;
        code?: number;
      };
      const errorOutput = (
        (execError.stdout || "") +
        (execError.stderr || "") +
        (execError.message || "")
      ).trim();
      const exitCode = execError.code || 1;
      logger?.warn(
        `[Skill bash] Command failed (exit code ${exitCode}): ${command}\n${errorOutput}`,
      );
      results.push({
        command,
        output: errorOutput,
        exitCode,
      });
    }
  }

  return results;
}
