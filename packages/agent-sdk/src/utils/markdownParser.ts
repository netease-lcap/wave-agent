import { readFileSync } from "fs";
import type { CustomSlashCommandConfig } from "../types/index.js";

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

export function parseBashCommands(content: string): {
  commands: string[];
  processedContent: string;
} {
  const bashCommandRegex = /!`([^`]+)`/g;
  const commands: string[] = [];
  let match;

  // Extract all bash commands
  while ((match = bashCommandRegex.exec(content)) !== null) {
    commands.push(match[1]);
  }

  // For now, return the content as-is. The actual command execution
  // will be handled by the slash command manager
  return {
    commands,
    processedContent: content,
  };
}

/**
 * Replace bash command placeholders with their outputs
 */
export function replaceBashCommandsWithOutput(
  content: string,
  results: BashCommandResult[],
): string {
  const bashCommandRegex = /!`([^`]+)`/g;
  let processedContent = content;
  let commandIndex = 0;

  processedContent = processedContent.replace(bashCommandRegex, (match) => {
    if (commandIndex < results.length) {
      const result = results[commandIndex++];
      return `\`\`\`\n$ ${result.command}\n${result.output}\n\`\`\``;
    }
    return match;
  });

  return processedContent;
}
