package com.wave.jetbrains.stdio

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Tests for the login-shell environment pure helpers
 * (spec core/bash-tools.md「用户故事：登录 shell 环境注入」): shell selection
 * order, probe-environment construction, probe-output parsing and the
 * whitelist + no-overwrite merge. No shell is spawned here — [BinaryResolver]
 * owns the process, these decide everything else.
 */
class LoginShellEnvTest {

    // ---- selectPosixShell ----------------------------------------------
    //
    // A hard-coded shell makes the probe fail wherever that shell is missing
    // (a Linux box with only bash), so the order is part of the contract:
    // $SHELL → /bin/zsh + ~/.zshrc → /bin/bash + ~/.bashrc → first existing
    // /bin/zsh|/bin/bash → /bin/sh.

    @Test
    fun `selectPosixShell prefers an absolute existing SHELL`() {
        val shell = LoginShellEnv.selectPosixShell(
            shellVar = "/opt/homebrew/bin/zsh",
            homeDir = "/Users/u",
            isFile = fakeFs("/opt/homebrew/bin/zsh", "/bin/zsh", "/Users/u/.zshrc"),
        )
        assertEquals("/opt/homebrew/bin/zsh", shell)
    }

    @Test
    fun `selectPosixShell ignores a relative SHELL`() {
        val shell = LoginShellEnv.selectPosixShell(
            shellVar = "zsh",
            homeDir = "/Users/u",
            isFile = fakeFs("/bin/zsh", "/Users/u/.zshrc"),
        )
        assertEquals("/bin/zsh", shell)
    }

    @Test
    fun `selectPosixShell ignores SHELL pointing at a missing file`() {
        val shell = LoginShellEnv.selectPosixShell(
            shellVar = "/usr/local/bin/fish",
            homeDir = "/Users/u",
            isFile = fakeFs("/bin/bash", "/Users/u/.bashrc"),
        )
        assertEquals("/bin/bash", shell)
    }

    @Test
    fun `selectPosixShell needs the matching rc file for the zsh and bash branches`() {
        // zsh installed but never used (no ~/.zshrc), bash used → bash wins even
        // though zsh comes first in the candidate list.
        val shell = LoginShellEnv.selectPosixShell(
            shellVar = null,
            homeDir = "/home/u",
            isFile = fakeFs("/bin/zsh", "/bin/bash", "/home/u/.bashrc"),
        )
        assertEquals("/bin/bash", shell)
    }

    @Test
    fun `selectPosixShell falls back to the first existing shell without any rc file`() {
        val shell = LoginShellEnv.selectPosixShell(
            shellVar = null,
            homeDir = "/home/u",
            isFile = fakeFs("/bin/zsh", "/bin/bash"),
        )
        assertEquals("/bin/zsh", shell)
    }

    @Test
    fun `selectPosixShell falls back to bash on a Linux box without zsh`() {
        val shell = LoginShellEnv.selectPosixShell(
            shellVar = null,
            homeDir = "/home/u",
            isFile = fakeFs("/bin/bash", "/bin/sh"),
        )
        assertEquals("/bin/bash", shell)
    }

    @Test
    fun `selectPosixShell ends at sh`() {
        val shell = LoginShellEnv.selectPosixShell(
            shellVar = null,
            homeDir = null,
            isFile = fakeFs("/bin/sh"),
        )
        assertEquals("/bin/sh", shell)
    }

    @Test
    fun `selectPosixShell returns null when no shell exists`() {
        assertNull(LoginShellEnv.selectPosixShell(shellVar = null, homeDir = null, isFile = { false }))
    }

    // ---- buildProbeEnv --------------------------------------------------

    @Test
    fun `buildProbeEnv keeps only the passthrough set and adds the noise markers`() {
        val base = mapOf(
            "HOME" to "/home/u",
            "PATH" to "/usr/bin:/bin",
            "SHELL" to "/bin/zsh",
            "USER" to "u",
            "SSH_AUTH_SOCK" to "/tmp/agent.sock",
            "LANG" to "en_US.UTF-8",
            "LC_ALL" to "en_US.UTF-8",
            "LC_CTYPE" to "UTF-8",
            "XDG_DATA_DIRS" to "/usr/share",
            "DISPLAY" to ":0",
            "WAYLAND_DISPLAY" to "wayland-0",
            // Must not leak into the probe child.
            "NODE_OPTIONS" to "--max-old-space-size=8192",
            "GIT_DIR" to "/repo/.git",
            "LD_PRELOAD" to "/evil.so",
            "TERM_PROGRAM" to "JetBrains-JediTerm",
        )
        val env = LoginShellEnv.buildProbeEnv(base)

        assertEquals("/home/u", env["HOME"])
        assertEquals("/usr/bin:/bin", env["PATH"])
        assertEquals("/bin/zsh", env["SHELL"])
        assertEquals("u", env["USER"])
        assertEquals("/tmp/agent.sock", env["SSH_AUTH_SOCK"])
        assertEquals("en_US.UTF-8", env["LANG"])
        assertEquals("en_US.UTF-8", env["LC_ALL"])
        assertEquals("UTF-8", env["LC_CTYPE"])
        assertEquals("/usr/share", env["XDG_DATA_DIRS"])
        assertEquals(":0", env["DISPLAY"])
        assertEquals("wayland-0", env["WAYLAND_DISPLAY"])
        assertFalse("NODE_OPTIONS" in env)
        assertFalse("GIT_DIR" in env)
        assertFalse("LD_PRELOAD" in env)
        assertFalse("TERM_PROGRAM" in env)

        assertEquals("true", env["DISABLE_AUTO_UPDATE"])
        assertEquals("true", env["ZSH_DISABLE_COMPFIX"])
        assertEquals("never", env["SSH_ASKPASS_REQUIRE"])
        assertEquals("disabled:", env["DBUS_SESSION_BUS_ADDRESS"])
        assertEquals("1", env["WAVE_LOGIN_SHELL_PROBE"])
    }

    // ---- parseProbeEnv --------------------------------------------------

    private val start = "NONCE"
    private val end = "NONCE_END"

    @Test
    fun `parseProbeEnv reads NUL separated output between the markers`() {
        val output = "Last login: whatever\n$start\n" +
            "PATH=/opt/homebrew/bin:/usr/bin\u0000" +
            "MULTI=line1\nline2\u0000" +
            "SSH_AUTH_SOCK=/tmp/agent.sock\u0000" +
            end + "\n"
        val parsed = LoginShellEnv.parseProbeEnv(output, start, end)!!

        assertTrue(parsed.nulDelimited)
        assertEquals("/opt/homebrew/bin:/usr/bin", parsed.env["PATH"])
        // `env -0` is lossless: multi-line values survive.
        assertEquals("line1\nline2", parsed.env["MULTI"])
        assertEquals("/tmp/agent.sock", parsed.env["SSH_AUTH_SOCK"])
    }

    @Test
    fun `parseProbeEnv ignores rc banners printed before and after the markers`() {
        val output = "banner\n$start\nPATH=/bin\u0000$end\ncompinit warning\n"
        val parsed = LoginShellEnv.parseProbeEnv(output, start, end)!!
        assertEquals(mapOf("PATH" to "/bin"), parsed.env)
    }

    @Test
    fun `parseProbeEnv falls back to lines when the end marker is missing`() {
        // `env -0` unsupported → the shell short-circuits at `&&`, so plain
        // `env` prints line-separated output and the end marker never appears.
        val output = "$start\nPATH=/bin\nMARK=1\n"
        val parsed = LoginShellEnv.parseProbeEnv(output, start, end)!!

        assertFalse(parsed.nulDelimited)
        assertEquals("/bin", parsed.env["PATH"])
        assertEquals("1", parsed.env["MARK"])
    }

    @Test
    fun `parseLineDelimited drops keys whose value spans lines`() {
        val body = "PATH=/bin\nMULTI=first\nsecond\nTHIRD=3\n"
        val env = LoginShellEnv.parseLineDelimited(body)

        assertEquals("/bin", env["PATH"])
        assertEquals("3", env["THIRD"])
        // The continuation line belongs to MULTI and makes it unusable; it must
        // neither be adopted nor become an entry of its own.
        assertFalse("MULTI" in env)
        assertFalse("second" in env)
        assertEquals(2, env.size)
    }

    @Test
    fun `parseProbeEnv returns null when the start marker is missing`() {
        assertNull(LoginShellEnv.parseProbeEnv("/bin/zsh: no such file\n", start, end))
    }

    @Test
    fun `parseNulDelimited rejects names that are not variable names`() {
        val env = LoginShellEnv.parseNulDelimited("GOOD=1\u00009BAD=2\u0000=3\u0000noequals\u0000")
        assertEquals(mapOf("GOOD" to "1"), env)
    }

    // ---- sanitizeProbedEnv ----------------------------------------------

    @Test
    fun `sanitizeProbedEnv drops session keys and the noise markers`() {
        val probed = mapOf(
            "PATH" to "/bin",
            "PWD" to "/home/u",
            "OLDPWD" to "/tmp",
            "SHLVL" to "1",
            "_" to "/usr/bin/env",
            "DBUS_SESSION_BUS_ADDRESS" to "disabled:",
            "WAVE_LOGIN_SHELL_PROBE" to "1",
            "ZSH_DISABLE_COMPFIX" to "true",
            "DISABLE_AUTO_UPDATE" to "true",
            "SSH_ASKPASS_REQUIRE" to "never",
        )
        assertEquals(mapOf("PATH" to "/bin"), LoginShellEnv.sanitizeProbedEnv(probed))
    }

    // ---- adopt (whitelist + no-overwrite) -------------------------------

    @Test
    fun `adopt keeps only whitelisted keys the target does not have`() {
        val probed = mapOf(
            "PATH" to "/opt/homebrew/bin",
            "SSH_AUTH_SOCK" to "/tmp/probed.sock",
            "WAVE_SHELL" to "/bin/zsh",
            "WAVE_GIT_BASH_PATH" to "C:\\Git\\bin\\bash.exe",
            "NODE_EXTRA_CA_CERTS" to "/cert.pem",
            "SSL_CERT_FILE" to "/cert.pem",
            "GIT_SSL_CAINFO" to "/cert.pem",
            "HTTPS_PROXY" to "http://probed:8080",
            "LC_ALL" to "en_US.UTF-8",
            "XDG_DATA_DIRS" to "/usr/share",
            // Not whitelisted: would change the IDE's own behaviour.
            "NODE_OPTIONS" to "--max-old-space-size=8192",
            "GIT_DIR" to "/repo/.git",
            "LD_PRELOAD" to "/evil.so",
        )
        val inherited = mapOf(
            "PATH" to "/usr/bin",
            "SSH_AUTH_SOCK" to "/tmp/ide.sock",
            "HTTPS_PROXY" to "http://ide:3128",
        )
        val adopted = LoginShellEnv.adopt(probed, inherited, windows = false, pathSeparator = ":")

        // PATH is merged (probed first), never dropped — otherwise the whole
        // point of the probe (nvm/Homebrew dirs) would be lost.
        assertEquals("/opt/homebrew/bin:/usr/bin", adopted["PATH"])
        // Already set by the host → the host value wins.
        assertFalse("SSH_AUTH_SOCK" in adopted)
        assertFalse("HTTPS_PROXY" in adopted)
        // Absent from the host → adopted.
        assertEquals("/bin/zsh", adopted["WAVE_SHELL"])
        assertEquals("C:\\Git\\bin\\bash.exe", adopted["WAVE_GIT_BASH_PATH"])
        assertEquals("/cert.pem", adopted["NODE_EXTRA_CA_CERTS"])
        assertEquals("/cert.pem", adopted["SSL_CERT_FILE"])
        assertEquals("/cert.pem", adopted["GIT_SSL_CAINFO"])
        assertEquals("en_US.UTF-8", adopted["LC_ALL"])
        assertEquals("/usr/share", adopted["XDG_DATA_DIRS"])
        // Never adopted.
        assertFalse("NODE_OPTIONS" in adopted)
        assertFalse("GIT_DIR" in adopted)
        assertFalse("LD_PRELOAD" in adopted)
    }

    @Test
    fun `adopt returns a delta, not the whole inherited environment`() {
        val inherited = mapOf("PATH" to "/usr/bin", "HOME" to "/home/u")
        val adopted = LoginShellEnv.adopt(mapOf("PATH" to "/opt/bin"), inherited, windows = false, pathSeparator = ":")
        assertEquals(setOf("PATH"), adopted.keys)
    }

    @Test
    fun `adopt accepts lowercase proxy variables`() {
        val adopted = LoginShellEnv.adopt(
            probed = mapOf("http_proxy" to "http://probed:8080", "no_proxy" to "localhost"),
            inherited = emptyMap(),
            windows = false,
        )
        assertEquals("http://probed:8080", adopted["http_proxy"])
        assertEquals("localhost", adopted["no_proxy"])
    }

    @Test
    fun `adopt treats key names case-insensitively on Windows`() {
        val adopted = LoginShellEnv.adopt(
            probed = mapOf("PATH" to "C:\\probed-bin", "Http_Proxy" to "http://probed:8080"),
            inherited = mapOf("Path" to "C:\\Windows", "http_proxy" to "http://ide:3128"),
            windows = true,
            pathSeparator = ";",
        )
        assertEquals("C:\\probed-bin;C:\\Windows", adopted["PATH"])
        assertFalse(adopted.keys.any { it.equals("Http_Proxy", ignoreCase = true) })
    }

    @Test
    fun `adopt keeps a host-relative case-distinct key on POSIX`() {
        val adopted = LoginShellEnv.adopt(
            probed = mapOf("http_proxy" to "http://probed:8080"),
            inherited = mapOf("HTTP_PROXY" to "http://ide:3128"),
            windows = false,
        )
        // POSIX names are case-sensitive: both may legitimately coexist.
        assertEquals("http://probed:8080", adopted["http_proxy"])
    }

    // ---- mergePath ------------------------------------------------------

    @Test
    fun `mergePath returns null when both sides are empty`() {
        assertNull(LoginShellEnv.mergePath(null, null, ":"))
        assertNull(LoginShellEnv.mergePath("", "", ":"))
    }

    @Test
    fun `mergePath puts the login segments before the inherited ones`() {
        assertEquals("/opt/homebrew/bin:/usr/bin", LoginShellEnv.mergePath("/opt/homebrew/bin", "/usr/bin", ":"))
    }

    @Test
    fun `mergePath uses the login path alone when the inherited one is unset`() {
        assertEquals("/opt/homebrew/bin:/usr/local/bin", LoginShellEnv.mergePath("/opt/homebrew/bin:/usr/local/bin", null, ":"))
    }

    @Test
    fun `mergePath dedupes repeated segments`() {
        val merged = LoginShellEnv.mergePath(
            "/opt/homebrew/bin:/usr/local/bin",
            "/opt/homebrew/bin:/usr/local/bin",
            ":",
        )!!
        val segments = merged.split(":")
        assertEquals(1, segments.count { it == "/opt/homebrew/bin" })
        assertEquals(1, segments.count { it == "/usr/local/bin" })
    }

    // ---- helpers --------------------------------------------------------

    /** Fake filesystem: only the listed paths "exist". */
    private fun fakeFs(vararg existing: String): (String) -> Boolean = { it in existing }
}
