/**
 * Staleness annotations for auto-memory files.
 *
 * A memory is a point-in-time observation, so its `file:line` citations and
 * symbol names can silently rot as the code moves on. A stale claim that
 * carries a citation reads as *more* authoritative, not less, so the age has to
 * be stated explicitly when the file is read.
 *
 * Aligned with Claude Code's `memdir/memoryAge.ts`.
 */

/**
 * Days elapsed since mtime, floor-rounded — 0 for today, 1 for yesterday, 2+
 * for older. Negative inputs (future mtime, clock skew) clamp to 0.
 */
export function memoryAgeDays(mtimeMs: number): number {
  return Math.max(0, Math.floor((Date.now() - mtimeMs) / 86_400_000));
}

/**
 * Plain-text staleness caveat for memories more than a day old, or `""` for
 * fresh ones (warning there is noise). Models are poor at date arithmetic — a
 * raw ISO timestamp does not trigger staleness reasoning the way "47 days ago"
 * does.
 *
 * Only the day count is derived from the clock, so the text is byte-stable
 * within a day: re-reading the same file at the same mtime cannot change the
 * bytes in the conversation history.
 */
export function memoryFreshnessText(mtimeMs: number): string {
  const days = memoryAgeDays(mtimeMs);
  if (days <= 1) return "";
  return (
    `This memory is ${days} days old. ` +
    `Memories are point-in-time observations, not live state — ` +
    `claims about code behavior or file:line citations may be outdated. ` +
    `Verify against current code before asserting as fact.`
  );
}

/**
 * Per-memory staleness note wrapped in `<system-reminder>` tags, or `""` for
 * memories up to a day old. For callers that do not add their own wrapper
 * (the Read tool prepends this to the file content it returns).
 */
export function memoryFreshnessNote(mtimeMs: number): string {
  const text = memoryFreshnessText(mtimeMs);
  if (!text) return "";
  return `<system-reminder>${text}</system-reminder>\n`;
}
