import { existsSync, readdirSync, statSync } from "fs";
import { join, extname, basename } from "path";
import { homedir } from "os";
import type { CustomSlashCommand } from "../types/index.js";
import { parseMarkdownFile } from "./markdownParser.js";
import { generateCommandId } from "./commandPathResolver.js";
import { logger } from "./globalLogger.js";

/**
 * Get the project-specific commands directory
 */
export function getProjectCommandsDir(workdir: string): string {
  return join(workdir, ".wave", "commands");
}

/**
 * Get the user-specific commands directory
 */
export function getUserCommandsDir(): string {
  return join(homedir(), ".wave", "commands");
}

/**
 * Scan a directory for markdown command files (flat structure only)
 * @param dirPath - Root commands directory path
 */
export function scanCommandsDirectory(dirPath: string): CustomSlashCommand[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  const commands: CustomSlashCommand[] = [];

  try {
    const entries = readdirSync(dirPath);

    for (const entryName of entries) {
      const fullPath = join(dirPath, entryName);

      try {
        const stats = statSync(fullPath);
        if (!stats.isFile() || extname(entryName) !== ".md") {
          continue;
        }

        // Process markdown file
        const commandId = generateCommandId(fullPath, dirPath);
        const { content, config } = parseMarkdownFile(fullPath);

        commands.push({
          id: commandId,
          name: basename(entryName, ".md"),
          description: config?.description,
          filePath: fullPath,
          content,
          config,
        });
      } catch (error) {
        logger.warn(`Failed to load custom command from ${fullPath}:`, error);
      }
    }
  } catch (error) {
    logger.warn(`Failed to scan commands directory ${dirPath}:`, error);
  }

  return commands;
}

/**
 * Load all custom slash commands from both project and user directories
 */
export function loadCustomSlashCommands(workdir: string): CustomSlashCommand[] {
  const projectCommands = scanCommandsDirectory(getProjectCommandsDir(workdir));
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
