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
 * Analyze why an edit failed by finding the best partial match and highlighting mismatches.
 */
export function analyzeEditMismatch(
  content: string,
  searchString: string,
): string {
  const contentLines = content.split("\n");
  const searchLines = searchString.split("\n");

  if (searchLines.length === 0 || contentLines.length === 0) {
    return "old_string not found in file (empty search or content)";
  }

  let bestMatchIndex = -1;
  let bestMatchScore = -1;

  // Sliding window to find the best partial match
  for (let i = 0; i <= contentLines.length - searchLines.length; i++) {
    let currentScore = 0;
    for (let j = 0; j < searchLines.length; j++) {
      if (contentLines[i + j] === searchLines[j]) {
        currentScore++;
      }
    }

    // Heuristic: prioritize matches where first or last lines match
    if (contentLines[i] === searchLines[0]) currentScore += 0.5;
    if (
      contentLines[i + searchLines.length - 1] ===
      searchLines[searchLines.length - 1]
    )
      currentScore += 0.5;

    // Also consider trimmed matches to catch indentation issues
    for (let j = 0; j < searchLines.length; j++) {
      if (
        contentLines[i + j].trim() === searchLines[j].trim() &&
        contentLines[i + j] !== searchLines[j]
      ) {
        currentScore += 0.1;
      }
    }

    if (currentScore > bestMatchScore) {
      bestMatchScore = currentScore;
      bestMatchIndex = i;
    }
  }

  // If no decent match found (score <= 0), return generic message
  if (bestMatchScore <= 0) {
    return "old_string not found in file (no similar block found)";
  }

  // Generate detailed report
  const reportLines: string[] = [
    `old_string not found in file. Best partial match found at line ${bestMatchIndex + 1}:`,
  ];

  for (let j = 0; j < searchLines.length; j++) {
    const lineNum = bestMatchIndex + j + 1;
    const actualLine = contentLines[bestMatchIndex + j];
    const expectedLine = searchLines[j];

    if (actualLine === expectedLine) {
      reportLines.push(`${lineNum.toString().padStart(4)} | ${actualLine}`);
    } else {
      reportLines.push(`${lineNum.toString().padStart(4)} | - ${expectedLine}`);
      reportLines.push(`${lineNum.toString().padStart(4)} | + ${actualLine}`);
    }
  }

  return reportLines.join("\n");
}
