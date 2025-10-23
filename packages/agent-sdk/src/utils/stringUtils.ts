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
