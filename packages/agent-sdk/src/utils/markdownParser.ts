import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { join } from "path";
import { tmpdir } from "os";
import type { CustomSlashCommandConfig } from "../types/index.js";
import {
  SKILL_BASH_MAX_OUTPUT_CHARS,
  PREVIEW_SIZE_BYTES,
} from "../constants/toolLimits.js";

const execAsync = promisify(exec);

interface ParsedMarkdownFile {
  content: string;
  config?: CustomSlashCommandConfig;
}

/**
 * Parse YAML frontmatter from markdown content
 */
export function parseFrontmatter(content: string): {
  frontmatter?: Record<string, unknown>;
  content: string;
} {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/;
  const match = content.match(frontmatterRegex);

  if (!match) {
    return { content };
  }

  const [, frontmatterStr, bodyContent] = match;

  try {
    // Simple YAML parser for our use case (supports key: value and list items)
    const frontmatter: Record<string, unknown> = {};
    const lines = frontmatterStr.split("\n");
    let currentKey: string | null = null;

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) continue;

      // Check if it's a list item
      if (trimmedLine.startsWith("-") && currentKey) {
        let value = trimmedLine.slice(1).trim();
        if (value) {
          // Remove surrounding quotes if present
          if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
          ) {
            value = value.slice(1, -1);
          }
          if (!Array.isArray(frontmatter[currentKey])) {
            frontmatter[currentKey] = [];
          }
          (frontmatter[currentKey] as unknown[]).push(value);
        }
        continue;
      }

      const colonIndex = trimmedLine.indexOf(":");
      if (colonIndex === -1) continue;

      const key = trimmedLine.slice(0, colonIndex).trim();
      const value = trimmedLine.slice(colonIndex + 1).trim();

      currentKey = key;
      if (value) {
        // Remove surrounding quotes if present
        const unquotedValue =
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
            ? value.slice(1, -1)
            : value;
        frontmatter[key] = unquotedValue;
      }
    }

    return { frontmatter, content: bodyContent };
  } catch {
    // If parsing fails, just return the content without frontmatter
    return { content };
  }
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
 */
const INLINE_BASH_REGEX = /!`([^`]+)`/g;

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
      return truncateOutput(result.output);
    }
    return "";
  });

  // Replace inline syntax: !`command`
  processedContent = processedContent.replace(INLINE_BASH_REGEX, () => {
    if (commandIndex < results.length) {
      const result = results[commandIndex++];
      return truncateOutput(result.output);
    }
    return "";
  });

  return processedContent;
}

/**
 * Execute bash commands and return results
 */
export async function executeBashCommands(
  commands: string[],
  workdir: string,
  timeout: number = 30000,
): Promise<BashCommandResult[]> {
  const results: BashCommandResult[] = [];

  for (const command of commands) {
    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: workdir,
        timeout,
      });
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
      results.push({
        command,
        output: (
          (execError.stdout || "") +
          (execError.stderr || "") +
          (execError.message || "")
        ).trim(),
        exitCode: execError.code || 1,
      });
    }
  }

  return results;
}
