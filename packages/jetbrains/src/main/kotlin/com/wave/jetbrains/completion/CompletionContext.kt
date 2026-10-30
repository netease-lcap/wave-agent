package com.wave.jetbrains.completion

/**
 * Tuning knobs for inline completion. Mirrors the VS Code side and the spec
 * (`docs/specs/ide/code-completion.md`) — the two hosts must ask the same
 * question with the same context window.
 */
object CompletionOptions {
    /** Context window around the caret, in lines. */
    const val PREFIX_LINES = 150
    const val SUFFIX_LINES = 30

    /** Hard cap on the prompt body, so a long file cannot blow up a request. */
    const val MAX_CONTEXT_CHARS = 12000

    /** Rendering cap (spec: 10 lines / 1000 chars). */
    const val MAX_SUGGESTION_LINES = 10
    const val MAX_SUGGESTION_CHARS = 1000

    /** Documents larger than this are skipped entirely (spec: 1MB 或 20000 行). */
    const val MAX_FILE_CHARS = 1024 * 1024

    /** A response slower than this is worthless for typing; give up on it. */
    const val REQUEST_TIMEOUT_MS = 3000L
}

/** The code before and after the caret, windowed and bounded. */
data class CompletionContext(
    val prefix: String,
    val suffix: String,
)

/**
 * Cuts [text] down to the lines around [offset] and enforces the total character
 * budget, dropping the farthest lines first — the nearest code is what the model
 * needs to continue the current line.
 *
 * Pure on purpose: the platform provider supplies the document text, the tests
 * supply a string.
 */
fun buildCompletionContext(
    text: CharSequence,
    offset: Int,
    prefixLines: Int = CompletionOptions.PREFIX_LINES,
    suffixLines: Int = CompletionOptions.SUFFIX_LINES,
    maxChars: Int = CompletionOptions.MAX_CONTEXT_CHARS,
): CompletionContext {
    val cursor = offset.coerceIn(0, text.length)

    // Walk back to the first line boundary beyond `prefixLines`; stopping on the
    // newline itself keeps the boundary line intact.
    var start = 0
    var newlines = 0
    var index = cursor - 1
    while (index >= 0) {
        if (text[index] == '\n') {
            newlines++
            if (newlines > prefixLines) break
        }
        index--
    }
    start = index + 1

    // Walk forward past `suffixLines` newlines (the caret's own line included).
    var end = text.length
    newlines = 0
    index = cursor
    while (index < text.length) {
        if (text[index] == '\n') {
            newlines++
            if (newlines > suffixLines) break
        }
        index++
    }
    end = index

    var prefix = text.substring(start, cursor).toString()
    var suffix = text.substring(cursor, end).toString()

    while (prefix.length + suffix.length > maxChars) {
        if (prefix.length >= suffix.length && prefix.contains('\n')) {
            prefix = prefix.substringAfter('\n')
        } else if (suffix.contains('\n')) {
            suffix = suffix.substringBeforeLast('\n')
        } else {
            break
        }
    }

    return CompletionContext(prefix, suffix)
}

/**
 * Trims a suggestion to what we are willing to render. A completion longer than
 * this is usually the model restating the file rather than continuing the line.
 */
fun truncateSuggestion(
    text: String,
    maxLines: Int = CompletionOptions.MAX_SUGGESTION_LINES,
    maxChars: Int = CompletionOptions.MAX_SUGGESTION_CHARS,
): String = text.split('\n').take(maxLines).joinToString("\n").take(maxChars).trimEnd()
