/**
 * Tool output size limits matching Claude Code patterns.
 */

/** System-wide default max result size in characters. */
export const DEFAULT_MAX_RESULT_SIZE_CHARS = 50_000;

/**
 * Per-command cap for bash tool output before persistence, in UTF-8 bytes —
 * not characters. Same budget as Claude Code's `BASH_MAX_OUTPUT_LENGTH`; the
 * reasoning for bytes over characters is in `utils/utf8Bytes.ts`.
 */
export const BASH_MAX_OUTPUT_BYTES = 30_000;

/** Per-command cap for skill bash substitution (inline/block), in UTF-8 bytes. */
export const SKILL_BASH_MAX_OUTPUT_BYTES = 30_000;

/** Preview size in characters when output is persisted to disk. */
export const PREVIEW_SIZE_BYTES = 2_048;
