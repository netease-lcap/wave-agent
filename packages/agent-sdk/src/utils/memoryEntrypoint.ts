import {
  MAX_MEMORY_ENTRYPOINT_CHARS,
  MAX_MEMORY_ENTRYPOINT_LINES,
  MEMORY_ENTRYPOINT_NAME,
} from "../constants/memory.js";

export interface EntrypointTruncation {
  /** Content ready to be injected, including the warning when truncated. */
  content: string;
  lineCount: number;
  charCount: number;
  wasLineTruncated: boolean;
  wasCharTruncated: boolean;
}

/**
 * Truncate the auto-memory entrypoint to the line AND character caps, appending
 * a warning that names which cap fired.
 *
 * Line-truncates first (a natural boundary), then character-truncates at the
 * last newline before the cap so a line is never cut in half. The character cap
 * is checked against the *original* size: long lines are the failure mode it
 * targets, so measuring after the line truncation would understate the warning.
 *
 * Aligned with Claude Code's `truncateEntrypointContent()` in `memdir.ts`.
 */
export function truncateEntrypointContent(raw: string): EntrypointTruncation {
  const trimmed = raw.trim();
  const contentLines = trimmed.split("\n");
  const lineCount = contentLines.length;
  const charCount = trimmed.length;

  const wasLineTruncated = lineCount > MAX_MEMORY_ENTRYPOINT_LINES;
  const wasCharTruncated = charCount > MAX_MEMORY_ENTRYPOINT_CHARS;

  if (!wasLineTruncated && !wasCharTruncated) {
    return {
      content: trimmed,
      lineCount,
      charCount,
      wasLineTruncated,
      wasCharTruncated,
    };
  }

  let truncated = wasLineTruncated
    ? contentLines.slice(0, MAX_MEMORY_ENTRYPOINT_LINES).join("\n")
    : trimmed;

  if (truncated.length > MAX_MEMORY_ENTRYPOINT_CHARS) {
    const cutAt = truncated.lastIndexOf("\n", MAX_MEMORY_ENTRYPOINT_CHARS);
    truncated = truncated.slice(
      0,
      cutAt > 0 ? cutAt : MAX_MEMORY_ENTRYPOINT_CHARS,
    );
  }

  const reason =
    wasCharTruncated && !wasLineTruncated
      ? `${charCount} characters (limit: ${MAX_MEMORY_ENTRYPOINT_CHARS}) — index entries are too long`
      : wasLineTruncated && !wasCharTruncated
        ? `${lineCount} lines (limit: ${MAX_MEMORY_ENTRYPOINT_LINES})`
        : `${lineCount} lines and ${charCount} characters`;

  return {
    content:
      truncated +
      `\n\n> WARNING: ${MEMORY_ENTRYPOINT_NAME} is ${reason}. Only part of it was loaded. Keep index entries to one line under ~200 chars; move detail into topic files.`,
    lineCount,
    charCount,
    wasLineTruncated,
    wasCharTruncated,
  };
}
