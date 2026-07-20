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
