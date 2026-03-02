import { relative, basename } from "path";

/**
 * Command path resolver utilities for command discovery
 * Handles conversion between file paths and command IDs
 */

/**
 * Generate command ID from file path
 * @param filePath - Absolute path to markdown file
 * @param rootDir - Root commands directory path
 * @returns Command identifier string
 * @throws Error on invalid path structure
 */
export function generateCommandId(filePath: string, rootDir: string): string {
  // Handle null/undefined inputs
  if (filePath == null || rootDir == null) {
    throw new Error("File path and root directory must be provided");
  }

  // Handle empty root directory (for root level commands)
  const relativePath = rootDir === "" ? filePath : relative(rootDir, filePath);

  // Handle edge cases
  if (!relativePath || relativePath === ".") {
    throw new Error("Command filename cannot be empty");
  }

  const segments = relativePath.split("/").filter((segment) => segment !== "");

  // Remove .md extension from the last segment
  const lastSegment = segments[segments.length - 1];
  if (!lastSegment.endsWith(".md")) {
    throw new Error(`Command files must have .md extension`);
  }

  const commandName = basename(lastSegment, ".md");

  // Handle empty filename after removing extension
  if (commandName === "") {
    throw new Error("Command filename cannot be empty");
  }

  // Validate depth (no nesting allowed)
  if (segments.length > 1) {
    throw new Error(
      `Command nesting not supported: ${relativePath}. Commands must be in the root directory.`,
    );
  }

  // Validate command name
  if (!validateSegment(commandName)) {
    throw new Error(
      `Invalid command name: "${commandName}" in ${relativePath}. Must match pattern /^[a-zA-Z][a-zA-Z0-9_.-]*$/`,
    );
  }

  return commandName;
}

/**
 * Validate command ID format
 * @param commandId - Command identifier to validate
 * @returns Boolean indicating validity
 */
export function validateCommandId(commandId: string): boolean {
  // Handle null/undefined inputs
  if (commandId == null) {
    return false;
  }

  // Command ID must be a single segment (no colons)
  const pattern = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
  return pattern.test(commandId);
}

/**
 * Validate individual path segment
 * @param segment - Path segment to validate
 * @returns Boolean indicating validity
 */
function validateSegment(segment: string): boolean {
  // Segments should start with letters and can contain letters, numbers, dashes, underscores, dots
  const pattern = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;
  return pattern.test(segment);
}
