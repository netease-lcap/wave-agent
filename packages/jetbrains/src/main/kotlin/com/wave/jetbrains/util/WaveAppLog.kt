package com.wave.jetbrains.util

import java.io.File
import java.io.FileOutputStream
import java.nio.charset.StandardCharsets
import java.time.Instant

/**
 * Host-side file logger for the JetBrains plugin.
 *
 * Appends one line per entry to `~/.wave/logs/jetbrains.log`, mirroring the
 * CLI / other hosts convention (`cli.log` / `desktop.log` / `vscode.log`).
 * The `wave --stdio` child writes its own `cli.log`; this object covers the
 * plugin (IDE) process itself. Format is `[ISO-8601] [LEVEL] message` — plain
 * text, single line per entry, matching the Node host loggers.
 *
 * The path uses `user.home` (like the CLI's `$HOME` and BinaryResolver's
 * `~/.wave/cli`) — the XDG_CONFIG_HOME variable is intentionally ignored, so
 * the directory stays consistent with the CLI on every OS.
 *
 * Files are kept bounded: after each append the file is truncated to the last
 * [KEEP_LINES] lines when it exceeds [MAX_FILE_SIZE] bytes.
 */
object WaveAppLog {

    private const val MAX_FILE_SIZE = 1L * 1024 * 1024
    private const val KEEP_LINES = 1000

    /**
     * Log file path. `var` so tests can redirect to a temp file.
     */
    @Volatile
    var logFile: File = File(System.getProperty("user.home"), ".wave/logs/jetbrains.log")

    fun info(message: String) = log("INFO", message)

    fun warn(message: String) = log("WARN", message)

    fun error(message: String) = log("ERROR", message)

    fun error(message: String, t: Throwable?) = log("ERROR", message + if (t != null) ": ${t.stackTraceToString()}" else "")

    /**
     * Append a single-line entry. Never throws — logging must never break the
     * caller; write failures are silently skipped.
     */
    fun log(level: String, message: String) {
        try {
            logFile.parentFile?.mkdirs()
            val line = "[${Instant.now()}] [$level] ${message.replace('\n', ' ').replace('\r', ' ')}\n"
            FileOutputStream(logFile, true).bufferedWriter(StandardCharsets.UTF_8).use { it.write(line) }
            truncateIfNeeded()
        } catch (_: Exception) {
            // Never break the caller.
        }
    }

    private fun truncateIfNeeded() {
        if (!logFile.exists() || logFile.length() <= MAX_FILE_SIZE) return
        val kept = logFile.readLines().takeLast(KEEP_LINES)
        logFile.writeText(kept.joinToString("\n") + "\n")
    }
}
