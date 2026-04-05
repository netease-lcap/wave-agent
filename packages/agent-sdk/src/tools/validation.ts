/**
 * Validation helper utilities for tool plugins
 */

import type { ToolResult } from "./types.js";

/**
 * Creates a failed ToolResult with the given error message.
 * Use this to return validation errors from a plugin's validate method.
 *
 * @param message - The error message to display
 * @returns A ToolResult indicating failure with the error message
 */
export function validationError(message: string): ToolResult {
  return {
    success: false,
    content: "",
    error: message,
  };
}

/**
 * Validates that a required string parameter is present and non-empty.
 *
 * @param args - The tool arguments object
 * @param key - The key of the parameter to validate
 * @returns A ToolResult with an error if validation fails, or null if validation passes
 */
export function requireString(
  args: Record<string, unknown>,
  key: string,
): ToolResult | null {
  const value = args[key];

  if (value === undefined || value === null) {
    return validationError(`Missing required parameter: ${key}`);
  }

  if (typeof value !== "string") {
    return validationError(
      `Parameter ${key} must be a string, got ${typeof value}`,
    );
  }

  if (value.trim() === "") {
    return validationError(`Parameter ${key} cannot be empty`);
  }

  return null;
}
