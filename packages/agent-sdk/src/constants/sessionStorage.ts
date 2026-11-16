/**
 * Size of the tail window session listing reads from a transcript file.
 *
 * Anything a reader needs to see (`custom-title` above all) has to stay within
 * this distance of EOF. It lives here rather than in `fileUtils` so the
 * threshold below keeps a single source: tests that mock `fileUtils` still get
 * the real numbers.
 */
export const TAIL_WINDOW_BYTES = 64 * 1024;

/**
 * How much the transcript may grow between two metadata re-appends.
 *
 * Half of the listing's tail window: keeping the entry within half a window of
 * EOF means the window always covers it, with room to spare, so a session that
 * is still running stays listable from another process at any moment — not
 * only after it exits. Aligned with Claude Code 2.1.x, which re-appends once
 * `bytesSinceMetadataReAppend >= LITE_READ_BUF_SIZE / 2`.
 */
export const METADATA_REAPPEND_THRESHOLD_BYTES = TAIL_WINDOW_BYTES / 2;
