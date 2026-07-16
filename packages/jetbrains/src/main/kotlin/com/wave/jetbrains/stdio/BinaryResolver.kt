package com.wave.jetbrains.stdio

import com.intellij.openapi.diagnostic.logger
import java.io.File

/**
 * Resolves the `wave` binary at runtime: PATH → npm global bin → auto-install.
 * Mirrors packages/vsce/src/stdio/binaryResolver.ts.
 */
object BinaryResolver {
    private val LOG = logger<BinaryResolver>()
    private const val PACKAGE = "wave-code"

    @Volatile
    private var cachedPath: String? = null

    private val isWindows = System.getProperty("os.name").lowercase().startsWith("win")
    private val waveName = if (isWindows) "wave.cmd" else "wave"
    private val lookupCmd = if (isWindows) "where" else "which"

    fun resolveWaveBinary(): String {
        cachedPath?.let { return it }

        // 1. PATH lookup
        findOnPath(waveName)?.let { return cache(it) }

        // 2. npm global bin
        val globalBin = getNpmGlobalBin()

        // 3. global bin direct
        val globalPath = File(globalBin, waveName).path
        if (File(globalPath).exists()) return cache(globalPath)

        // 4. auto-install
        val npm = findNpm()
        LOG.info("wave not found; running: \"$npm\" install -g $PACKAGE")
        runCommand(npm, "install", "-g", PACKAGE)

        // 5. recheck global bin
        if (File(globalPath).exists()) return cache(globalPath)

        // 6. recheck PATH
        findOnPath(waveName)?.let { return cache(it) }

        // 7. fail
        throw StdioClientException("wave binary not found after installation. Ensure npm global bin is on PATH.")
    }

    /** Reset cache (testing). */
    fun resetCache() { cachedPath = null }

    private fun cache(path: String): String {
        cachedPath = path
        return path
    }

    private fun findOnPath(name: String): String? {
        return try {
            val out = runCommand(lookupCmd, name)
            out.lineSequence().firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }
        } catch (e: Exception) {
            null
        }
    }

    private fun findNpm(): String {
        // which/where npm
        try {
            val out = runCommand(lookupCmd, "npm")
            out.lineSequence().firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        } catch (_: Exception) {}
        // fallback: node dir
        val javaHome = System.getProperty("java.home") ?: return "npm"
        val nodeDir = File(javaHome).parent ?: return "npm"
        val candidates: List<File> = if (isWindows) {
            listOf(File(nodeDir, "npm.cmd"), File(nodeDir, "npm"))
        } else {
            listOf(File(nodeDir, "npm"), File(File(nodeDir, ".."), "bin").let { File(it, "npm") })
        }
        candidates.firstOrNull { it.exists() }?.path?.let { return it }
        return "npm"
    }

    private fun getNpmGlobalBin(): String {
        val npm = findNpm()
        val prefix = runCommand(npm, "prefix", "-g").trim()
        return if (isWindows) prefix else File(prefix, "bin").path
    }

    private fun runCommand(vararg cmd: String): String {
        val proc = ProcessBuilder(cmd.toList()).redirectErrorStream(true).start()
        val out = proc.inputStream.bufferedReader().readText()
        val code = proc.waitFor()
        if (code != 0) {
            throw StdioClientException("Command failed (${cmd.joinToString(" ")}): $out")
        }
        return out
    }
}
