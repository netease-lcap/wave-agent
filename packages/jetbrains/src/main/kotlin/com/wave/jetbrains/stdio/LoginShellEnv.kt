package com.wave.jetbrains.stdio

import java.io.File

/**
 * Login-shell environment: shell selection, probe-output parsing and the
 * whitelist merge (spec core/bash-tools.md「用户故事：登录 shell 环境注入」).
 *
 * An IDE started from Finder/Dock or a desktop launcher never sources the
 * user's shell profile, so the environment it hands its children is missing
 * everything `~/.zshrc` / `~/.bashrc` export — not just PATH entries (nvm,
 * Homebrew, pnpm) but also `SSH_AUTH_SOCK`, proxy and custom-CA variables which
 * are what makes `git push`, MCP servers and self-signed-cert setups work.
 * Every child of the CLI (`Bash` tool commands, background tasks, MCP servers,
 * hooks, git, LSP servers) only inherits the process environment, so the fix is
 * one probe at host startup whose result is merged into the environment map
 * used to spawn the CLI — the SDK keeps running each command with a plain `-c`.
 *
 * Everything that can be decided without spawning a shell lives here as a pure
 * function ([selectPosixShell], [buildProbeEnv], [parseProbeEnv],
 * [sanitizeProbedEnv], [adopt]) so it is testable with synthetic inputs;
 * [BinaryResolver] owns the actual process spawn, retries and caching.
 */
internal object LoginShellEnv {

    /**
     * Markers fed to the probe shell so a well-behaved interactive startup does
     * not stall it: oh-my-zsh's auto-update, zsh's compinit security check,
     * ssh's askpass dialog, a D-Bus session bus that would otherwise be
     * activated, and a marker of our own (so a probe process is identifiable in
     * `ps`). All of them are stripped from the result again, together with
     * [DROPPED_KEYS].
     */
    val NOISE_ENV: Map<String, String> = linkedMapOf(
        "DISABLE_AUTO_UPDATE" to "true",
        "ZSH_DISABLE_COMPFIX" to "true",
        "SSH_ASKPASS_REQUIRE" to "never",
        "DBUS_SESSION_BUS_ADDRESS" to "disabled:",
        "WAVE_LOGIN_SHELL_PROBE" to "1",
    )

    /**
     * Keys the login shell rewrites for its own session. Adopting them would
     * claim the probe child's `PWD`/`SHLVL` as the IDE's.
     */
    private val DROPPED_KEYS = setOf("PWD", "OLDPWD", "SHLVL", "_")

    /**
     * The only variables the probe child receives, besides the `LC_*` / `XDG_*`
     * families: enough for a login shell to find its rc files and `env` itself,
     * and nothing that would change how the shell starts.
     */
    private val PROBE_PASSTHROUGH_KEYS =
        setOf("HOME", "PATH", "SHELL", "USER", "SSH_AUTH_SOCK", "LANG", "DISPLAY", "WAYLAND_DISPLAY")

    /**
     * Adopted into the host environment as-is. Anything else the user's shell
     * exports stays out: `NODE_OPTIONS`, `LD_PRELOAD`, `DYLD_*`, `GIT_*` would
     * change the IDE / Electron / extension-host behaviour itself, which is not
     * what the user asked for. `WAVE_SHELL` and `WAVE_GIT_BASH_PATH` are ours —
     * they are the overrides the SDK shell resolver reads.
     */
    private val ADOPTABLE_KEYS = setOf(
        "PATH",
        "SSH_AUTH_SOCK",
        "WAVE_SHELL",
        "WAVE_GIT_BASH_PATH",
        "NODE_EXTRA_CA_CERTS",
        "SSL_CERT_FILE",
        "SSL_CERT_DIR",
        "REQUESTS_CA_BUNDLE",
        "CURL_CA_BUNDLE",
        "GIT_SSL_CAINFO",
        "HTTP_PROXY",
        "HTTPS_PROXY",
        "ALL_PROXY",
        "NO_PROXY",
        "LANG",
        "DISPLAY",
        "WAYLAND_DISPLAY",
    )

    /** Prefix families adopted wholesale (locale and desktop-session hints). */
    private val ADOPTABLE_PREFIXES = listOf("LC_", "XDG_")

    private val ENV_KEY = Regex("[A-Za-z_][A-Za-z0-9_]*")

    /**
     * Pick the shell to probe with (spec scenario 3 — a hard-coded zsh makes the
     * probe fail on every Linux box that only has bash):
     *   1. `$SHELL` when it is an absolute path that exists
     *   2. `/bin/zsh` when it exists and `~/.zshrc` does
     *   3. `/bin/bash` when it exists and `~/.bashrc` does
     *   4. the first existing one of `/bin/zsh`, `/bin/bash`
     *   5. `/bin/sh` as the last resort
     *
     * [isFile] is injectable so the order above can be tested without a real
     * filesystem. Returns null when no shell exists at all — the caller then
     * keeps the inherited environment.
     */
    fun selectPosixShell(
        shellVar: String?,
        homeDir: String?,
        isFile: (String) -> Boolean = { File(it).isFile },
    ): String? {
        if (!shellVar.isNullOrEmpty() && shellVar.startsWith("/") && isFile(shellVar)) return shellVar
        val hasHomeRc: (String) -> Boolean = { name ->
            !homeDir.isNullOrEmpty() && isFile(File(homeDir, name).path)
        }
        if (isFile("/bin/zsh") && hasHomeRc(".zshrc")) return "/bin/zsh"
        if (isFile("/bin/bash") && hasHomeRc(".bashrc")) return "/bin/bash"
        listOf("/bin/zsh", "/bin/bash").firstOrNull(isFile)?.let { return it }
        return "/bin/sh".takeIf(isFile)
    }

    /**
     * Environment for the probe child (spec scenario 5): the pass-through set
     * plus [NOISE_ENV] — deliberately not the whole inherited environment, so a
     * shell cannot inherit variables that only make its startup slower or
     * noisier. Windows calls this too but applies it on top of the inherited
     * environment instead of replacing it: `bash.exe` needs `SYSTEMROOT` and
     * friends to start at all.
     */
    fun buildProbeEnv(base: Map<String, String>): Map<String, String> {
        val env = LinkedHashMap<String, String>()
        for ((key, value) in base) {
            val upper = key.uppercase()
            if (upper in PROBE_PASSTHROUGH_KEYS || ADOPTABLE_PREFIXES.any { upper.startsWith(it) }) {
                env[key] = value
            }
        }
        env.putAll(NOISE_ENV)
        return env
    }

    /** Parsed probe result; [nulDelimited] is false when `env -0` was unavailable. */
    data class ProbeOutput(val env: Map<String, String>, val nulDelimited: Boolean)

    /**
     * Parse the output of
     * `<shell> -l -i -c 'echo "<start>"; env -0 && echo "<end>" || env'`.
     *
     * Only what sits between the two markers is considered, so rc banners,
     * `compinit` warnings and "no job control in this shell" noise are ignored.
     *
     * - End marker present → `env -0` worked: split on NUL, which survives
     *   multi-line values (they are lossless, so nothing has to be dropped).
     * - End marker absent → `env -0` is unsupported, the shell short-circuited
     *   at `&&` and plain `env` printed line-separated output: fall back to
     *   [parseLineDelimited].
     *
     * Returns null when the start marker is missing (unparseable output).
     */
    fun parseProbeEnv(output: String, startMarker: String, endMarker: String): ProbeOutput? {
        val start = output.indexOf(startMarker)
        if (start < 0) return null
        val bodyStart = start + startMarker.length
        val end = output.indexOf(endMarker, bodyStart)
        if (end >= 0) {
            val body = output.substring(bodyStart, end)
            return if (body.indexOf('\u0000') >= 0) {
                ProbeOutput(parseNulDelimited(body), nulDelimited = true)
            } else {
                ProbeOutput(parseLineDelimited(body), nulDelimited = false)
            }
        }
        return ProbeOutput(parseLineDelimited(output.substring(bodyStart)), nulDelimited = false)
    }

    /** `KEY=value\0KEY2=value2\0` — values may contain newlines and `=`. */
    fun parseNulDelimited(body: String): Map<String, String> {
        val result = LinkedHashMap<String, String>()
        for (raw in body.split('\u0000')) {
            // The marker's own newline is glued to the first entry.
            val entry = raw.trimStart('\n', '\r')
            if (entry.isEmpty()) continue
            val eq = entry.indexOf('=')
            if (eq <= 0) continue
            val key = entry.substring(0, eq)
            if (!ENV_KEY.matches(key)) continue
            result[key] = entry.substring(eq + 1)
        }
        return result
    }

    /**
     * Line-separated `KEY=value` fallback. A value that spans lines arrives
     * broken across several lines, so continuation lines are glued back onto the
     * entry they belong to and the entry is then **dropped**: a value whose
     * boundary is unknowable cannot be adopted without risking a cross-line
     * paste into the host environment (spec scenario 6).
     */
    fun parseLineDelimited(body: String): Map<String, String> {
        val result = LinkedHashMap<String, String>()
        val lines = body.split('\n')
        var key: String? = null
        val value = StringBuilder()
        var multiLine = false

        fun flush() {
            val k = key
            if (k != null && !multiLine) result[k] = value.toString()
            key = null
            value.setLength(0)
            multiLine = false
        }

        for ((index, raw) in lines.withIndex()) {
            val line = raw.removeSuffix("\r")
            if (line.isEmpty() && index == lines.lastIndex) continue // trailing newline, not a continuation
            val eq = line.indexOf('=')
            val candidate = if (eq > 0) line.substring(0, eq) else null
            if (candidate != null && ENV_KEY.matches(candidate)) {
                flush()
                key = candidate
                value.append(line.substring(eq + 1))
            } else if (key != null) {
                // Continuation of a multi-line value: keep consuming so the rest
                // of the dangling lines cannot be mistaken for new entries, and
                // mark the entry as unusable.
                value.append('\n').append(line)
                multiLine = true
            }
        }
        flush()
        return result
    }

    /**
     * Drop what belongs to the probe child's session rather than to the user's
     * configuration: [DROPPED_KEYS] plus every [NOISE_ENV] marker we injected.
     */
    fun sanitizeProbedEnv(env: Map<String, String>): Map<String, String> {
        val noise = NOISE_ENV.keys
        val result = LinkedHashMap<String, String>()
        for ((key, value) in env) {
            if (key in DROPPED_KEYS || key in noise) continue
            result[key] = value
        }
        return result
    }

    /**
     * Whitelist + no-overwrite merge of the probe result into the environment
     * the child would otherwise inherit (spec scenarios 4 and 8).
     *
     * - Only [ADOPTABLE_KEYS] and the `LC_*` / `XDG_*` families are adopted, and
     *   only when the target environment does not already have the key: a value
     *   the host or the user configured explicitly always wins.
     * - `PATH` is the one exception, and it has to be: the IDE always inherits
     *   *some* PATH, so a strict "already set → skip" would throw the probed
     *   PATH away every single time — and that PATH (nvm/Homebrew/pnpm dirs) is
     *   the entire point of the probe. Probed segments go first, inherited ones
     *   after, duplicates dropped.
     *
     * [windows] makes key lookups case-insensitive; Windows variable names are.
     * Returns the delta to put into the spawn environment (never a full copy of
     * the inherited environment).
     */
    fun adopt(
        probed: Map<String, String>,
        inherited: Map<String, String>,
        windows: Boolean,
        pathSeparator: String = File.pathSeparator,
    ): Map<String, String> {
        val result = LinkedHashMap<String, String>()

        val probedPath = lookup(probed, "PATH", windows)
        if (!probedPath.isNullOrEmpty()) {
            mergePath(probedPath, lookup(inherited, "PATH", windows), pathSeparator)
                ?.let { result["PATH"] = it }
        }

        for ((key, value) in probed) {
            if (!isAdoptableKey(key)) continue
            if (key.equals("PATH", ignoreCase = windows)) continue // handled above
            if (lookup(inherited, key, windows) != null) continue
            result[key] = value
        }
        return result
    }

    /**
     * Login-shell segments first, inherited segments after, deduped and in
     * order. Split out from [adopt] so it can be unit-tested with synthetic
     * inputs; returns null when both sides are empty.
     */
    fun mergePath(probedPath: String?, inheritedPath: String?, separator: String = File.pathSeparator): String? {
        val segments = LinkedHashSet<String>()
        for (side in listOf(probedPath, inheritedPath)) {
            side?.takeIf { it.isNotEmpty() }
                ?.split(separator)
                ?.forEach { if (it.isNotEmpty()) segments.add(it) }
        }
        if (segments.isEmpty()) return null
        return segments.joinToString(separator)
    }

    /** Whitelist check — case-insensitive, so `http_proxy` and `HTTP_PROXY` both pass. */
    fun isAdoptableKey(key: String): Boolean {
        val upper = key.uppercase()
        return upper in ADOPTABLE_KEYS || ADOPTABLE_PREFIXES.any { upper.startsWith(it) }
    }

    private fun lookup(env: Map<String, String>, key: String, ignoreCase: Boolean): String? {
        if (!ignoreCase) return env[key]
        return env.entries.firstOrNull { it.key.equals(key, ignoreCase = true) }?.value
    }
}
