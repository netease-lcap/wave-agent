import { relative, basename } from "path";

/**
 * Command path resolver utilities for nested command discovery
 * Handles conversion between file paths and command IDs with colon syntax
 */

export interface CommandIdParts {
  namespace?: string; // e.g., "openspec" for "openspec:apply"
  commandName: string; // e.g., "apply" for "openspec:apply"
  isNested: boolean; // true if command has namespace
  depth: number; // 0 for root, 1 for nested
  segments: string[]; // Path components array
}

/**
 * Generate command ID from file path
 * @param filePath - Absolute path to markdown file
 * @param rootDir - Root commands directory path
 * @returns Command identifier string (e.g., "openspec:apply")
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

  segments[segments.length - 1] = basename(lastSegment, ".md");

  // Handle empty filename after removing extension
  if (segments[segments.length - 1] === "") {
    throw new Error("Command filename cannot be empty");
  }

  // Validate depth (max 1 level of nesting)
  if (segments.length > 2) {
    throw new Error(
      `Command nesting too deep: ${relativePath}. Maximum depth is 1 level.`,
    );
  }

  // Validate segments
  for (const segment of segments) {
    if (!validateSegment(segment)) {
      throw new Error(
        `Invalid command path segment: "${segment}" in ${relativePath}. Must match pattern /^[a-zA-Z][a-zA-Z0-9_.-]*$/`,
      );
    }
  }

  // Generate command ID
  if (segments.length === 1) {
    return segments[0]; // Flat command
  } else {
    return segments.join(":"); // Nested command with colon syntax
  }
}

/**
 * Parse command ID into components
 * @param commandId - Command identifier (e.g., "openspec:apply")
 * @returns Object with namespace and command name
 * @throws Error on malformed command ID
 */
export function parseCommandId(commandId: string): CommandIdParts {
  // Handle null/undefined inputs
  if (commandId == null) {
    throw new Error("Command ID cannot be null or undefined");
  }

  if (commandId === "") {
    throw new Error("Command ID cannot be empty");
  }

  if (!validateCommandId(commandId)) {
    throw new Error(
      `Invalid command ID format: "${commandId}". Must match pattern /^[a-zA-Z0-9_-]+(?::[a-zA-Z0-9_-]+)?$/`,
    );
  }

  const parts = commandId.split(":");

  if (parts.length === 1) {
    // Flat command
    return {
      namespace: undefined,
      commandName: parts[0],
      isNested: false,
      depth: 0,
      segments: [parts[0]],
    };
  } else if (parts.length === 2) {
    // Nested command
    return {
      namespace: parts[0],
      commandName: parts[1],
      isNested: true,
      depth: 1,
      segments: [parts[0], parts[1]],
    };
  } else {
    throw new Error(
      `Invalid command ID format: "${commandId}". Too many colon separators.`,
    );
  }
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

  // Command ID can have multiple colons (though generateCommandId enforces max 1 level)
  // This validates the format but doesn't enforce depth limits
  const pattern = /^[a-zA-Z][a-zA-Z0-9_-]*(?::[a-zA-Z][a-zA-Z0-9_-]*)*$/;
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

/**
 * Convert file path to command segments array
 * @param filePath - Absolute path to markdown file
 * @param rootDir - Root commands directory path
 * @returns Array of path segments
 */
export function getCommandSegments(
  filePath: string,
  rootDir: string,
): string[] {
  const relativePath = relative(rootDir, filePath);
  const segments = relativePath.split("/").filter((segment) => segment !== "");

  // Remove .md extension from the last segment
  const lastSegment = segments[segments.length - 1];
  segments[segments.length - 1] = basename(lastSegment, ".md");

  return segments;
}

/**
 * Get namespace from command segments
 * @param segments - Command path segments
 * @returns Namespace string or undefined for flat commands
 */
export function getNamespace(segments: string[]): string | undefined {
  return segments.length > 1 ? segments[0] : undefined;
}

/**
 * Get command depth from segments
 * @param segments - Command path segments
 * @returns Depth number (0 for root, 1 for nested)
 */
export function getDepth(segments: string[]): number {
  return Math.max(0, segments.length - 1);
}
