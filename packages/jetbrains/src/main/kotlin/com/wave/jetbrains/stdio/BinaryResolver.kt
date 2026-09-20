package com.wave.jetbrains.stdio

import java.io.File
import java.io.FileOutputStream
import java.nio.charset.Charset
import java.security.MessageDigest
import java.util.HexFormat

/** Minimum Node.js major version required by `wave --stdio`. */
private const val MIN_NODE_MAJOR = 22

/**
 * Resolves the `wave` CLI for local sessions. The CLI 三件套
 * (`bin/wave-code.js` + `package.json` + `dist/bundle/wave.mjs`) is bundled
 * inside the plugin jar, copied to the user-writable `~/.wave/cli/jetbrains`
 * at runtime and executed with the customer's system Node.js (>= 22) — no
 * npm-global `wave-code` package, no version check/upgrade. Whether to copy
 * is decided by content: the runtime `dist/bundle/wave.mjs` is re-copied
 * only when its sha256 differs from the bundled one — a version string cannot
 * be trusted as "same CLI" (plugin reinstalls and GUI-only releases can ship
 * new bytes without bumping the version). Each frontend
 * (vscode/desktop/jetbrains) keeps its own subdir so different versions
 * never overwrite each other. Runtime dependencies (`sharp` for images,
 * `@vscode/ripgrep` for grep) are NOT bundled: the CLI installs them itself on
 * startup into the shared `~/.wave/cli/node_modules/`, and a failed download
 * only degrades the tool that needs it — it never blocks startup.
 */
object BinaryResolver {
    @Volatile
    private var cachedEntry: String? = null
    @Volatile
    private var cachedNode: String? = null
    @Volatile
    private var cachedLoginPath: String? = null
    @Volatile
    private var loginPathResolved = false

    private val isWindows = System.getProperty("os.name").lowercase().startsWith("win")
    private val lookupCmd = if (isWindows) "where" else "which"

    /** Optional callback invoked when the bundled CLI is copied. */
    var onInstall: ((String) -> Unit)? = null

    /**
     * Resolve the runtime CLI entry (`~/.wave/cli/jetbrains/bin/wave-code.js`),
     * copying the bundled CLI on first use / version change. `WAVE_CLI_PATH` env
     * override wins (development).
     * @throws StdioClientException when the bundled CLI is missing (corrupt
     * install).
     */
    fun resolveWaveBinary(): String {
        cachedEntry?.let { return it }

        // WAVE_CLI_PATH override (development) — mirrors desktop/vscode.
        System.getenv("WAVE_CLI_PATH")
            ?.takeIf { File(it).exists() }
            ?.let { cachedEntry = it; return it }

        // 0. Node.js >= 22 is required to execute the bundled CLI.
        checkNodeVersion()

        // 1. Copy the bundled CLI into ~/.wave/cli/jetbrains (plugin install
        //    dir is read-only; a changed bundle re-copies but keeps the runtime
        //    dependencies the CLI installed in ~/.wave/cli/node_modules).
        cachedEntry = prepareCli()
        return cachedEntry!!
    }

    /**
     * Resolve the `node` executable used to run the bundled CLI: PATH first,
     * then nvm, then java.home parent (the JBR Node that ships with some IDEs).
     * Result cached for the IDE session.
     */
    fun findNode(): String {
        cachedNode?.let { return it }
        val node = try {
            val out = runCommand(lookupCmd, "node")
            pickExecutableLine(out)
        } catch (_: Exception) { null } ?: findInNvm("node") ?: findJbrNode()
        cachedNode = node
        return node
    }

    private fun findJbrNode(): String {
        val javaHome = System.getProperty("java.home")
        val nodeDir = javaHome?.let { File(it).parent }
        val candidates: List<File?> = if (isWindows) {
            listOf(nodeDir?.let { File(it, "node.exe") }, nodeDir?.let { File(it, "node") })
        } else {
            listOf(
                nodeDir?.let { File(it, "node") },
                nodeDir?.let { File(File(it, ".."), "bin").let { File(it, "node") } },
            )
        }
        candidates.filterNotNull().firstOrNull { it.exists() }?.path?.let { return it }
        throw StdioClientException(
            "未检测到 Node.js。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。"
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
                "未检测到 Node.js。请先安装 Node.js (https://nodejs.org)，然后重启编辑器。"
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

    // ------------------------------------------------------------------
    // Bundled CLI → ~/.wave/cli/jetbrains
    // ------------------------------------------------------------------

    /** Shared root dir for all CLI runtime data under the user home. */
    private fun cliRootDir(): File = File(System.getProperty("user.home"), ".wave/cli")

    /**
     * Per-end runtime CLI dir: `~/.wave/cli/jetbrains` — vscode/desktop keep
     * their own subdirs so they never overwrite each other's CLI copy.
     */
    internal fun cliInstallDir(): File = File(cliRootDir(), "jetbrains")

    private fun cliEntryPath(): String = File(cliInstallDir(), "bin/wave-code.js").path

    /**
     * Copy the bundled CLI into the runtime dir when missing or when the bundled
     * bundle bytes differ from the runtime copy. Content comparison instead of a
     * version-string check: plugin reinstalls refresh the plugin without bumping
     * its version, so an unchanged version number cannot be trusted as "same
     * CLI". The runtime dependencies the CLI installs itself live in the shared
     * `~/.wave/cli/node_modules` dir — outside this per-end dir — so an upgrade
     * never forces re-downloading them.
     * Returns the runtime entry path.
     * @throws StdioClientException when the bundled CLI itself is missing (corrupt install).
     */
    private fun prepareCli(): String {
        val entry = cliEntryPath()
        val runtimeBundle = File(cliInstallDir(), "dist/bundle/wave.mjs")
        val needCopy =
            !File(entry).exists() ||
                !runtimeBundle.exists() ||
                resourceHash("wave-cli/dist/bundle/wave.mjs") != fileHash(runtimeBundle)

        if (needCopy) {
            onInstall?.invoke("正在准备内置 wave CLI…")
            // Replace the CLI files only — the runtime dependencies the CLI
            // installed live in the shared ~/.wave/cli dir, so an upgrade never
            // forces re-downloading them.
            File(cliInstallDir(), "dist").deleteRecursively()
            File(entry).delete()
            File(cliInstallDir(), "package.json").delete()
            cliInstallDir().mkdirs()
            copyResource("wave-cli/bin/wave-code.js", File(cliInstallDir(), "bin/wave-code.js"))
            copyResource("wave-cli/package.json", File(cliInstallDir(), "package.json"))
            copyResource("wave-cli/dist/bundle/wave.mjs", File(cliInstallDir(), "dist/bundle/wave.mjs"))
        }
        return entry
    }

    /** sha256 hex of a classpath resource's bytes, or "" when unavailable. */
    private fun resourceHash(resource: String): String {
        return try {
            val stream = javaClass.classLoader.getResourceAsStream(resource) ?: return ""
            sha256Hex(stream.use { it.readBytes() })
        } catch (_: Exception) {
            ""
        }
    }

    /** sha256 hex of a file's bytes, or "" when missing/unreadable. */
    private fun fileHash(file: File): String {
        if (!file.isFile) return ""
        return try {
            sha256Hex(file.inputStream().use { it.readBytes() })
        } catch (_: Exception) {
            ""
        }
    }

    private fun sha256Hex(bytes: ByteArray): String =
        HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))

    /** Extract a classpath resource (bundled CLI) to [target]. */
    private fun copyResource(resource: String, target: File) {
        val stream = javaClass.classLoader.getResourceAsStream(resource)
            ?: throw StdioClientException("内置 CLI 缺失（$resource）。请重新安装插件。")
        target.parentFile?.mkdirs()
        stream.use { input -> FileOutputStream(target).use { output -> input.copyTo(output) } }
    }

    // ------------------------------------------------------------------
    // Environment for spawned processes (login-shell PATH)
    // ------------------------------------------------------------------

    /**
     * Environment variables to inject into spawned `node` processes.
     *
     * GUI-launched IDEs inherit a minimal launchd PATH and never source the
     * shell profile, so homebrew, nvm, pnpm, and user-customized bin dirs are
     * invisible to `System.getenv("PATH")`. We inject the login-shell PATH,
     * which rebuilds the full PATH (so the CLI child can resolve tools like
     * git). Returns an empty map when there's nothing to inject.
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
     * Result is cached for the IDE session. Returns null if the probe fails.
     *
     * Uses [runCommandRaw] (not [runCommand]) to avoid infinite recursion:
     * `runCommand` injects [resolveEnv], which calls this method.
     */
    internal fun resolveLoginShellPath(): String? {
        if (loginPathResolved) return cachedLoginPath
        loginPathResolved = true
        if (isWindows) {
            // Windows: GUI-launched IDEs never source the Git Bash profile, so
            // bash commands would miss PATH additions from ~/.bashrc. Probe the
            // login PATH once and convert it back to Windows form via cygpath
            // so cmd.exe and Node subprocesses can still resolve tools.
            val gitBash = resolveGitBashPath() ?: return null
            cachedLoginPath = try {
                val out = runCommandRaw(gitBash, "-lic", "cygpath -pw \"\$PATH\"")
                out.lineSequence().map { it.trim() }.lastOrNull { it.isNotEmpty() }
            } catch (_: Exception) {
                null
            }
            return cachedLoginPath
        }
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

    /**
     * Locate the Git Bash `bash.exe` on Windows (mirrors the agent-sdk shell
     * resolver's resolveWindowsShell and packages/vscode loginPath):
     *   1. WAVE_GIT_BASH_PATH env var override
     *   2. Infer from `where git`: <git>/cmd/git.exe → <git>/bin/bash.exe
     *   3. Common install paths (Program Files, Program Files (x86),
     *      %LOCALAPPDATA%\Programs\Git)
     * Returns null on non-Windows or when no Git Bash can be found.
     */
    internal fun resolveGitBashPath(): String? {
        System.getenv("WAVE_GIT_BASH_PATH")
            ?.takeIf { it.isNotEmpty() }
            ?.let { return it }
        try {
            val out = runCommandRaw(lookupCmd, "git")
            val gitExe = out.lineSequence().map { it.trim() }.firstOrNull { it.isNotEmpty() }
            if (gitExe != null) {
                inferGitBashFromGitExe(gitExe)?.takeIf { File(it).isFile }?.let { return it }
            }
        } catch (_: Exception) {
            // git not on PATH — fall through to common install paths
        }
        val candidates = mutableListOf(
            "C:\\Program Files\\Git\\bin\\bash.exe",
            "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
        )
        System.getenv("LOCALAPPDATA")?.takeIf { it.isNotEmpty() }?.let {
            candidates.add(File(it, "Programs\\Git\\bin\\bash.exe").path)
        }
        return candidates.firstOrNull { File(it).isFile }
    }

    /**
     * Infer the Git Bash path from a `where git` result:
     * `<git>/cmd/git.exe` → `<git>/bin/bash.exe`. Pure path manipulation
     * (no existence check) so it can be unit-tested with synthetic inputs.
     */
    internal fun inferGitBashFromGitExe(gitExe: String): String? {
        val bash = File(gitExe).parentFile?.parentFile?.resolve("bin/bash.exe") ?: return null
        return bash.path
    }

    /** Reset caches (testing). */
    fun resetCache() {
        cachedEntry = null
        cachedNode = null
    }

    /**
     * Resolves the nvm-managed node bin directory (`<nvm>/versions/node/<ver>/bin`).
     *
     * GUI-launched IDEs on macOS don't inherit the shell PATH, so an nvm-installed
     * node is invisible to `which`. nvm itself doesn't symlink a stable entry
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

    /** Locates `name` inside the nvm bin dir, if present. */
    internal fun findInNvm(name: String, nvmRoot: File? = null): String? {
        val bin = findNvmBinDir(nvmRoot) ?: return null
        return File(bin, name).takeIf { it.exists() }?.path
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
     * Compares two version strings (e.g. `v22.14.0` vs `v20.19.0`).
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

    /**
     * Decode output of cmd.exe builtins (`where`, `which`). On
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
     * default charset) so `where` output survives on non-UTF-8 Windows systems.
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
