/**
 * Command Argument Parser
 *
 * Provides parameter substitution for custom slash commands similar to Claude's system:
 * - $ARGUMENTS: All arguments as a single string
 * - $1, $2, $3, etc.: Individual positional arguments
 * - Supports quoted arguments with spaces
 * - Handles escaped quotes within arguments
 */

/**
 * Parse command arguments from a string, respecting quotes
 */
export function parseCommandArguments(argsString: string): string[] {
  if (!argsString.trim()) {
    return [];
  }

  const args: string[] = [];
  let current = "";
  let inQuotes = false;
  let quoteChar = "";
  let escaped = false;

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];
    const nextChar = argsString[i + 1];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      // Handle escape sequences
      if (inQuotes && (nextChar === quoteChar || nextChar === "\\")) {
        escaped = true;
        continue;
      }
      current += char;
      continue;
    }

    if (!inQuotes && (char === '"' || char === "'")) {
      // Start quoted string
      inQuotes = true;
      quoteChar = char;
      continue;
    }

    if (inQuotes && char === quoteChar) {
      // End quoted string
      inQuotes = false;
      quoteChar = "";
      continue;
    }

    if (!inQuotes && /\s/.test(char)) {
      // Whitespace outside quotes - end current argument
      if (current) {
        args.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  // Add final argument if any
  if (current) {
    args.push(current);
  }

  return args;
}

/**
 * Substitute command parameters in content
 */
export function substituteCommandParameters(
  content: string,
  argsString: string,
): string {
  const args = parseCommandArguments(argsString);

  let result = content;

  // Replace $ARGUMENTS with all arguments
  result = result.replace(/\$ARGUMENTS/g, argsString);

  // Replace positional parameters $1, $2, etc.
  // Sort by parameter number (descending) to avoid replacing $10 with $1 + "0"
  const positionalParams = [...result.matchAll(/\$(\d+)/g)]
    .map((match) => parseInt(match[1], 10))
    .filter((value, index, array) => array.indexOf(value) === index) // unique
    .sort((a, b) => b - a); // descending order

  for (const paramNum of positionalParams) {
    const paramValue = args[paramNum - 1] || ""; // Arrays are 0-indexed, params are 1-indexed
    const paramRegex = new RegExp(`\\$${paramNum}`, "g");
    result = result.replace(paramRegex, paramValue);
  }

  return result;
}

/**
 * Extract command name and arguments from a slash command input
 * Example: "/fix-issue 123 high-priority" -> { command: "fix-issue", args: "123 high-priority" }
 */
export function parseSlashCommandInput(input: string): {
  command: string;
  args: string;
} {
  const trimmed = input.trim();

  if (!trimmed.startsWith("/")) {
    throw new Error("Input must start with /");
  }

  const withoutSlash = trimmed.substring(1);
  const firstSpaceIndex = withoutSlash.indexOf(" ");

  if (firstSpaceIndex === -1) {
    // No arguments
    return {
      command: withoutSlash,
      args: "",
    };
  }

  return {
    command: withoutSlash.substring(0, firstSpaceIndex),
    args: withoutSlash.substring(firstSpaceIndex + 1).trim(),
  };
}

/**
 * Check if content contains parameter placeholders
 */
export function hasParameterPlaceholders(content: string): boolean {
  return /\$(?:ARGUMENTS|\d+)/.test(content);
}

/**
 * Get all parameter placeholders used in content
 */
export function getUsedParameterPlaceholders(content: string): string[] {
  const matches = content.match(/\$(?:ARGUMENTS|\d+)/g);
  return matches ? [...new Set(matches)] : [];
}
