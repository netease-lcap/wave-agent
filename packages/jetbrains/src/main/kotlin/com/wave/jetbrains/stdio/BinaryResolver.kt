package com.wave.jetbrains.stdio

import com.wave.jetbrains.util.WaveAppLog
import java.io.File
import java.io.FileOutputStream
import java.nio.charset.Charset
import java.security.MessageDigest
import java.util.HexFormat
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Resolves the `wave` CLI for local sessions. The CLI 三件套
 * (`bin/wave-code.js` + `package.json` + `dist/bundle/wave.mjs`) is bundled
 * inside the plugin jar, copied to the user-writable `~/.wave/cli/jetbrains`
 * at runtime and executed with the Node.js runtime Wave manages for itself
 * ([ManagedRuntime]) — no npm-global `wave-code` package, no system Node.js
 * probe, no version check/upgrade of the CLI. Whether to copy
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

    /**
     * The one login-shell environment probe of this IDE process. It yields a
     * process-wide environment delta (not per-project or per-session state), so
     * every project and every spawn shares the same result.
     */
    @Volatile
    private var probe: CompletableFuture<Map<String, String>>? = null

    /** Single-threaded and daemon: one background probe, never holds the JVM open. */
    private val probeExecutor: ExecutorService = Executors.newSingleThreadExecutor { r ->
        Thread(r, "wave-login-shell-probe").apply { isDaemon = true }
    }

    /** Drains the probe child's stdout — must not share [probeExecutor], which is blocked waiting for it. */
    private val probeReaderExecutor: ExecutorService = Executors.newCachedThreadPool { r ->
        Thread(r, "wave-login-shell-probe-reader").apply { isDaemon = true }
    }

    /**
     * Probe budget, shared by all three hosts (the SDK module used by desktop and
     * VS Code hard-codes the same numbers — keep them in step):
     * one attempt gets 4s, two attempts plus backoff make ~8.4s worst case, and
     * that is also the longest a CLI spawn waits ([PROBE_AWAIT_MS]).
     */
    private const val PROBE_TIMEOUT_MS = 4_000L

    /** Reading the drained output after the child exited — it is already in memory by then. */
    private const val READ_TIMEOUT_MS = 1_000L

    /**
     * Retries stay at two: a transient spawn/timeout failure gets one more
     * chance, while a missing shell or unparseable output fails identically on
     * the retry. The bound is what keeps the background thread short-lived.
     */
    private const val PROBE_MAX_ATTEMPTS = 2
    private const val PROBE_RETRY_BACKOFF_MS = 200L

    /**
     * How long a CLI spawn may wait for the probe: the full probe budget, so the
     * wait cannot cut off an attempt that is still within its own timeout (it
     * usually finished during IDE startup, so this costs nothing).
     */
    private const val PROBE_AWAIT_MS = 9_000L

    private val isWindows = System.getProperty("os.name").lowercase().startsWith("win")
    private val lookupCmd = if (isWindows) "where" else "which"

    /**
     * Optional callback invoked with a [StartupStages] id whenever this resolver
     * (or [ManagedRuntime] on its behalf) has to copy or download something —
     * the panel turns it into the one line under the loading animation
     * (spec ui/stdio-transport.md「首次启动的进度文案」). Nothing is reported
     * when everything is already on disk.
     */
    var onStage: ((String) -> Unit)? = null

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

        // 1. Copy the bundled CLI into ~/.wave/cli/jetbrains (plugin install
        //    dir is read-only; a changed bundle re-copies but keeps the runtime
        //    dependencies the CLI installed in ~/.wave/cli/node_modules).
        cachedEntry = prepareCli()
        return cachedEntry!!
    }

    /**
     * Resolve the `node` that runs the bundled CLI: the managed runtime under
     * `~/.wave/runtime/node` (downloaded on first use), or `WAVE_NODE_PATH`.
     *
     * The JVM gives us nothing to borrow — unlike VS Code's extension host and
     * the desktop app's Electron, which both hand their own executable to the
     * CLI — so the plugin prepares its own runtime instead of requiring the
     * customer to install Node.js ≥ 22 on every machine (spec:
     * ui/stdio-transport.md「JB 插件自动获取托管 Node 运行时」). No system-node
     * probe here on purpose: one runtime, one version, reproducible everywhere.
     * Result cached for the IDE session.
     */
    fun resolveNode(): String = ManagedRuntime.nodePath { onStage?.invoke(it) }

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
            onStage?.invoke(StartupStages.SYNCING_CLI)
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
    // Environment for spawned processes (login-shell environment)
    // ------------------------------------------------------------------

    /**
     * Environment delta to inject into the spawned `wave --stdio` child — and
     * thereby into everything the CLI spawns (`Bash` tool commands, background
     * tasks, MCP servers, hooks, git, LSP servers, nothing of which goes through
     * a shell): the user's login-shell environment, adopted by whitelist +
     * no-overwrite (see [LoginShellEnv.adopt]; spec core/bash-tools.md
     * 「用户故事：登录 shell 环境注入」).
     *
     * Waits for the background probe started at project startup
     * ([warmupLoginShellEnv]) for at most [PROBE_AWAIT_MS]. If the probe is still
     * running or failed, the delta is empty and the child keeps the inherited
     * environment — the same degradation as before, plus one diagnostic log line.
     * Never throws: a missing login-shell environment must not make a session
     * unusable.
     */
    fun resolveEnv(): Map<String, String> {
        val probed = awaitProbedEnv()
        if (probed.isEmpty()) return emptyMap()
        val adopted = LoginShellEnv.adopt(probed, System.getenv(), isWindows)
        if (adopted.isNotEmpty()) {
            // Key names only — values here commonly carry proxy credentials.
            WaveAppLog.info("login-shell env adopted: ${adopted.keys.sorted().joinToString(", ")}")
        }
        return adopted
    }

    /**
     * Start the login-shell environment probe in the background. Called from
     * [LoginShellEnvStartupActivity] right after a project opens, so the probe
     * (up to [PROBE_TIMEOUT_MS] per attempt) runs while the IDE is still busy and
     * has normally finished long before the first session spawns. Idempotent,
     * non-blocking, never throws, never reports to the UI.
     */
    fun warmupLoginShellEnv() {
        probeFuture()
    }

    private fun probeFuture(): CompletableFuture<Map<String, String>> {
        probe?.let { return it }
        synchronized(this) {
            probe?.let { return it }
            return CompletableFuture
                .supplyAsync({ probeLoginShellEnv() }, probeExecutor)
                .also { probe = it }
        }
    }

    private fun awaitProbedEnv(): Map<String, String> {
        return try {
            probeFuture().get(PROBE_AWAIT_MS, TimeUnit.MILLISECONDS)
        } catch (e: TimeoutException) {
            WaveAppLog.warn(
                "login-shell env probe still running after ${PROBE_AWAIT_MS}ms — " +
                    "spawning with the inherited environment"
            )
            emptyMap()
        } catch (e: Exception) {
            // The probe logs its own failure; a broken future stays silent here.
            emptyMap()
        }
    }

    /**
     * Probe the login shell for its **full** environment, not just PATH
     * (spec scenario 2). Returns an empty map on failure — never throws, so the
     * background task can only ever degrade.
     */
    private fun probeLoginShellEnv(): Map<String, String> {
        var backoff = PROBE_RETRY_BACKOFF_MS
        var lastError: String? = null
        for (attempt in 1..PROBE_MAX_ATTEMPTS) {
            val result = try {
                if (isWindows) probeWindowsLoginPath() else probePosixLoginEnv()
            } catch (e: Exception) {
                lastError = e.toString()
                null
            }
            if (!result.isNullOrEmpty()) return result
            if (attempt < PROBE_MAX_ATTEMPTS) {
                try {
                    Thread.sleep(backoff)
                } catch (_: InterruptedException) {
                    Thread.currentThread().interrupt()
                    break
                }
                backoff *= 2
            }
        }
        WaveAppLog.warn(
            "login-shell env probe failed after $PROBE_MAX_ATTEMPTS attempt(s), " +
                "falling back to the inherited environment" + (lastError?.let { ": $it" } ?: "")
        )
        return emptyMap()
    }

    /**
     * macOS/Linux probe: one login + interactive shell run that prints its whole
     * environment. `-l` sources the profile, `-i` picks up interactive-only
     * exports (nvm/pnpm/brew init usually live in the rc file).
     *
     * The markers make the output independent of whatever the rc files print
     * (banners, compinit warnings, "no job control in this shell"), and `env -0`
     * keeps multi-line values intact — where it is unsupported the `|| env`
     * branch prints the same variables line-separated instead.
     */
    private fun probePosixLoginEnv(): Map<String, String>? {
        val shell = LoginShellEnv.selectPosixShell(System.getenv("SHELL"), homeDir())
        if (shell == null) {
            WaveAppLog.warn(
                "login-shell env probe: no shell found (\$SHELL, /bin/zsh, /bin/bash, /bin/sh all unusable)"
            )
            return null
        }
        val nonce = "WAVE_LOGIN_SHELL_" + UUID.randomUUID().toString().replace("-", "")
        val endMarker = "${nonce}_END"
        val command = "echo \"$nonce\"; env -0 && echo \"$endMarker\" || env"
        val output = runProbe(
            listOf(shell, "-l", "-i", "-c", command),
            LoginShellEnv.buildProbeEnv(System.getenv()),
            replaceEnv = true,
        ) ?: return null
        val parsed = LoginShellEnv.parseProbeEnv(output, nonce, endMarker)
        if (parsed == null) {
            WaveAppLog.warn("login-shell env probe: $shell printed no start marker, output unparseable")
            return null
        }
        if (!parsed.nulDelimited) {
            WaveAppLog.info("login-shell env probe: `env -0` unavailable in $shell, parsed line-separated output")
        }
        return LoginShellEnv.sanitizeProbedEnv(parsed.env).ifEmpty { null }
    }

    /**
     * Windows probe, unchanged in shape: Git Bash `-lic 'cygpath -pw "$PATH"'`,
     * PATH only, converted back to native Windows form (spec scenario 11 — Git
     * Bash's variable semantics do not match native Windows processes, so full
     * adoption is out of scope here).
     */
    private fun probeWindowsLoginPath(): Map<String, String>? {
        val gitBash = resolveGitBashPath() ?: run {
            WaveAppLog.warn("login-shell env probe: Git Bash not found")
            return null
        }
        val output = runProbe(
            listOf(gitBash, "-lic", "cygpath -pw \"\$PATH\""),
            LoginShellEnv.NOISE_ENV,
            replaceEnv = false,
        ) ?: return null
        val path = output.lineSequence().map { it.trim() }.lastOrNull { it.isNotEmpty() }
        // `cygpath -pw` always emits `;`-separated Windows form; anything else is
        // an error message from the shell, which must not become the PATH.
        if (path.isNullOrEmpty() || ';' !in path) return null
        return mapOf("PATH" to path)
    }

    /**
     * Run a probe child and return its combined stdout/stderr, or null on spawn
     * failure / timeout.
     *
     * [replaceEnv] decides whether [env] *replaces* the inherited environment
     * (POSIX: the minimal probe environment of spec scenario 5) or is only
     * overlaid on it (Windows, where `bash.exe` needs `SYSTEMROOT` and friends to
     * start at all).
     *
     * stdout is drained on another thread: an environment dump can exceed the
     * pipe buffer, and `waitFor` would then deadlock against a blocked child.
     */
    private fun runProbe(cmd: List<String>, env: Map<String, String>, replaceEnv: Boolean): String? {
        val process = try {
            ProcessBuilder(cmd).apply {
                redirectErrorStream(true)
                if (replaceEnv) environment().clear()
                environment().putAll(env)
            }.start()
        } catch (e: Exception) {
            WaveAppLog.warn("login-shell env probe: cannot start ${cmd.firstOrNull()}: $e")
            return null
        }
        // An interactive shell may wait for input while stdin stays an open pipe.
        runCatching { process.outputStream.close() }
        val reader = CompletableFuture.supplyAsync(
            { process.inputStream.use { decodeCommandOutput(it.readBytes()) } },
            probeReaderExecutor,
        )
        return try {
            if (!process.waitFor(PROBE_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
                process.destroyForcibly()
                reader.cancel(true)
                WaveAppLog.warn("login-shell env probe: ${cmd.firstOrNull()} timed out after ${PROBE_TIMEOUT_MS}ms")
                null
            } else {
                reader.get(READ_TIMEOUT_MS, TimeUnit.MILLISECONDS)
            }
        } catch (e: Exception) {
            process.destroyForcibly()
            reader.cancel(true)
            WaveAppLog.warn("login-shell env probe: reading output of ${cmd.firstOrNull()} failed: $e")
            null
        }
    }

    /** `$HOME` when set, else the JVM's `user.home` — the login shell itself uses the former. */
    private fun homeDir(): String? =
        System.getenv("HOME")?.takeIf { it.isNotEmpty() } ?: System.getProperty("user.home")

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
        probe = null
        ManagedRuntime.resetCache()
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

    /** Runs a command with the inherited environment as-is — used by the
     *  Git Bash lookup (`where git`), which must not be given a PATH built from
     *  its own result. */
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
}
