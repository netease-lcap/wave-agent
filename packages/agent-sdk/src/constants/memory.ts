/**
 * Auto-memory entrypoint limits.
 *
 * The entrypoint (`MEMORY.md`) is an index that is always loaded into the
 * conversation context, so it needs a hard size bound. A line cap alone does
 * not provide one: a 200-line index of very long lines was observed at close
 * to 200 KB. Both caps apply and the tighter one wins.
 *
 * Aligned with Claude Code's `memdir/memdir.ts`
 * (MAX_ENTRYPOINT_LINES / MAX_ENTRYPOINT_BYTES).
 */
export const MEMORY_ENTRYPOINT_NAME = "MEMORY.md";
export const MAX_MEMORY_ENTRYPOINT_LINES = 200;
export const MAX_MEMORY_ENTRYPOINT_BYTES = 25_000;

/** Recommended per-line length for `MEMORY.md` index entries. */
export const MEMORY_INDEX_LINE_GUIDANCE_CHARS = 150;
