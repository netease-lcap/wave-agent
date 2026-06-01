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
 * Returns an error message when old_string is not found, including
 * the attempted string to help the model self-correct on retry.
 */
export function analyzeEditMismatch(oldString: string): string {
  const displayString =
    oldString.length > 200 ? oldString.substring(0, 200) + "..." : oldString;
  return `String to replace not found in file.\nString: ${displayString}`;
}
