package com.wave.jetbrains.stdio

import com.intellij.openapi.diagnostic.logger
import com.wave.jetbrains.util.WaveAppLog
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.apache.commons.compress.archivers.tar.TarArchiveInputStream
import org.apache.commons.compress.compressors.gzip.GzipCompressorInputStream
import java.io.ByteArrayInputStream
import java.io.File
import java.io.FileOutputStream
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.nio.charset.Charset
import java.time.Duration

/** Minimum Node.js major version required by `wave --stdio`. */
private const val MIN_NODE_MAJOR = 22

/**
 * Resolves the `wave` CLI for local sessions. The CLI 三件套
 * (`bin/wave-code.js` + `package.json` + `dist/bundle/wave.mjs`) is bundled
 * inside the plugin jar, copied to the user-writable `~/.wave/cli/jetbrains`
 * at runtime and executed with the customer's system Node.js (>= 22) — no
 * npm-global `wave-code` package, no version check/upgrade. Each frontend
 * (vscode/desktop/jetbrains) keeps its own subdir so different versions
 * never overwrite each other. The grep dependency `@vscode/ripgrep` is NOT
 * bundled; it is downloaded from npmmirror on first use into the shared
 * `~/.wave/cli/node_modules/` and cached.
 */
object BinaryResolver {
    private val LOG = logger<BinaryResolver>()
    const val NPM_REGISTRY = "https://registry.npmmirror.com"

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

    /** Optional callback invoked when a download/copy starts. */
    var onInstall: ((String) -> Unit)? = null

    /**
     * Platform dir of the rg binary package, e.g. `ripgrep-win32-x64`. Must
     * include the `ripgrep-` prefix: the npm package name is
     * `@vscode/ripgrep-<platform>-<arch>` and the extracted dir has to match it
     * so the cache check hits and wave.mjs's createRequire resolution works.
     */
    internal val rgPlatformDir: String by lazy {
        val os = System.getProperty("os.name").lowercase()
        val arch = System.getProperty("os.arch").lowercase()
        val platform = when {
            os.contains("win") -> "win32"
            os.contains("mac") -> "darwin"
            else -> "linux"
        }
        val nodeArch = when {
            arch == "x86_64" || arch == "amd64" -> "x64"
            arch == "aarch64" || arch == "arm64" -> "arm64"
            arch == "x86" || arch == "i386" || arch == "i686" -> "ia32"
            else -> arch
        }
        "ripgrep-$platform-$nodeArch"
    }

    /**
     * Resolve the runtime CLI entry (`~/.wave/cli/jetbrains/bin/wave-code.js`),
     * copying the bundled CLI on first use / version change and downloading
     * ripgrep on demand. `WAVE_CLI_PATH` env override wins (development).
     * @throws StdioClientException when the bundled CLI is missing (corrupt
     * install) or ripgrep cannot be downloaded.
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
        //    dir is read-only; version change re-copies but keeps the shared
        //    rg download in ~/.wave/cli/node_modules so it is never
        //    re-downloaded).
        val entry = prepareCli()

        // 2. `@vscode/ripgrep` is a top-level import of the bundled CLI —
        //    without it wave.mjs cannot even start. A failed download must
        //    therefore surface as a clear init error, not as an opaque
        //    MODULE_NOT_FOUND crash from the CLI child process.
        val rgOk = ensureRipgrep()
        if (!rgOk) {
            throw StdioClientException(
                "grep 搜索依赖（ripgrep）下载失败。请检查网络连接后重试。"
            )
        }
        cachedEntry = entry
        return entry
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
     * version differs (plugin upgrade). The cached rg download lives in the
     * shared `~/.wave/cli/node_modules/@vscode` dir — outside this per-end dir —
     * so an already-downloaded rg is never re-downloaded after an upgrade.
     * Returns the runtime entry path.
     * @throws StdioClientException when the bundled CLI itself is missing (corrupt install).
     */
    private fun prepareCli(): String {
        val entry = cliEntryPath()
        val needCopy =
            !File(entry).exists() ||
                bundledVersion() != runtimeVersion() ||
                !File(cliInstallDir(), "dist/bundle/wave.mjs").exists()

        if (needCopy) {
            onInstall?.invoke("正在准备内置 wave CLI…")
            // Replace the CLI files only — the cached rg download lives in the
            // shared ~/.wave/cli dir, so an upgrade never forces re-downloading it.
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

    /** Extract a classpath resource (bundled CLI) to [target]. */
    private fun copyResource(resource: String, target: File) {
        val stream = javaClass.classLoader.getResourceAsStream(resource)
            ?: throw StdioClientException("内置 CLI 缺失（$resource）。请重新安装插件。")
        target.parentFile?.mkdirs()
        stream.use { input -> FileOutputStream(target).use { output -> input.copyTo(output) } }
    }

    /** Version of the CLI bundled inside the plugin jar. */
    private fun bundledVersion(): String {
        return try {
            val stream = javaClass.classLoader.getResourceAsStream("wave-cli/package.json")
                ?: return ""
            val text = stream.bufferedReader().use { it.readText() }
            versionOf(text)
        } catch (_: Exception) {
            ""
        }
    }

    /** Version of the runtime CLI in ~/.wave/cli/jetbrains. */
    private fun runtimeVersion(): String {
        return try {
            val file = File(cliInstallDir(), "package.json")
            if (!file.isFile) return ""
            versionOf(file.readText())
        } catch (_: Exception) {
            ""
        }
    }

    private fun versionOf(packageJson: String): String {
        return try {
            Json.parseToJsonElement(packageJson).jsonObject["version"]?.jsonPrimitive?.content ?: ""
        } catch (_: Exception) {
            ""
        }
    }

    // ------------------------------------------------------------------
    // ripgrep download + cache
    // ------------------------------------------------------------------

    /**
     * Where the downloaded ripgrep packages live. Shared by all three
     * frontends (vscode/desktop/jetbrains) — deliberately outside the per-end
     * CLI dir so each end's CLI copy never wipes the cached rg download.
     */
    internal fun rgInstallDir(): File = File(cliRootDir(), "node_modules/@vscode")

    internal fun rgBinaryPath(): String =
        File(rgInstallDir(), "$rgPlatformDir/bin/rg${if (isWindows) ".exe" else ""}").path

    /**
     * Download the ripgrep JS wrapper and the current platform's rg binary into
     * the shared `~/.wave/cli/node_modules/@vscode` dir. Returns true when the
     * rg binary is in place. Never throws — a failed download only disables
     * the grep tool until a later launch retries (caller [resolveWaveBinary]
     * turns failure into a hard init error).
     */
    internal fun ensureRipgrep(): Boolean {
        if (File(rgBinaryPath()).exists()) return true
        return try {
            val pkgFile = File(cliInstallDir(), "package.json")
            if (!pkgFile.isFile) return false
            val pkg = Json.parseToJsonElement(pkgFile.readText()).jsonObject
            val rgRange = pkg["dependencies"]?.jsonObject?.get("@vscode/ripgrep")?.jsonPrimitive?.content
            if (rgRange == null) return true // CLI has no grep dependency — nothing to do.

            onInstall?.invoke("正在下载 grep 搜索依赖（ripgrep），请稍候…")
            val rgVersion = resolveRipgrepVersion(rgRange)
            val dir = rgInstallDir()
            // Each tarball strips its top `package/` dir, so extract into its own
            // package dir — the JS wrapper and the platform binary must NOT share
            // a directory (wave.mjs resolves `@vscode/ripgrep` via createRequire).
            val jsDir = File(dir, "ripgrep")
            val binDir = File(dir, rgPlatformDir)
            jsDir.mkdirs()
            binDir.mkdirs()
            extractTarball(downloadBuffer(tarballUrl("@vscode/ripgrep", rgVersion)), jsDir)
            extractTarball(downloadBuffer(tarballUrl("@vscode/$rgPlatformDir", rgVersion)), binDir)
            File(rgBinaryPath()).exists()
        } catch (e: Exception) {
            LOG.warn("[Wave] ripgrep 下载失败，grep 工具暂不可用：", e)
            WaveAppLog.warn("[Wave] ripgrep 下载失败，grep 工具暂不可用：${e.message}")
            false
        }
    }

    /** Highest version of `@vscode/ripgrep` satisfying the CLI's declared range. */
    private fun resolveRipgrepVersion(range: String): String {
        val meta = Json.parseToJsonElement(fetchText("$NPM_REGISTRY/@vscode/ripgrep")).jsonObject
        val versions = meta["versions"]?.jsonObject?.keys
            ?: throw StdioClientException("获取 @vscode/ripgrep 元数据失败")
        val best = versions
            .filter { satisfiesCaret(it, range) }
            .maxWithOrNull(Comparator { a, b -> compareVersions(a, b) })
            ?: throw StdioClientException("没有满足 $range 的 @vscode/ripgrep 版本")
        return best
    }

    /** Resolve the registry tarball URL for `pkg@version` (from package metadata). */
    private fun tarballUrl(pkg: String, version: String): String {
        val meta = Json.parseToJsonElement(fetchText("$NPM_REGISTRY/$pkg")).jsonObject
        val dist = meta["versions"]?.jsonObject?.get(version)?.jsonObject?.get("dist")?.jsonObject
        val url = dist?.get("tarball")?.jsonPrimitive?.content
            ?: throw StdioClientException("未找到 $pkg@$version 的下载地址")
        return url
    }

    private val http: HttpClient by lazy {
        HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(30))
            // npmmirror tarball URLs 302-redirect to the CDN — JDK HttpClient
            // does NOT follow redirects by default (desktop/vscode rely on
            // fetch's automatic redirect handling, so this must be explicit).
            .followRedirects(HttpClient.Redirect.NORMAL)
            .build()
    }

    private fun fetchText(url: String): String {
        val req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(60)).GET().build()
        val res = http.send(req, HttpResponse.BodyHandlers.ofString())
        if (res.statusCode() !in 200..299) {
            throw StdioClientException("获取 $url 失败（HTTP ${res.statusCode()}）")
        }
        return res.body()
    }

    private fun downloadBuffer(url: String): ByteArray {
        val req = HttpRequest.newBuilder(URI.create(url)).timeout(Duration.ofSeconds(120)).GET().build()
        val res = http.send(req, HttpResponse.BodyHandlers.ofByteArray())
        if (res.statusCode() !in 200..299) {
            throw StdioClientException("下载 $url 失败（HTTP ${res.statusCode()}）")
        }
        return res.body()
    }

    /** Extract a `.tar.gz` tarball, stripping the top `package/` dir. */
    internal fun extractTarball(bytes: ByteArray, destDir: File) {
        GzipCompressorInputStream(ByteArrayInputStream(bytes)).use { gz ->
            TarArchiveInputStream(gz).use { tar ->
                var entry = tar.nextEntry
                while (entry != null) {
                    // Each npm tarball has a single top-level `package/` dir — strip it.
                    val name = entry.name.substringAfter('/')
                    if (name.isNotEmpty()) {
                        val out = File(destDir, name)
                        if (entry.isDirectory) {
                            out.mkdirs()
                        } else {
                            out.parentFile?.mkdirs()
                            FileOutputStream(out).use { tar.transferTo(it) }
                        }
                    }
                    entry = tar.nextEntry
                }
            }
        }
    }

    /** True when [version] (pure x.y.z, no prerelease) satisfies a `^a.b.c` range. */
    internal fun satisfiesCaret(version: String, range: String): Boolean {
        val rm = Regex("""^\^(\d+)\.(\d+)\.(\d+)$""").find(range) ?: return false
        val vm = Regex("""^(\d+)\.(\d+)\.(\d+)$""").find(version) ?: return false
        val (rMajor, rMinor, rPatch) = rm.destructured
        val (vMajor, vMinor, vPatch) = vm.destructured
        if (vMajor != rMajor) return false
        val minor = vMinor.toInt(); val patch = vPatch.toInt()
        return minor > rMinor.toInt() || (minor == rMinor.toInt() && patch >= rPatch.toInt())
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
