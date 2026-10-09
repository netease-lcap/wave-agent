/**
 * Auto-memory taxonomy and entrypoint limits.
 *
 * The entrypoint (`MEMORY.md`) is an index that is always loaded into the
 * conversation context, so it needs a hard size bound. A line cap alone does
 * not provide one: a 200-line index of very long lines was observed at close
 * to 200 KB. Both caps apply and the tighter one wins.
 *
 * Aligned with Claude Code's `memdir/memdir.ts` (MAX_ENTRYPOINT_LINES /
 * MAX_ENTRYPOINT_BYTES); the second bound is counted in characters, not bytes
 * — Claude Code's constant carries the BYTES name but its value is derived
 * from "~125 chars/line at 200 lines" and is compared against `String.length`.
 */
export const MEMORY_ENTRYPOINT_NAME = "MEMORY.md";
export const MAX_MEMORY_ENTRYPOINT_LINES = 200;
export const MAX_MEMORY_ENTRYPOINT_CHARS = 25_000;

/** Recommended per-line length for `MEMORY.md` index entries. */
export const MEMORY_INDEX_LINE_GUIDANCE_CHARS = 150;

/**
 * Per-file caps for a single memory topic file. Measured in bytes, not
 * characters, because the file is read whole whenever it is opened — a cap in
 * characters would let a CJK-heavy file cost three times as much. Aligned with
 * Claude Code (`Sne=4096` / `LTe=200`).
 */
export const MAX_MEMORY_FILE_BYTES = 4096;
export const MAX_MEMORY_FILE_LINES = 200;

/**
 * Frontmatter `description` upper bound. A description becomes one index line,
 * so anything much past a line has to be shortened before it can be used.
 */
export const MAX_MEMORY_DESCRIPTION_CHARS = 300;

/**
 * Occupancy ratio at which a write is flagged, and the fraction of the cap a
 * flagged file should be compacted back to. Aligned with Claude Code's
 * write-time gate (`iDn=0.8` / `QG=0.7`), whose targets are `cap * 0.7` —
 * 140 lines / 17,500 characters for the index.
 */
export const MEMORY_CAP_WARN_RATIO = 0.8;
export const MEMORY_CAP_TARGET_RATIO = 0.7;

export const MEMORY_TYPES = [
  "user",
  "feedback",
  "project",
  "reference",
] as const;

export type MemoryType = (typeof MEMORY_TYPES)[number];

/**
 * Parse a raw frontmatter value into a MemoryType. Invalid or missing values
 * return undefined — files written before the taxonomy existed keep working
 * and unknown types degrade gracefully.
 */
export function parseMemoryType(raw: unknown): MemoryType | undefined {
  if (typeof raw !== "string") return undefined;
  return MEMORY_TYPES.find((t) => t === raw);
}
