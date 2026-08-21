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

    // ---- satisfiesCaret ------------------------------------------------

    @Test
    fun `satisfiesCaret accepts versions within a caret range`() {
        assertTrue(BinaryResolver.satisfiesCaret("1.18.0", "^1.18.0"))
        assertTrue(BinaryResolver.satisfiesCaret("1.18.5", "^1.18.0"))
        assertTrue(BinaryResolver.satisfiesCaret("1.19.0", "^1.18.0"))
    }

    @Test
    fun `satisfiesCaret rejects versions outside a caret range`() {
        assertTrue(!BinaryResolver.satisfiesCaret("1.17.9", "^1.18.0"))
        assertTrue(!BinaryResolver.satisfiesCaret("2.0.0", "^1.18.0"))
        assertTrue(!BinaryResolver.satisfiesCaret("0.18.0", "^1.18.0"))
    }

    @Test
    fun `satisfiesCaret rejects prerelease and malformed versions`() {
        assertTrue(!BinaryResolver.satisfiesCaret("1.18.1-beta.1", "^1.18.0"))
        assertTrue(!BinaryResolver.satisfiesCaret("v1.18.0", "^1.18.0"))
        assertTrue(!BinaryResolver.satisfiesCaret("1.18", "^1.18.0"))
    }

    @Test
    fun `satisfiesCaret rejects non-caret ranges`() {
        assertTrue(!BinaryResolver.satisfiesCaret("1.18.0", "~1.18.0"))
        assertTrue(!BinaryResolver.satisfiesCaret("1.18.0", ">=1.18.0"))
    }

    // ---- extractTarball ------------------------------------------------

    @Test
    fun `rgPlatformDir carries the ripgrep prefix so cache check and npm package name match`() {
        // Regression: the dir must be `ripgrep-<platform>-<arch>` (mirroring the
        // npm package `@vscode/ripgrep-<platform>-<arch>` and desktop/vscode's
        // layout) — without the prefix the cache check at rgBinaryPath() never
        // hits and the tarball URL resolves to a non-existent npm package.
        val dir = BinaryResolver.rgPlatformDir
        assertTrue(
            dir.matches(Regex("ripgrep-(win32|darwin|linux)-(x64|arm64|ia32)")),
            "rgPlatformDir was: $dir",
        )
    }

    @Test
    fun `cliInstallDir is per-end under the shared cli root`() {
        // Each frontend (vscode/desktop/jetbrains) owns its own subdir so they
        // never overwrite each other's CLI copy.
        val home = System.getProperty("user.home")
        val expected = File(home, ".wave/cli/jetbrains")
        assertEquals(expected.absolutePath, BinaryResolver.cliInstallDir().absolutePath)
    }

    @Test
    fun `rgInstallDir stays at the shared root not inside the per-end dir`() {
        // rg is shared by all three frontends — a sibling of the per-end dir
        // (under ~/.wave/cli), so a CLI re-copy never wipes the cached download.
        val cliRoot = BinaryResolver.cliInstallDir().parentFile
        assertEquals(
            File(cliRoot, "node_modules/@vscode").absolutePath,
            BinaryResolver.rgInstallDir().absolutePath,
        )
    }


    @Test
    fun `extractTarball strips the top package dir`() {
        val tarGz = buildTarGz(
            mapOf(
                "package/package.json" to "{\"name\":\"x\"}".toByteArray(),
                "package/bin/rg" to "binary-bytes".toByteArray(),
            )
        )
        val dest = File(tempDir.toFile(), "extract-${shimCounter++}")
        BinaryResolver.extractTarball(tarGz, dest)

        assertTrue(File(dest, "package.json").isFile)
        assertEquals("{\"name\":\"x\"}", File(dest, "package.json").readText())
        assertTrue(File(dest, "bin/rg").isFile)
        assertEquals("binary-bytes", File(dest, "bin/rg").readText())
        // The top-level `package/` dir itself must not leak into the output.
        assertTrue(!File(dest, "package").exists())
    }

    @Test
    fun `extractTarball creates nested dirs and preserves binary bytes`() {
        val payload = ByteArray(256) { (it % 251).toByte() }
        val tarGz = buildTarGz(mapOf("package/dist/bundle/wave.mjs" to payload))
        val dest = File(tempDir.toFile(), "extract-${shimCounter++}")
        BinaryResolver.extractTarball(tarGz, dest)

        val out = File(dest, "dist/bundle/wave.mjs")
        assertTrue(out.isFile)
        assertTrue(out.readBytes().contentEquals(payload))
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

        // Present: place a `node` file in the bin dir.
        val nodeFile = File(binDir, "node").apply { createNewFile() }
        assertEquals(
            nodeFile.absolutePath,
            BinaryResolver.findInNvm("node", nvm)?.let { File(it).absolutePath }
        )

        // Absent: a different nvm root with no `node` in bin.
        val nvm2 = newNvmRoot(defaultAlias = "22")
        newVersion(nvm2, "v22.14.0")
        assertNull(BinaryResolver.findInNvm("node", nvm2))
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

    /** Builds a `.tar.gz` byte array from `package/...` entries (npm tarball shape). */
    private fun buildTarGz(entries: Map<String, ByteArray>): ByteArray {
        java.io.ByteArrayOutputStream().use { bos ->
            org.apache.commons.compress.compressors.gzip.GzipCompressorOutputStream(bos).use { gz ->
                org.apache.commons.compress.archivers.tar.TarArchiveOutputStream(gz).use { tar ->
                    entries.forEach { (name, data) ->
                        val entry = org.apache.commons.compress.archivers.tar.TarArchiveEntry(name)
                        entry.size = data.size.toLong()
                        tar.putArchiveEntry(entry)
                        tar.write(data)
                        tar.closeArchiveEntry()
                    }
                }
            }
            return bos.toByteArray()
        }
    }
}
