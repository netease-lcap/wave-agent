package com.wave.jetbrains.stdio

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path

/**
 * Tests for [BinaryResolver]'s pure helpers.
 *
 * Node itself is no longer probed: [BinaryResolver.resolveNode] delegates to the
 * managed runtime ([ManagedRuntime], covered by `ManagedRuntimeTest`), so what
 * remains here is the CLI copy location, the login-shell PATH assembly the CLI's
 * own children still need, and the byte decoding every spawned command goes
 * through.
 */
class BinaryResolverTest {

    @TempDir
    lateinit var tempDir: Path

    private var shimCounter = 0

    // ---- cliInstallDir --------------------------------------------------

    @Test
    fun `cliInstallDir is per-end under the shared cli root`() {
        // Each frontend (vscode/desktop/jetbrains) owns its own subdir so they
        // never overwrite each other's CLI copy.
        val home = System.getProperty("user.home")
        val expected = File(home, ".wave/cli/jetbrains")
        assertEquals(expected.absolutePath, BinaryResolver.cliInstallDir().absolutePath)
    }

    // ---- decodeCommandOutput / readProcessOutput -----------------------
    //
    // Customer repro: on Chinese Windows, cmd.exe builtins (`where`) and
    // `npm prefix -g` write the system OEM code page (CP936/GBK) bytes, NOT
    // UTF-8. Decoding those bytes with the JVM default charset (UTF-8 on
    // JBR 21 / JEP 400) corrupts non-ASCII path segments (`C:\Users\刘一奇\...`
    // → U+FFFD), and spawning the corrupted path fails with
    // ERROR_PATH_NOT_FOUND — the stdio process dies before initialize. The
    // decoder must try UTF-8 first and fall back to GBK on U+FFFD (same
    // policy as packages/vscode and packages/desktop binaryResolver).

    @Test
    fun `decodeCommandOutput decodes GBK bytes to a Chinese path`() {
        val bytes =
            "C:\\Users\\".toByteArray(Charsets.US_ASCII) +
            byteArrayOf(
                0xC1.toByte(), 0xF5.toByte(), 0xD2.toByte(), 0xBB.toByte(),
                0xC6.toByte(), 0xE6.toByte()
            ) +
            "\\npm\\wave.cmd".toByteArray(Charsets.US_ASCII)
        assertEquals("C:\\Users\\刘一奇\\npm\\wave.cmd", BinaryResolver.decodeCommandOutput(bytes))
    }

    @Test
    fun `decodeCommandOutput passes valid UTF-8 through unchanged`() {
        val bytes = "C:\\Users\\刘一奇\\npm\\wave.cmd".toByteArray(Charsets.UTF_8)
        assertEquals("C:\\Users\\刘一奇\\npm\\wave.cmd", BinaryResolver.decodeCommandOutput(bytes))
    }

    @Test
    fun `readProcessOutput decodes GBK bytes from a real subprocess`() {
        org.junit.jupiter.api.Assumptions.assumeFalse(
            System.getProperty("os.name").lowercase().startsWith("win"),
            "POSIX shell shim not available on Windows CI"
        )
        // printf emits the raw GBK bytes for 刘一奇 (\301\365\322\273\306\346)
        // inside an otherwise-ASCII Windows path line, exactly like `where wave`
        // on a Chinese Windows box.
        val script = File(tempDir.toFile(), "gbk-shim-${shimCounter++}.sh").apply {
            writeText("#!/bin/sh\nprintf 'C:\\\\Users\\\\\\301\\365\\322\\273\\306\\346\\\\npm\\\\wave.cmd'")
            setExecutable(true)
        }
        val proc = ProcessBuilder(script.absolutePath).start()
        assertEquals(
            "C:\\Users\\刘一奇\\npm\\wave.cmd",
            BinaryResolver.readProcessOutput(proc)
        )
    }

    // ---- inferGitBashFromGitExe ----------------------------------------

    @Test
    fun `inferGitBashFromGitExe maps cmd git exe to bin bash exe`() {
        assumeWindows()
        assertEquals(
            "C:\\Program Files\\Git\\bin\\bash.exe",
            BinaryResolver.inferGitBashFromGitExe("C:\\Program Files\\Git\\cmd\\git.exe"),
        )
    }

    @Test
    fun `inferGitBashFromGitExe handles a shallow git exe path`() {
        assumeWindows()
        // e.g. git.exe two levels above a bin dir — parent chain collapses
        assertEquals(
            "C:\\tools\\bin\\bash.exe",
            BinaryResolver.inferGitBashFromGitExe("C:\\tools\\bin\\git.exe"),
        )
    }

    @Test
    fun `inferGitBashFromGitExe returns null for a bare filename`() {
        // No parent dirs to climb.
        assertNull(BinaryResolver.inferGitBashFromGitExe("git.exe"))
    }

    // ---- buildEnv ------------------------------------------------------

    @Test
    fun `buildEnv returns empty map when all inputs are null`() {
        assertEquals(emptyMap<String, String>(), BinaryResolver.buildEnv(null, null))
    }

    @Test
    fun `buildEnv includes login shell PATH segments`() {
        val loginPath = "/opt/homebrew/bin:/usr/local/bin"
        val env = BinaryResolver.buildEnv(loginPath, currentPath = null)
        val path = env["PATH"]!!
        assertTrue(path.contains("/opt/homebrew/bin"))
        assertTrue(path.contains("/usr/local/bin"))
    }

    @Test
    fun `buildEnv puts login path before current path`() {
        val loginPath = "/opt/homebrew/bin"
        val currentPath = "/usr/bin"
        val env = BinaryResolver.buildEnv(loginPath, currentPath)
        val segments = env["PATH"]!!.split(File.pathSeparator)
        assertEquals("/opt/homebrew/bin", segments[0])
        assertEquals("/usr/bin", segments[1])
    }

    @Test
    fun `buildEnv uses login path alone when current path is unset`() {
        val loginPath = "/opt/homebrew/bin"
        val env = BinaryResolver.buildEnv(loginPath, currentPath = null)
        assertEquals(loginPath, env["PATH"])
    }

    @Test
    fun `buildEnv dedupes repeated segments`() {
        val env = BinaryResolver.buildEnv(
            loginPath = "/opt/homebrew/bin:/usr/local/bin",
            currentPath = "/opt/homebrew/bin:/usr/local/bin",
        )
        val segments = env["PATH"]!!.split(File.pathSeparator)
        assertEquals(1, segments.count { it == "/opt/homebrew/bin" })
        assertEquals(1, segments.count { it == "/usr/local/bin" })
    }

    // ---- helpers -------------------------------------------------------

    /**
     * Skips the test on non-Windows hosts. [inferGitBashFromGitExe] operates on
     * Windows drive paths (`C:\...\git.exe`); on POSIX JVMs `\` is an ordinary
     * filename character, so `File.parentFile` sees a single-element path and
     * the parent chain collapses to null. The mapping only exists on Windows.
     */
    private fun assumeWindows() {
        org.junit.jupiter.api.Assumptions.assumeTrue(
            System.getProperty("os.name").lowercase().startsWith("win"),
            "Git Bash path inference is Windows-only"
        )
    }
}
