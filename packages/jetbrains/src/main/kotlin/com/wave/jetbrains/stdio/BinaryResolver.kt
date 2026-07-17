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

        // 0. nvm-installed binary (GUI-launched IDEs don't inherit shell PATH, so an
        // nvm-managed npm/wave install is invisible to `which` — probe nvm first).
        findInNvm(waveName)?.let { return cache(it) }

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

    /**
     * Environment variables to inject into spawned `wave`/`npm` processes.
     *
     * GUI-launched IDEs don't inherit the shell PATH, so the `#!/usr/bin/env node`
     * shebang on the nvm-managed `wave`/`npm` scripts can't resolve `node`. When
     * nvm is detected we prepend its bin dir to PATH so the shebang resolves.
     * Returns an empty map when nvm isn't in play (no change to inherited env).
     */
    fun resolveEnv(): Map<String, String> = buildEnv(findNvmBinDir())

    /**
     * Builds the env overlay for a resolved nvm bin dir. Split out from
     * [resolveEnv] so it can be unit-tested with a synthetic dir.
     */
    internal fun buildEnv(nvmBinDir: File?): Map<String, String> {
        if (nvmBinDir == null) return emptyMap()
        val currentPath = System.getenv("PATH") ?: ""
        val newPath = if (currentPath.isEmpty())
            nvmBinDir.path
        else
            nvmBinDir.path + File.pathSeparator + currentPath
        return mapOf("PATH" to newPath)
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
        // nvm-installed npm (GUI-launched IDEs don't inherit shell PATH)
        findInNvm("npm")?.let { return it }
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

    /**
     * Resolves the nvm-managed node bin directory (`<nvm>/versions/node/<ver>/bin`).
     *
     * GUI-launched IDEs on macOS don't inherit the shell PATH, so an nvm-installed
     * npm/wave is invisible to `which`. nvm itself doesn't symlink a stable entry
     * outside its own tree (the `~/.nvm/versions/node/<ver>/bin` path only exists
     * once a node version is installed), so we resolve the active version directly
     * from nvm's own bookkeeping.
     *
     * Unix-only; returns null on Windows (this pass only handles Unix nvm).
     *
     * @param nvmRoot optional explicit nvm root (testing); defaults to `$NVM_DIR`
     *                or `~/.nvm`.
     */
    internal fun findNvmBinDir(nvmRoot: File? = null): File? {
        if (isWindows) return null
        val root = nvmRoot
            ?: System.getenv("NVM_DIR")?.takeIf { it.isNotEmpty() }?.let { File(it) }
            ?: File(System.getProperty("user.home"), ".nvm")
        if (!root.isDirectory) return null

        val versionsDir = File(root, "versions/node")
        if (!versionsDir.isDirectory) return null

        // Resolve the default alias file to pick the version to use.
        val defaultAlias = File(root, "alias/default").takeIf { it.isFile }
            ?.readText()?.trim()?.takeIf { it.isNotEmpty() }

        // A bare version string (optionally `v`-prefixed), e.g. `22` or `v22.14.0`.
        val versionPrefixRegex = Regex("""^v?\d+(\.\d+)*$""")
        if (defaultAlias != null && versionPrefixRegex.matches(defaultAlias)) {
            val prefix = if (defaultAlias.startsWith("v")) defaultAlias else "v$defaultAlias"
            val match = versionsDir.listFiles { f -> f.isDirectory && f.name.startsWith(prefix) }
                ?.maxWithOrNull(Comparator { a, b -> compareVersions(a.name, b.name) })
            match?.let { return File(it, "bin").takeIf { b -> b.isDirectory } }
            // alias pointed at a version prefix with no installed match → fall through
        }
        // `node` / `lts/*` aliases, missing/empty default file, or unmatched prefix:
        // fall back to the highest installed version.
        val best = versionsDir.listFiles { f -> f.isDirectory && f.name.startsWith("v") }
            ?.maxWithOrNull(Comparator { a, b -> compareVersions(a.name, b.name) })
            ?: return null
        return File(best, "bin").takeIf { it.isDirectory }
    }

    /** Locates `name` (e.g. `npm`, `wave`) inside the nvm bin dir, if present. */
    internal fun findInNvm(name: String, nvmRoot: File? = null): String? {
        val bin = findNvmBinDir(nvmRoot) ?: return null
        return File(bin, name).takeIf { it.exists() }?.path
    }

    /**
     * Compares two nvm-style version dir names (e.g. `v22.14.0` vs `v20.19.0`).
     * Leading `v` is stripped, segments compared numerically; missing/unparseable
     * segments count as 0. Returns negative/zero/positive like [Comparator].
     */
    internal fun compareVersions(a: String, b: String): Int {
        val sa = a.trimStart('v').split('.').map { it.toIntOrNull() ?: 0 }
        val sb = b.trimStart('v').split('.').map { it.toIntOrNull() ?: 0 }
        val n = maxOf(sa.size, sb.size)
        for (i in 0 until n) {
            val va = sa.getOrElse(i) { 0 }
            val vb = sb.getOrElse(i) { 0 }
            if (va != vb) return va - vb
        }
        return 0
    }

    private fun runCommand(vararg cmd: String): String {
        val proc = ProcessBuilder(cmd.toList()).apply {
            redirectErrorStream(true)
            environment().putAll(resolveEnv())
        }.start()
        val out = proc.inputStream.bufferedReader().readText()
        val code = proc.waitFor()
        if (code != 0) {
            throw StdioClientException("Command failed (${cmd.joinToString(" ")}): $out")
        }
        return out
    }
}
