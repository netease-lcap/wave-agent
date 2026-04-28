/**
 * Tool output size limits matching Claude Code patterns.
 */

/** System-wide default max result size in characters. */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;

/** Per-command cap for skill bash substitution (inline/block). */
export const SKILL_BASH_MAX_OUTPUT_CHARS = 30_000;

/** Preview size in characters when output is persisted to disk. */
export const PREVIEW_SIZE_BYTES = 2_048;
