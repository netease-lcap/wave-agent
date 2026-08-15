package com.wave.jetbrains.stdio

import com.intellij.openapi.diagnostic.logger
import java.io.File
import java.nio.charset.Charset

/** Minimum Node.js major version required by `wave --stdio`. */
private const val MIN_NODE_MAJOR = 22

/**
 * Resolves the `wave` binary at runtime: PATH → npm global bin → auto-install.
 * Mirrors packages/vscode/src/stdio/binaryResolver.ts.
 */
object BinaryResolver {
    private val LOG = logger<BinaryResolver>()
    private const val PACKAGE = "wave-code"
    const val NPM_REGISTRY = "https://registry.npmmirror.com"

    @Volatile
    private var cachedPath: String? = null
    @Volatile
    private var cachedLoginPath: String? = null
    @Volatile
    private var loginPathResolved = false

    private val isWindows = System.getProperty("os.name").lowercase().startsWith("win")
    private val waveName = if (isWindows) "wave.cmd" else "wave"
    private val lookupCmd = if (isWindows) "where" else "which"

    /** Optional callback invoked when an npm install/upgrade starts. */
    var onInstall: ((String) -> Unit)? = null

    fun resolveWaveBinary(targetVersion: String? = null): String {
        cachedPath?.let { return it }

        // 0. Verify Node.js >= 22 — wave --stdio requires it.
        checkNodeVersion()

        // 0a. nvm-installed binary (GUI-launched IDEs don't inherit shell PATH, so an
        // nvm-managed npm/wave install is invisible to `which` — probe nvm first).
        findInNvm(waveName)?.let { return cache(it) }

        // 1. PATH lookup
        findOnPath(waveName)?.let { return cache(it) }

        // 2. npm global bin
        val globalBin = getNpmGlobalBin()

        // 3. global bin direct
        val globalPath = File(globalBin, waveName).path
        if (File(globalPath).exists()) return cache(globalPath)

        // 4. auto-install — pin the exact version (same as the upgrade path).
        val npm = findNpm()
        val spec = if (targetVersion != null) "$PACKAGE@$targetVersion" else PACKAGE
        LOG.info("wave not found; running: \"$npm\" install -g $spec --registry=$NPM_REGISTRY")
        onInstall?.invoke(if (targetVersion != null) "正在安装 wave-code@$targetVersion，请稍候…" else "正在安装 wave-code，请稍候…")
        runCommand(npm, "install", "-g", spec, "--registry=$NPM_REGISTRY")

        // 5. recheck global bin
        if (File(globalPath).exists()) return cache(globalPath)

        // 6. recheck PATH
        findOnPath(waveName)?.let { return cache(it) }

        // 7. fail
        val manual = if (targetVersion != null) "$PACKAGE@$targetVersion" else PACKAGE
        throw StdioClientException("wave binary not found after installation. Install manually: npm install -g $manual --registry=$NPM_REGISTRY")
    }

    /**
     * Upgrade the globally-installed `wave-code` CLI to [targetVersion].
     * Resets the cached path on success and returns the freshly-resolved binary path.
     */
    fun upgradeWaveBinary(targetVersion: String): String {
        val npm = findNpm()
        LOG.info("Upgrading $PACKAGE to $targetVersion via: \"$npm\" install -g $PACKAGE@$targetVersion --registry=$NPM_REGISTRY")
        onInstall?.invoke("正在升级 wave-code 到 v$targetVersion，请稍候…")
        runCommand(npm, "install", "-g", "$PACKAGE@$targetVersion", "--registry=$NPM_REGISTRY")
        resetCache()
        return resolveWaveBinary()
    }

    /**
     * Runs `<binaryPath> -v` and returns the bare version string (e.g. "0.18.7"),
     * stripping a leading "v" if present. Returns null if the binary is
     * missing/corrupt or `-v` fails (callers treat null as "needs upgrade").
     * Uses a separate timed process rather than [runCommand] (which has no
     * timeout): if the process hangs it is destroyed and null is returned.
     */
    fun getCliVersion(binaryPath: String): String? {
        return try {
            val proc = ProcessBuilder(listOf(binaryPath, "-v")).apply {
                redirectErrorStream(true)
                environment().putAll(resolveEnv())
            }.start()
            val out = proc.inputStream.bufferedReader().readText()
            if (!proc.waitFor(5, java.util.concurrent.TimeUnit.SECONDS)) {
                proc.destroyForcibly()
                return null
            }
            val line = out.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() }
                ?: return null
            line.trimStart('v')
        } catch (_: Exception) {
            null
        }
    }

    /**
     * Ensure the wave CLI exists and its version is >= [targetVersion]. Returns the
     * (possibly upgraded) binary path. Mirrors packages/vscode/src/stdio/binaryResolver.ts
     * ensureCliUpToDate.
     */
    fun ensureCliUpToDate(targetVersion: String): String {
        val binaryPath = resolveWaveBinary(targetVersion)
        val current = getCliVersion(binaryPath)
        if (current != null) {
            val cmp = try { compareVersions(current, targetVersion) } catch (_: Exception) { 0 }
            if (cmp >= 0) return binaryPath
        }
        // current is null (corrupt) or older than target → upgrade.
        return upgradeWaveBinary(targetVersion)
    }

    /**
     * Environment variables to inject into spawned `wave`/`npm` processes.
     *
     * GUI-launched IDEs inherit a minimal launchd PATH and never source the
     * shell profile, so homebrew, nvm, pnpm, and user-customized bin dirs are
     * invisible to `System.getenv("PATH")` and the `#!/usr/bin/env node`
     * shebang can't resolve `node`. We inject the login-shell PATH, which
     * rebuilds the full PATH (including the nvm bin dir the shebang needs).
     * Returns an empty map when there's nothing to inject.
     */
    fun resolveEnv(): Map<String, String> = buildEnv(resolveLoginShellPath())

    /**
     * Assembles a deduped, ordered PATH: login-shell PATH first (the
     * comprehensive set — homebrew, nvm, pnpm, user customizations), then the
     * inherited PATH as a base. Split out from [resolveEnv] so it can be
     * unit-tested with synthetic inputs. [currentPath] defaults to the live
     * env so production callers don't need to pass it, while tests can inject
     * a fixed value (or null to simulate unset).
     */
    internal fun buildEnv(
        loginPath: String? = null,
        currentPath: String? = System.getenv("PATH"),
    ): Map<String, String> {
        val segments = linkedSetOf<String>()
        loginPath
            ?.takeIf { it.isNotEmpty() }
            ?.split(File.pathSeparator)
            ?.forEach { if (it.isNotEmpty()) segments.add(it) }
        currentPath
            ?.takeIf { it.isNotEmpty() }
            ?.split(File.pathSeparator)
            ?.forEach { if (it.isNotEmpty()) segments.add(it) }
        if (segments.isEmpty()) return emptyMap()
        return mapOf("PATH" to segments.joinToString(File.pathSeparator))
    }

    /**
     * Spawns the user's login shell once and captures the PATH it produces
     * after sourcing the profile (login + interactive). GUI-launched IDEs
     * inherit a minimal launchd PATH and never source `~/.zprofile`/`~/.zshrc`,
     * so homebrew, nvm, pnpm, and user-customized bin dirs are invisible to
     * `System.getenv("PATH")`. The login shell rebuilds the full PATH.
     *
     * Result is cached for the IDE session. Returns null on Windows or if the
     * probe fails.
     *
     * Uses [runCommandRaw] (not [runCommand]) to avoid infinite recursion:
     * `runCommand` injects [resolveEnv], which calls this method.
     */
    internal fun resolveLoginShellPath(): String? {
        if (loginPathResolved) return cachedLoginPath
        loginPathResolved = true
        if (isWindows) return null
        val shell = System.getenv("SHELL")
            ?.takeIf { it.isNotEmpty() && File(it).exists() }
            ?: listOf("/bin/zsh", "/bin/bash").firstOrNull { File(it).exists() }
            ?: return null
        cachedLoginPath = try {
            // -l: login (sources profile), -i: interactive (sources rc, where
            // nvm/brew/pnpm init usually live), -c: run command and exit.
            // Take the last non-empty line in case rc files print banners.
            val out = runCommandRaw(shell, "-lic", "echo \$PATH")
            out.lineSequence().map { it.trim() }.lastOrNull { it.isNotEmpty() }
        } catch (_: Exception) {
            null
        }
        return cachedLoginPath
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
            pickExecutableLine(out)
        } catch (e: Exception) {
            null
        }
    }

    /**
     * Pick the executable line from `which`/`where` output. On Windows `where`
     * lists the extensionless bash launcher first (e.g. `C:\Program Files\nodejs\npm`)
     * followed by `npm.cmd` — CreateProcess cannot execute the bash launcher, so
     * prefer `.cmd`/`.exe`/`.bat` lines. [windows] is injectable for tests.
     */
    internal fun pickExecutableLine(lookupOutput: String, windows: Boolean = isWindows): String? {
        val lines = lookupOutput.lineSequence().map { it.trim() }.filter { it.isNotEmpty() }.toList()
        if (windows) {
            lines.firstOrNull {
                val l = it.lowercase()
                l.endsWith(".cmd") || l.endsWith(".exe") || l.endsWith(".bat")
            }?.let { return it }
        }
        return lines.firstOrNull()
    }

    /**
     * Find `node` executable: PATH first, then nvm, then java.home parent
     * (the JBR Node that ships with some IDEs).
     */
    private fun findNode(): String {
        try {
            val out = runCommand(lookupCmd, "node")
            out.lineSequence().firstOrNull()?.trim()?.takeIf { it.isNotEmpty() }?.let { return it }
        } catch (_: Exception) {}
        findInNvm("node")?.let { return it }
        // JBR-shipped node lives in jbr/bin/node relative to the IDE install.
        val javaHome = System.getProperty("java.home") ?: throw StdioClientException(
            "未检测到 Node.js/npm。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。"
        )
        val nodeDir = File(javaHome).parent ?: throw StdioClientException(
            "未检测到 Node.js/npm。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。"
        )
        val candidates: List<File> = if (isWindows) {
            listOf(File(nodeDir, "node.exe"), File(nodeDir, "node"))
        } else {
            listOf(File(nodeDir, "node"), File(File(nodeDir, ".."), "bin").let { File(it, "node") })
        }
        candidates.firstOrNull { it.exists() }?.path?.let { return it }
        throw StdioClientException(
            "未检测到 Node.js/npm。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。"
        )
    }

    /**
     * Check that the system Node.js is >= [MIN_NODE_MAJOR].
     * @throws StdioClientException if the version is below the minimum or cannot be determined.
     */
    private fun checkNodeVersion() {
        val node = findNode()
        val output = try {
            runCommandRaw(node, "-v").trim()
        } catch (e: Exception) {
            throw StdioClientException(
                "未检测到 Node.js/npm。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。"
            )
        }
        val match = Regex("^v?(\\d+)").find(output)
        val major = match?.groupValues?.get(1)?.toIntOrNull()
        if (major == null) {
            throw StdioClientException(
                "无法确定 Node.js 版本（输出: $output）。请安装 Node.js >= $MIN_NODE_MAJOR (https://nodejs.org)，然后重启编辑器。"
            )
        }
        if (major < MIN_NODE_MAJOR) {
            throw StdioClientException(
                "Node.js 版本过低（当前 v$major，需要 >= $MIN_NODE_MAJOR）。请升级 Node.js (https://nodejs.org)，然后重启编辑器。"
            )
        }
    }

    private fun findNpm(): String {
        // which/where npm
        try {
            val out = runCommand(lookupCmd, "npm")
            pickExecutableLine(out)?.let { return it }
        } catch (_: Exception) {}
        // nvm-installed npm (GUI-launched IDEs don't inherit shell PATH)
        findInNvm("npm")?.let { return it }
        // fallback: node dir
        val javaHome = System.getProperty("java.home") ?: throw StdioClientException(
            "未检测到 Node.js/npm。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。"
        )
        val nodeDir = File(javaHome).parent ?: throw StdioClientException(
            "未检测到 Node.js/npm。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。"
        )
        val candidates: List<File> = if (isWindows) {
            listOf(File(nodeDir, "npm.cmd"), File(nodeDir, "npm"))
        } else {
            listOf(File(nodeDir, "npm"), File(File(nodeDir, ".."), "bin").let { File(it, "npm") })
        }
        candidates.firstOrNull { it.exists() }?.path?.let { return it }
        throw StdioClientException(
            "未检测到 Node.js/npm。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。"
        )
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
    fun compareVersions(a: String, b: String): Int {
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

    /**
     * Decode output of cmd.exe builtins (`where`, `which`, `npm prefix -g`). On
     * Chinese Windows those write the system OEM code page (CP936/GBK); decoding
     * GBK bytes as UTF-8 corrupts non-ASCII path segments (`C:\Users\刘一奇\...`
     * → U+FFFD), and spawning the corrupted path fails with ERROR_PATH_NOT_FOUND.
     * Try UTF-8 first (covers non-Windows and chcp 65001), fall back to GBK on
     * U+FFFD — same policy as packages/vscode and packages/desktop binaryResolver.
     */
    internal fun decodeCommandOutput(bytes: ByteArray): String {
        val utf8 = String(bytes, Charsets.UTF_8)
        if ('\uFFFD' !in utf8) return utf8
        return try {
            String(bytes, Charset.forName("GBK"))
        } catch (_: Exception) {
            utf8
        }
    }

    /**
     * Reads a child process' combined stdout/stderr as text via
     * [decodeCommandOutput]. Explicitly decodes the raw bytes (not the JVM
     * default charset) so `where`/`npm prefix -g` output survives on
     * non-UTF-8 Windows systems.
     */
    internal fun readProcessOutput(proc: Process): String {
        return proc.inputStream.use { decodeCommandOutput(it.readBytes()) }
    }

    /** Runs a command without injecting [resolveEnv] — used by the login-shell
     *  PATH probe to avoid infinite recursion. Inherits the parent env as-is. */
    private fun runCommandRaw(vararg cmd: String): String {
        val proc = ProcessBuilder(cmd.toList()).apply {
            redirectErrorStream(true)
        }.start()
        val out = readProcessOutput(proc)
        val code = proc.waitFor()
        if (code != 0) {
            throw StdioClientException("Command failed (${cmd.joinToString(" ")}): $out")
        }
        return out
    }

    private fun runCommand(vararg cmd: String): String {
        val proc = ProcessBuilder(cmd.toList()).apply {
            redirectErrorStream(true)
            environment().putAll(resolveEnv())
        }.start()
        val out = readProcessOutput(proc)
        val code = proc.waitFor()
        if (code != 0) {
            throw StdioClientException("Command failed (${cmd.joinToString(" ")}): $out")
        }
        return out
    }
}
