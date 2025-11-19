/**
 * Streaming Utilities for Real-Time Content Updates
 *
 * This module provides utilities for handling streaming content from OpenAI API,
 * including incomplete JSON parsing for tool parameters and content accumulation.
 */

/**
 * Extract complete parameters from incomplete JSON string
 * @param incompleteJson Incomplete JSON string from streaming
 * @returns Valid JSON object containing complete parameters
 */
export function extractCompleteParams(
  incompleteJson: string,
): Record<string, string | number | boolean | null> {
  if (!incompleteJson || typeof incompleteJson !== "string") {
    return {};
  }

  const result: Record<string, string | number | boolean | null> = {};

  // Match complete string parameters: "key": "value" (handle escaped quotes)
  const completeStringPattern = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let match;

  while ((match = completeStringPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    let value = match[2];
    // Handle escaped characters
    value = value
      .replace(/\\"/g, '"')
      .replace(/\\n/g, "\n")
      .replace(/\\\\/g, "\\");
    result[key] = value;
  }

  // Match incomplete string parameters: "key": "value (without closing quote)
  // This supports streaming scenarios where strings are being built incrementally
  const incompleteStringPattern = /"([^"]+)"\s*:\s*"([^"]*)$/gm;
  while ((match = incompleteStringPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    let value = match[2];
    // Only add if not already captured as complete string
    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      // Handle escaped characters
      value = value
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\\\/g, "\\");
      result[key] = value;
    }
  }

  // Match complete number parameters: "key": 123 or "key": 123.45 or "key": 1.5e10
  const numberPattern =
    /"([^"]+)"\s*:\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)(?=\s*[,}\]\s]|$)/g;
  while ((match = numberPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    const value = parseFloat(match[2]);
    result[key] = value;
  }

  // Match complete boolean parameters: "key": true or "key": false
  const boolPattern = /"([^"]+)"\s*:\s*(true|false)(?=\s*[,}\]\s]|$)/g;
  while ((match = boolPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    const value = match[2] === "true";
    result[key] = value;
  }

  // Match complete null parameters: "key": null
  const nullPattern = /"([^"]+)"\s*:\s*null(?=\s*[,}\]\s]|$)/g;
  while ((match = nullPattern.exec(incompleteJson)) !== null) {
    const key = match[1];
    result[key] = null;
  }

  return result;
}

/**
 * Get the keys of completed parameters from incomplete JSON string
 * @param incompleteJson Incomplete JSON string from streaming
 * @returns Array of keys for completed parameters
 */
export function getCompletedKeys(incompleteJson: string): string[] {
  return Object.keys(extractCompleteParams(incompleteJson));
}
