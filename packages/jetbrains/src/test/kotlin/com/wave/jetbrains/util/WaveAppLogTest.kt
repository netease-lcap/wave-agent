package com.wave.jetbrains.util

import org.junit.jupiter.api.AfterEach
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path

/**
 * Tests for the host-side file logger [WaveAppLog].
 *
 * The object is a singleton, so every test redirects [WaveAppLog.logFile] to a
 * temp file and restores the default afterwards.
 */
class WaveAppLogTest {

    @TempDir
    lateinit var tempDir: Path

    private fun newLogFile(): File = File(tempDir.toFile(), "jetbrains.log")

    @AfterEach
    fun restoreLogFile() {
        WaveAppLog.logFile = File(System.getProperty("user.home"), ".wave/logs/jetbrains.log")
    }

    @Test
    fun `log writes ISO-8601 LEVEL message format`() {
        val f = newLogFile()
        WaveAppLog.logFile = f
        WaveAppLog.info("hello")

        val line = f.readLines().single()
        assertTrue(
            line.matches(Regex("""^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z] \[INFO\] hello$""")),
            "line was: $line",
        )
    }

    @Test
    fun `warn and error use their levels`() {
        val f = newLogFile()
        WaveAppLog.logFile = f
        WaveAppLog.warn("careful")
        WaveAppLog.error("boom")

        val lines = f.readLines()
        assertTrue(lines[0].contains(" [WARN] careful"))
        assertTrue(lines[1].contains(" [ERROR] boom"))
    }

    @Test
    fun `newlines in the message collapse to a single line`() {
        val f = newLogFile()
        WaveAppLog.logFile = f
        WaveAppLog.error("line one\nline two\nline three")

        val lines = f.readLines()
        assertEquals(1, lines.size)
        assertEquals("line one line two line three", lines.single().substringAfter("] "))
    }

    @Test
    fun `appends across calls preserving order`() {
        val f = newLogFile()
        WaveAppLog.logFile = f
        WaveAppLog.info("first")
        WaveAppLog.info("second")
        WaveAppLog.info("third")

        val lines = f.readLines()
        assertEquals(3, lines.size)
        assertTrue(lines[0].endsWith("first"))
        assertTrue(lines[1].endsWith("second"))
        assertTrue(lines[2].endsWith("third"))
    }

    @Test
    fun `error with throwable includes the stack trace`() {
        val f = newLogFile()
        WaveAppLog.logFile = f
        WaveAppLog.error("failed", IllegalStateException("kaput"))

        val text = f.readText()
        assertTrue(text.contains("failed: java.lang.IllegalStateException: kaput"))
        assertTrue(text.contains("WaveAppLogTest"))
    }

    @Test
    fun `oversized file is truncated to the last keep lines`() {
        val f = newLogFile()
        WaveAppLog.logFile = f

        // Pre-fill a file that exceeds the 1MB cap (1100 lines x 12KB).
        val lineBody = "x".repeat(12 * 1024)
        val prefill = (0 until 1100).joinToString("\n") { "line-$it-$lineBody" }
        f.writeText(prefill + "\n")

        WaveAppLog.info("after-truncate")

        val kept = f.readLines()
        assertEquals(1000, kept.size)
        assertTrue(kept.first().endsWith("line-101-$lineBody"))
        assertTrue(kept.last().endsWith("after-truncate"))
        assertFalse(kept.any { it.contains("line-100-") })
    }
}
