/**
 * Utility functions for file editing tools
 */

/**
 * Escape regular expression special characters
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Returns a generic error message when old_string is not found.
 */
export function analyzeEditMismatch(): string {
  return "old_string not found in file";
}
