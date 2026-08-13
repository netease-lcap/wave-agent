package com.wave.jetbrains.stdio

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.io.File
import java.nio.file.Path

/**
 * Tests for the nvm-probing helpers added to [BinaryResolver].
 *
 * GUI-launched JetBrains IDEs on macOS don't inherit the shell PATH, so an
 * nvm-installed npm/wave is invisible to `which`. These tests cover the nvm
 * root traversal (default-alias resolution + highest-version fallback) and the
 * version comparator, using an injected temp directory instead of the real
 * `~/.nvm`.
 */
class BinaryResolverTest {

    @TempDir
    lateinit var tempDir: Path

    private var nvmCounter = 0
    private var shimCounter = 0

    // ---- findNvmBinDir -------------------------------------------------

    @Test
    fun `findNvmBinDir with bare numeric default alias resolves matching version`() {
        // alias/default = "22" → prefix v22 → matches v22.14.0 (not v20.19.0)
        val nvm = newNvmRoot(defaultAlias = "22")
        newVersion(nvm, "v22.14.0")
        newVersion(nvm, "v20.19.0")

        val bin = BinaryResolver.findNvmBinDir(nvm)
        assertEquals(File(nvm, "versions/node/v22.14.0/bin").absoluteFile, bin?.absoluteFile)
    }

    @Test
    fun `findNvmBinDir with full v-prefixed default alias resolves exact version`() {
        // alias/default = "v22.14.0" → prefix v22.14.0 → matches v22.14.0
        val nvm = newNvmRoot(defaultAlias = "v22.14.0")
        newVersion(nvm, "v22.14.0")
        newVersion(nvm, "v20.19.0")

        val bin = BinaryResolver.findNvmBinDir(nvm)
        assertEquals(File(nvm, "versions/node/v22.14.0/bin").absoluteFile, bin?.absoluteFile)
    }

    @Test
    fun `findNvmBinDir without default file falls back to highest installed version`() {
        val nvm = newNvmRoot(defaultAlias = null)
        newVersion(nvm, "v18.20.4")
        newVersion(nvm, "v22.14.0")
        newVersion(nvm, "v23.10.0")

        val bin = BinaryResolver.findNvmBinDir(nvm)
        assertEquals(File(nvm, "versions/node/v23.10.0/bin").absoluteFile, bin?.absoluteFile)
    }

    @Test
    fun `findNvmBinDir returns null when nvm root does not exist`() {
        val missing = File(tempDir.toFile(), "does-not-exist")
        assertNull(BinaryResolver.findNvmBinDir(missing))
    }

    @Test
    fun `findNvmBinDir with non-version alias falls back to highest installed version`() {
        // alias/default = "node" (an alias, not a bare version) → fallback path
        val nvm = newNvmRoot(defaultAlias = "node")
        newVersion(nvm, "v18.20.4")
        newVersion(nvm, "v22.14.0")
        newVersion(nvm, "v23.10.0")

        val bin = BinaryResolver.findNvmBinDir(nvm)
        assertEquals(File(nvm, "versions/node/v23.10.0/bin").absoluteFile, bin?.absoluteFile)
    }

    // ---- compareVersions -----------------------------------------------

    @Test
    fun `compareVersions orders versions numerically`() {
        assertTrue(BinaryResolver.compareVersions("v22.14.0", "v20.19.0") > 0)
        assertEquals(0, BinaryResolver.compareVersions("v18.20.4", "v18.20.4"))
        assertTrue(BinaryResolver.compareVersions("v20.19.0", "v23.10.0") < 0)
    }

    // ---- getCliVersion -------------------------------------------------
    //
    // getCliVersion spawns `<path> -v` in a timed process. We exercise the
    // real subprocess path (no mocking) by writing a tiny shim script into
    // the temp dir that prints a canned version line, then asserting on the
    // parsed/stripped result. The `__VERSION__` placeholder keeps each case a
    // one-liner; `assumeFalse(isWindows)` skips the .sh variant on Windows
    // (where the test harness lacks a POSIX shell), matching the prod guard.

    private fun writeVersionShim(versionLine: String): File {
        val script = File(tempDir.toFile(), "version-shim-${shimCounter++}.sh").apply {
            writeText("#!/bin/sh\necho '$versionLine'\n")
            setExecutable(true)
        }
        return script
    }

    @Test
    fun `getCliVersion returns the bare version from -v output`() {
        org.junit.jupiter.api.Assumptions.assumeFalse(
            System.getProperty("os.name").lowercase().startsWith("win"),
            "POSIX shell shim not available on Windows CI"
        )
        val shim = writeVersionShim("0.18.7")
        assertEquals("0.18.7", BinaryResolver.getCliVersion(shim.absolutePath))
    }

    @Test
    fun `getCliVersion strips a leading v`() {
        org.junit.jupiter.api.Assumptions.assumeFalse(
            System.getProperty("os.name").lowercase().startsWith("win"),
            "POSIX shell shim not available on Windows CI"
        )
        val shim = writeVersionShim("v1.2.3")
        assertEquals("1.2.3", BinaryResolver.getCliVersion(shim.absolutePath))
    }

    @Test
    fun `getCliVersion uses the first non-empty line`() {
        org.junit.jupiter.api.Assumptions.assumeFalse(
            System.getProperty("os.name").lowercase().startsWith("win"),
            "POSIX shell shim not available on Windows CI"
        )
        // A leading blank line (common from banner-printing shells) must be
        // skipped, and trailing lines ignored.
        val shim = writeVersionShim("\n4.5.6\nextra-noise")
        assertEquals("4.5.6", BinaryResolver.getCliVersion(shim.absolutePath))
    }

    @Test
    fun `getCliVersion returns null when the binary path does not exist`() {
        val missing = File(tempDir.toFile(), "no-such-binary").absolutePath
        assertNull(BinaryResolver.getCliVersion(missing))
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

    // ---- pickExecutableLine --------------------------------------------
    //
    // Customer repro: a default Node.js install on Windows lives at
    // `C:\Program Files\nodejs`, and `where npm` lists the extensionless
    // bash launcher FIRST (`...\npm`, then `...\npm.cmd`). CreateProcess
    // cannot execute the bash launcher, so the npm install/upgrade fails
    // and the stdio client never initializes.

    @Test
    fun `pickExecutableLine prefers the cmd line from where output on Windows`() {
        // `where` emits CRLF line endings.
        val out = "C:\\Program Files\\nodejs\\npm\r\nC:\\Program Files\\nodejs\\npm.cmd\r\n"
        assertEquals(
            "C:\\Program Files\\nodejs\\npm.cmd",
            BinaryResolver.pickExecutableLine(out, windows = true)
        )
    }

    @Test
    fun `pickExecutableLine prefers an exe line on Windows`() {
        val out = "C:\\tools\\wave\nC:\\tools\\wave.exe\n"
        assertEquals("C:\\tools\\wave.exe", BinaryResolver.pickExecutableLine(out, windows = true))
    }

    @Test
    fun `pickExecutableLine falls back to first line when no cmd or exe on Windows`() {
        val out = "C:\\tools\\wave\nC:\\other\\wave\n"
        assertEquals("C:\\tools\\wave", BinaryResolver.pickExecutableLine(out, windows = true))
    }

    @Test
    fun `pickExecutableLine takes the first line off-Windows`() {
        val out = "/usr/bin/npm\n/usr/local/bin/npm\n"
        assertEquals("/usr/bin/npm", BinaryResolver.pickExecutableLine(out, windows = false))
    }

    @Test
    fun `pickExecutableLine returns null for empty output`() {
        assertNull(BinaryResolver.pickExecutableLine("", windows = true))
    }

    // ---- findInNvm -----------------------------------------------------

    @Test
    fun `findInNvm returns binary path when present, null when absent`() {
        val nvm = newNvmRoot(defaultAlias = "22")
        val binDir = newVersion(nvm, "v22.14.0")

        // Present: place a `wave` file in the bin dir.
        val waveFile = File(binDir, "wave").apply { createNewFile() }
        assertEquals(
            waveFile.absolutePath,
            BinaryResolver.findInNvm("wave", nvm)?.let { File(it).absolutePath }
        )

        // Absent: a different nvm root with no `wave` in bin.
        val nvm2 = newNvmRoot(defaultAlias = "22")
        newVersion(nvm2, "v22.14.0")
        assertNull(BinaryResolver.findInNvm("wave", nvm2))
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
     * Builds a fake nvm root under [tempDir]: `versions/node/` created, and
     * `alias/default` written with [defaultAlias] when non-null.
     */
    private fun newNvmRoot(defaultAlias: String?): File {
        // Unique subdir per call so two roots with the same alias don't collide.
        val name = "nvm-${defaultAlias ?: "none"}-${nvmCounter++}"
        val nvm = File(tempDir.toFile(), name).apply { mkdirs() }
        File(nvm, "versions/node").mkdirs()
        if (defaultAlias != null) {
            File(nvm, "alias").mkdirs()
            File(nvm, "alias/default").writeText(defaultAlias)
        }
        return nvm
    }

    /** Creates `<nvm>/versions/node/<version>/bin` and returns the bin dir. */
    private fun newVersion(nvm: File, version: String): File {
        return File(nvm, "versions/node/$version/bin").apply { mkdirs() }
    }
}
