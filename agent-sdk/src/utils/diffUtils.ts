/**
 * Git diff utilities for handling diff content extraction and limitation
 */

export interface FileDiff {
  path: string;
  changes: string;
}

/**
 * Parse git diff into individual file diffs
 */
export function parseGitDiff(diff: string): FileDiff[] {
  const fileDiffs: FileDiff[] = [];
  const lines = diff.split("\n");

  let currentFile: string | null = null;
  let currentChanges: string[] = [];

  for (const line of lines) {
    // Check for file header (diff --git a/file b/file)
    if (line.startsWith("diff --git")) {
      // Save previous file if exists
      if (currentFile && currentChanges.length > 0) {
        fileDiffs.push({
          path: currentFile,
          changes: currentChanges.join("\n"),
        });
      }

      // Extract file path
      const match = line.match(/diff --git a\/(.+) b\/(.+)/);
      currentFile = match ? match[2] : null;
      currentChanges = [line];
    } else if (currentFile) {
      currentChanges.push(line);
    }
  }

  // Save last file
  if (currentFile && currentChanges.length > 0) {
    fileDiffs.push({
      path: currentFile,
      changes: currentChanges.join("\n"),
    });
  }

  return fileDiffs;
}

/**
 * Extract a limited sample from each file's diff
 */
export function extractLimitedDiffPerFile(
  fileDiffs: FileDiff[],
  linesPerFile: number = 20,
): string {
  const limitedDiffs = fileDiffs.map((fileDiff) => {
    const lines = fileDiff.changes.split("\n");

    // Extract file header and first few change lines
    const headerLines = lines.filter(
      (line) =>
        line.startsWith("diff --git") ||
        line.startsWith("index ") ||
        line.startsWith("+++") ||
        line.startsWith("---") ||
        line.startsWith("@@"),
    );

    const changeLines = lines
      .filter((line) => line.startsWith("+") || line.startsWith("-"))
      .slice(0, linesPerFile);

    return [...headerLines, ...changeLines].join("\n");
  });

  return limitedDiffs.join("\n\n");
}

/**
 * Limit git diff content intelligently
 */
export function limitGitDiff(diff: string, maxLines: number = 1000): string {
  const lines = diff.split("\n");

  // If within limit, return as is
  if (lines.length <= maxLines) {
    return diff;
  }

  // Parse into file diffs
  const fileDiffs = parseGitDiff(diff);

  // If we have multiple files, extract limited sample from each
  if (fileDiffs.length > 1) {
    const linesPerFile = Math.floor(maxLines / fileDiffs.length);
    return extractLimitedDiffPerFile(fileDiffs, Math.max(linesPerFile, 10));
  }

  // For single file, just truncate
  return lines.slice(0, maxLines).join("\n");
}
