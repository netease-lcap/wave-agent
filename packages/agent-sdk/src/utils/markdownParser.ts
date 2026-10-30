import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import type { CustomSlashCommandConfig } from "../types/index.js";
import {
  SKILL_BASH_MAX_OUTPUT_CHARS,
  PREVIEW_SIZE_BYTES,
} from "../constants/toolLimits.js";
import { logger } from "./globalLogger.js";
import { parseFrontmatterYaml, splitFrontmatter } from "./frontmatterYaml.js";
import { resolveShellPath } from "./shellResolver.js";
import { resolveTempDir } from "./tempDir.js";

const execAsync = promisify(exec);

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
export function parseFrontmatter(content: string): {
  frontmatter?: Record<string, unknown>;
  content: string;
} {
  const { yaml, body } = splitFrontmatter(content);

  if (yaml === null) {
    return { content };
  }

  return { frontmatter: parseFrontmatterYaml(yaml), content: body };
}

/**
 * Parse markdown file and extract config and content
 */
export function parseMarkdownFile(filePath: string): ParsedMarkdownFile {
  try {
    const fileContent = readFileSync(filePath, "utf-8");
    const { frontmatter, content } = parseFrontmatter(fileContent);

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
  if (output.length <= SKILL_BASH_MAX_OUTPUT_CHARS) {
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
 * Placeholder that hands an injected command its invocation arguments as a
 * **file** instead of as shell text (spec `ecosystem/agent-skills`「注入命令的
 * 参数不经 shell 传递」).
 *
 * `$ARGUMENTS` stays the model-facing channel. This one exists because `!`
 * commands run through a real shell: an argument carrying `>`, `&&`, a backtick
 * or a newline changes how that shell parses the command, and no escaping
 * inside a template fixes it for the author — the pushed-in string decides the
 * command's structure. A path is a single inert argv word, so the command reads
 * the same no matter what the user typed.
 */
export const ARGUMENTS_FILE_TOKEN = "${WAVE_ARGUMENTS_FILE}";

export interface PreparedInjectedCommands {
  /** The `!` commands with the token resolved to the file's absolute path. */
  commands: string[];
  /**
   * Delete the temp file. Safe to call unconditionally and never throws; call
   * it from a `finally` so a denied or aborted invocation leaves nothing behind.
   */
  cleanup: () => void;
  /** Author error to surface: the token survived outside the injected commands. */
  warning?: string;
}

/**
 * Resolve {@link ARGUMENTS_FILE_TOKEN} in the `!` commands of one invocation.
 *
 * The file is created only when a command actually asks for it, and it is
 * created even when the user passed no arguments — an empty file lets the
 * author's script read one path unconditionally instead of branching.
 */
export function prepareInjectedCommands(
  content: string,
  commands: string[],
  argsString = "",
): PreparedInjectedCommands {
  const warning = argumentsFileTokenInProse(content)
    ? `${ARGUMENTS_FILE_TOKEN} only works inside an injected command (\`!\`cmd\`\`) — ` +
      `it is left as written here, where no command runs and no file is created`
    : undefined;

  if (!commands.some((command) => command.includes(ARGUMENTS_FILE_TOKEN))) {
    return { commands, cleanup: () => {}, warning };
  }

  const dir = resolveTempDir();
  mkdirSync(dir, { recursive: true });
  const filePath = join(
    dir,
    `wave-args-${Date.now()}-${Math.random().toString(36).slice(2, 9)}.txt`,
  );
  // 0600: the arguments are exactly what the user typed, nobody else's business.
  writeFileSync(filePath, argsString, { encoding: "utf-8", mode: 0o600 });

  return {
    commands: commands.map((command) =>
      command.split(ARGUMENTS_FILE_TOKEN).join(filePath),
    ),
    cleanup: () => {
      try {
        rmSync(filePath, { force: true });
      } catch (error) {
        logger.warn(`Failed to remove injected-command arguments file:`, error);
      }
    },
    warning,
  };
}

/** Whether the token appears anywhere outside a `!` command (i.e. in the prose). */
function argumentsFileTokenInProse(content: string): boolean {
  if (!content.includes(ARGUMENTS_FILE_TOKEN)) {
    return false;
  }
  const prose = content
    .replace(BLOCK_BASH_REGEX, "")
    .replace(INLINE_BASH_REGEX, "");
  return prose.includes(ARGUMENTS_FILE_TOKEN);
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
    // Judge the command as written, before the Windows fallback rewrites it
    // into a `chcp 65001 && …` wrapper.
    if (gate) {
      const decision = await gate.check(originalCommand, workdir);
      if (decision.behavior === "deny") {
        throw new BashCommandPermissionError(originalCommand, decision.message);
      }
    }

    let command = originalCommand;
    const execOptions: { cwd: string; timeout: number; shell?: string } = {
      cwd: workdir,
      timeout,
    };

    // Skill templates (e.g. !`gh pr view ... 2>/dev/null || echo '{}'`) use
    // bash-only syntax. On Windows, child_process.exec defaults to cmd.exe,
    // where `/dev/null` fails with a localized "path not found" error whose
    // GBK bytes get mis-decoded as UTF-8 (mojibake). Run through Git Bash
    // when available (same contract as the bash tool); otherwise force the
    // UTF-8 codepage so cmd's own messages decode correctly.
    if (process.platform === "win32") {
      const bashPath = resolveShellPath();
      if (bashPath) {
        execOptions.shell = bashPath;
      } else {
        command = `chcp 65001 >NUL && ${command}`;
      }
    }

    try {
      const { stdout, stderr } = await execAsync(command, execOptions);
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
