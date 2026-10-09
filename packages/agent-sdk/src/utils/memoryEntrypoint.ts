import {
  MAX_MEMORY_ENTRYPOINT_CHARS,
  MAX_MEMORY_ENTRYPOINT_LINES,
  MEMORY_ENTRYPOINT_NAME,
  MEMORY_INDEX_LINE_GUIDANCE_CHARS,
} from "../constants/memory.js";

export interface EntrypointTruncation {
  /** Content ready to be injected, including the warning when truncated. */
  content: string;
  lineCount: number;
  charCount: number;
  /**
   * Lines actually loaded. The last one may be cut mid-line, which is what the
   * warning reports when the character cap bites inside line 1.
   */
  loadedLineCount: number;
  wasLineTruncated: boolean;
  wasCharTruncated: boolean;
}

/**
 * Truncate the auto-memory entrypoint to the line AND character caps, appending
 * a warning that names which cap fired and what was dropped.
 *
 * The warning exists because the index is the only way a topic file is ever
 * discovered: a pointer that was dropped is a memory the model will never read.
 * Naming only the total (the previous wording) left it unable to tell which
 * entries vanished — and the dropped tail is the most recently written part.
 *
 * Line-truncates first (a natural boundary), then character-truncates at the
 * last newline before the cap so a line is never cut in half. The character cap
 * is checked against the *original* size: long lines are the failure mode it
 * targets, so measuring after the line truncation would understate the warning.
 *
 * Aligned with Claude Code's `truncateEntrypointContent()` in `memdir.ts`,
 * except that the "line 1" wording is used only when the cut really did land
 * inside line 1 — Claude Code keys it off "the character cap fired" alone, so
 * a multi-line file cut at a newline still reports "line 1".
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
      loadedLineCount: lineCount,
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

  const remainder = trimmed.slice(truncated.length);
  const remainderLines = remainder.split("\n");
  const loadedLineCount = remainder
    ? lineCount - remainderLines.length + 1
    : lineCount;
  const droppedLineCount = lineCount - loadedLineCount;

  let cutDescription: string;
  if (loadedLineCount <= 1) {
    cutDescription = `everything after the first ${truncated.length} characters of line 1 was cut off`;
  } else {
    const firstDropped = remainderLines.find((line) => line.trim()) ?? "";
    const snippet = firstDropped.trim().slice(0, 80);
    cutDescription = `${droppedLineCount} of ${lineCount} lines were cut off, starting at line ${loadedLineCount + 1}${snippet ? ` ("${snippet}")` : ""}`;
  }

  return {
    content:
      truncated +
      `\n\n> WARNING: ${MEMORY_ENTRYPOINT_NAME} is ${reason}. Only part of it was loaded: ${cutDescription}. Keep index entries to one line under ~${MEMORY_INDEX_LINE_GUIDANCE_CHARS} chars; move detail into topic files.`,
    lineCount,
    charCount,
    loadedLineCount,
    wasLineTruncated,
    wasCharTruncated,
  };
}
