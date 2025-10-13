import { existsSync, readdirSync } from "fs";
import { join, extname, basename } from "path";
import { homedir } from "os";
import type { CustomSlashCommand } from "../types.js";
import { parseMarkdownFile } from "./markdownParser.js";

/**
 * Get the project-specific commands directory
 */
export function getProjectCommandsDir(): string {
  return join(process.cwd(), ".wave", "commands");
}

/**
 * Get the user-specific commands directory
 */
export function getUserCommandsDir(): string {
  return join(homedir(), ".wave", "commands");
}

/**
 * Scan a directory for markdown command files
 */
function scanCommandsDirectory(dirPath: string): CustomSlashCommand[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const commands: CustomSlashCommand[] = [];

  try {
    const files = readdirSync(dirPath);

    for (const file of files) {
      if (extname(file) !== ".md") {
        continue;
      }

      const filePath = join(dirPath, file);
      const commandName = basename(file, ".md");

      try {
        const { content, config } = parseMarkdownFile(filePath);

        commands.push({
          id: commandName,
          name: commandName,
          filePath,
          content,
          config,
        });
      } catch (error) {
        console.warn(`Failed to load custom command from ${filePath}:`, error);
      }
    }
  } catch (error) {
    console.warn(`Failed to scan commands directory ${dirPath}:`, error);
  }

  return commands;
}

/**
 * Load all custom slash commands from both project and user directories
 */
export function loadCustomSlashCommands(): CustomSlashCommand[] {
  const projectCommands = scanCommandsDirectory(getProjectCommandsDir());
  const userCommands = scanCommandsDirectory(getUserCommandsDir());

  // Project commands take precedence over user commands with the same name
  const commandMap = new Map<string, CustomSlashCommand>();

  // Add user commands first
  for (const command of userCommands) {
    commandMap.set(command.id, command);
  }

  // Add project commands (will overwrite user commands with same name)
  for (const command of projectCommands) {
    commandMap.set(command.id, command);
  }

  return Array.from(commandMap.values());
}
