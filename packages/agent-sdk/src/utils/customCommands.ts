import { existsSync, readdirSync, statSync } from "fs";
import { join, extname, basename } from "path";
import { homedir } from "os";
import type { CustomSlashCommand } from "../types/index.js";
import { parseMarkdownFile } from "./markdownParser.js";
import {
  generateCommandId,
  getCommandSegments,
  getNamespace,
  getDepth,
} from "./commandPathResolver.js";

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
 * Scan a directory for markdown command files with nested directory support
 * @param dirPath - Root commands directory path
 * @param maxDepth - Maximum nesting depth to scan (default: 1)
 */
function scanCommandsDirectory(
  dirPath: string,
  maxDepth: number = 1,
): CustomSlashCommand[] {
  if (!existsSync(dirPath)) {
    return [];
  }

  return scanCommandsDirectoryRecursive(dirPath, dirPath, 0, maxDepth);
}

/**
 * Recursively scan directory for commands with depth control
 * @param currentPath - Current directory being scanned
 * @param rootPath - Root commands directory (for relative path calculation)
 * @param currentDepth - Current nesting depth
 * @param maxDepth - Maximum allowed depth
 */
function scanCommandsDirectoryRecursive(
  currentPath: string,
  rootPath: string,
  currentDepth: number,
  maxDepth: number,
): CustomSlashCommand[] {
  const commands: CustomSlashCommand[] = [];

  try {
    const entries = readdirSync(currentPath);

    for (const entryName of entries) {
      const fullPath = join(currentPath, entryName);

      let isDirectory = false;
      let isFile = false;

      try {
        const stats = statSync(fullPath);
        isDirectory = stats.isDirectory();
        isFile = stats.isFile();
      } catch (error) {
        // Skip entries that cannot be stat'd
        console.warn(`Cannot access ${fullPath}:`, error);
        continue;
      }

      if (isDirectory) {
        // Skip subdirectories if we're at max depth
        if (currentDepth >= maxDepth) {
          console.warn(
            `Skipping directory ${fullPath}: exceeds maximum nesting depth of ${maxDepth}`,
          );
          continue;
        }

        // Recursively scan subdirectory
        const nestedCommands = scanCommandsDirectoryRecursive(
          fullPath,
          rootPath,
          currentDepth + 1,
          maxDepth,
        );
        commands.push(...nestedCommands);
      } else if (isFile && extname(entryName) === ".md") {
        // Process markdown file
        try {
          const commandId = generateCommandId(fullPath, rootPath);
          const segments = getCommandSegments(fullPath, rootPath);
          const namespace = getNamespace(segments);
          const depth = getDepth(segments);

          const { content, config } = parseMarkdownFile(fullPath);

          commands.push({
            id: commandId,
            name: basename(entryName, ".md"),
            description: config?.description,
            filePath: fullPath,
            content,
            config,

            // Nested command metadata
            namespace,
            isNested: depth > 0,
            depth,
            segments,
          });
        } catch (error) {
          console.warn(
            `Failed to load custom command from ${fullPath}:`,
            error,
          );
        }
      }
      // Skip non-markdown files silently
    }
  } catch (error) {
    console.warn(`Failed to scan commands directory ${currentPath}:`, error);
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
