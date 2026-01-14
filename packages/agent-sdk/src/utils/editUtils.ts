/**
 * Utility functions for file editing tools
 */

/**
 * Find a match in content that is identical to searchString except for a consistent indentation offset.
 *
 * Priority:
 * 1. If exact matches exist, returns searchString (letting the tool handle uniqueness/replaceAll).
 * 2. If no exact match, but exactly one unique indentation-insensitive match exists, returns that match.
 * 3. Otherwise returns null.
 */
export function findIndentationInsensitiveMatch(
  content: string,
  searchString: string,
): string | null {
  // 1. If exact match exists, return it
  if (content.includes(searchString)) {
    return searchString;
  }

  const searchLines = searchString.split("\n");
  if (searchLines.length === 0) return null;

  const contentLines = content.split("\n");
  let foundMatch: string | null = null;

  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let offset: number | null = null;
    let isMatch = true;

    for (let j = 0; j < searchLines.length; j++) {
      const sLine = searchLines[j];
      const cLine = contentLines[i + j];

      const sTrimmed = sLine.trimStart();
      const cTrimmed = cLine.trimStart();

      // If trimmed content doesn't match, it's not a match
      if (sTrimmed !== cTrimmed) {
        isMatch = false;
        break;
      }

      // For non-empty lines, check for consistent indentation offset
      if (sTrimmed !== "") {
        const sIndent = sLine.length - sTrimmed.length;
        const cIndent = cLine.length - cTrimmed.length;
        const currentOffset = cIndent - sIndent;

        if (offset === null) {
          offset = currentOffset;
        } else if (offset !== currentOffset) {
          isMatch = false;
          break;
        }
      }
    }

    if (isMatch) {
      const matchCandidate = contentLines
        .slice(i, i + searchLines.length)
        .join("\n");
      if (foundMatch !== null && foundMatch !== matchCandidate) {
        // Multiple different smart matches found
        return null;
      }
      foundMatch = matchCandidate;
    }
  }

  // If we found exactly one unique smart match (or multiple instances of the same smart match)
  // return it. The tool will then check for uniqueness if replaceAll is false.
  return foundMatch;
}

/**
 * Escape regular expression special characters
 */
export function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
