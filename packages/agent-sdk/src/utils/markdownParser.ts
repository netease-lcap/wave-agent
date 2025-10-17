import { readFileSync } from "fs";
import type { CustomSlashCommandConfig } from "../types.js";

interface ParsedMarkdownFile {
  content: string;
  config?: CustomSlashCommandConfig;
}

/**
 * Parse YAML frontmatter from markdown content
 */
function parseFrontmatter(content: string): {
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
    // Simple YAML parser for our use case (only supports key: value pairs)
    const frontmatter: Record<string, unknown> = {};
    const lines = frontmatterStr.split("\n");

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#")) continue;

      const colonIndex = trimmedLine.indexOf(":");
      if (colonIndex === -1) continue;

      const key = trimmedLine.slice(0, colonIndex).trim();
      const value = trimmedLine.slice(colonIndex + 1).trim();

      // Handle array values for allowed-tools
      if (key === "allowed-tools" && value) {
        // Simple array parsing: "tool1, tool2, tool3" or "[tool1, tool2]"
        let arrayValue = value;
        if (arrayValue.startsWith("[") && arrayValue.endsWith("]")) {
          arrayValue = arrayValue.slice(1, -1);
        }
        frontmatter[key] = arrayValue
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      } else if (value) {
        frontmatter[key] = value;
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

      if (
        frontmatter["allowed-tools"] &&
        Array.isArray(frontmatter["allowed-tools"])
      ) {
        config.allowedTools = frontmatter["allowed-tools"] as string[];
      }

      if (frontmatter.model && typeof frontmatter.model === "string") {
        config.model = frontmatter.model;
      }

      if (
        frontmatter.description &&
        typeof frontmatter.description === "string"
      ) {
        config.description = frontmatter.description;
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
