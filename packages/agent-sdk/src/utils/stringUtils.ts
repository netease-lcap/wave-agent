/**
 * Remove code block wrappers
 * @param content Content that may contain code block wrappers
 * @returns Content after removing wrappers
 */
export function removeCodeBlockWrappers(content: string): string {
  // Remove code block wrappers from beginning and end
  // Supports the following formats:
  // ```language
  // code content
  // ```
  //
  // ```
  // code content
  // ```

  const lines = content.split("\n");
  let startIndex = 0;
  let endIndex = lines.length - 1;

  // Check if there is a code block marker at the beginning
  if (lines[startIndex]?.trim().startsWith("```")) {
    startIndex = 1;
  }

  // Check if there is a code block marker at the end
  if (lines[endIndex]?.trim() === "```") {
    endIndex = endIndex - 1;
  }

  // If no complete code block wrapper is found, return original content
  if (startIndex === 0 && endIndex === lines.length - 1) {
    return content;
  }

  // Return content after removing wrappers
  return lines.slice(startIndex, endIndex + 1).join("\n");
}

/**
 * Parse custom headers from a string (typically from environment variables)
 * Format: Key: Value, separated by newlines
 * @param headersString String containing headers
 * @returns Record of headers
 */
export function parseCustomHeaders(
  headersString: string,
): Record<string, string> {
  if (!headersString || typeof headersString !== "string") {
    return {};
  }

  const headers: Record<string, string> = {};
  const lines = headersString.split(/\r?\n/);

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine) continue;

    const colonIndex = trimmedLine.indexOf(":");
    if (colonIndex === -1) continue;

    const key = trimmedLine.slice(0, colonIndex).trim();
    const value = trimmedLine.slice(colonIndex + 1).trim();

    if (key) {
      headers[key] = value;
    }
  }

  return headers;
}

/**
 * Function to remove ANSI color codes
 * @param text Text containing ANSI color codes
 * @returns Plain text with color codes removed
 */
export const stripAnsiColors = (text: string): string => {
  // Create the escape character dynamically to avoid control character detection
  const escapeChar = String.fromCharCode(27); // ESC character
  const ansiEscapeRegex = new RegExp(`${escapeChar}\\[[0-9;]*[a-zA-Z]`, "g");
  return text.replace(ansiEscapeRegex, "");
};

/**
 * Format a line number prefix in cat -n style (padStart(6) + tab)
 * @param lineNumber The line number
 * @returns Formatted line number prefix
 */
export function formatLineNumberPrefix(lineNumber: number): string {
  return `${lineNumber.toString().padStart(6)}\t`;
}

/**
 * Efficiently get the last N lines of a string without splitting the whole string.
 */
export function getLastLines(text: string, count: number): string {
  if (!text || count <= 0) return "";
  let pos = text.length;
  let found = 0;
  while (pos > 0 && found < count) {
    const nextNewline = text.lastIndexOf("\n", pos - 1);
    if (nextNewline === -1) {
      pos = 0;
      break;
    } else {
      pos = nextNewline;
      found++;
    }
  }
  return text.substring(pos === 0 && found < count ? 0 : pos + 1);
}
