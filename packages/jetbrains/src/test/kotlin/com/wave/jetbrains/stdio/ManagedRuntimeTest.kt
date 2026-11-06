package com.wave.jetbrains.stdio

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertThrows
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test
import java.io.File

/**
 * Tests for [ManagedRuntime]'s pure pieces: the platform→Node-dist mapping, the
 * archive/marker shapes that must match the official download layout, the
 * mirror URL, and the `SHASUMS256.txt` parser.
 *
 * The download/unpack/swap path itself is not exercised here — it needs the
 * network and a real Node archive; the same logic is covered end-to-end on the
 * desktop side (packages/desktop/tests/remoteCli.test.ts), and the shared
 * invariants are what these tests pin down.
 */
class ManagedRuntimeTest {

    // ---- layout --------------------------------------------------------

    @Test
    fun `runtimeDir sits under the shared wave runtime root`() {
        val home = File("/home/alice")
        assertEquals(
            File("/home/alice/.wave/runtime/node").absolutePath,
            ManagedRuntime.runtimeDir(home).absolutePath,
        )
    }

    @Test
    fun `nodeFile is bin node on POSIX and bin node exe on Windows`() {
        val dir = File("/home/alice/.wave/runtime/node")
        assertEquals(
            File(dir, "bin/node").absolutePath,
            ManagedRuntime.nodeFile(dir, windows = false).absolutePath,
        )
        assertEquals(
            File(dir, "bin/node.exe").absolutePath,
            ManagedRuntime.nodeFile(dir, windows = true).absolutePath,
        )
    }

    // ---- platformKey ---------------------------------------------------

    @Test
    fun `platformKey maps JVM os and arch onto Node dist keys`() {
        // macOS reports `aarch64` from os.arch on Apple Silicon, `x86_64` on Intel.
        assertEquals("darwin-arm64", ManagedRuntime.platformKey("Mac OS X", "aarch64", musl = false))
        assertEquals("darwin-x64", ManagedRuntime.platformKey("Mac OS X", "x86_64", musl = false))
        assertEquals("darwin-arm64", ManagedRuntime.platformKey("Darwin", "arm64", musl = false))
        // Windows reports `amd64`.
        assertEquals("win-x64", ManagedRuntime.platformKey("Windows 11", "amd64", musl = false))
        assertEquals("win-arm64", ManagedRuntime.platformKey("Windows 10", "aarch64", musl = false))
        assertEquals("linux-x64", ManagedRuntime.platformKey("Linux", "amd64", musl = false))
        assertEquals("linux-arm64", ManagedRuntime.platformKey("Linux", "aarch64", musl = false))
    }

    @Test
    fun `platformKey rejects musl Linux with an actionable message`() {
        // Node publishes no musl build at all, so this must fail loudly at
        // resolution time instead of dying later at exec with a loader error.
        val error = assertThrows(StdioClientException::class.java) {
            ManagedRuntime.platformKey("Linux", "x86_64", musl = true)
        }
        assertTrue(error.message!!.contains("musl"))
        assertTrue(error.message!!.contains("WAVE_NODE_PATH"))
    }

    @Test
    fun `platformKey ignores the musl flag off Linux`() {
        // A macOS/Windows host can never be musl — the flag only applies to Linux.
        assertEquals("darwin-arm64", ManagedRuntime.platformKey("Mac OS X", "aarch64", musl = true))
        assertEquals("win-x64", ManagedRuntime.platformKey("Windows 11", "amd64", musl = true))
    }

    @Test
    fun `platformKey rejects unsupported os and arch`() {
        val os = assertThrows(StdioClientException::class.java) {
            ManagedRuntime.platformKey("FreeBSD", "amd64", musl = false)
        }
        assertTrue(os.message!!.contains("FreeBSD"))

        val arch = assertThrows(StdioClientException::class.java) {
            ManagedRuntime.platformKey("Linux", "ppc64le", musl = false)
        }
        assertTrue(arch.message!!.contains("ppc64le"))
    }

    // ---- archiveTarget -------------------------------------------------

    @Test
    fun `archiveTarget uses the official tarball layout off Windows`() {
        val target = ManagedRuntime.archiveTarget("linux-x64")
        assertEquals("node-v${ManagedRuntime.VERSION}-linux-x64.tar.gz", target.archive)
        assertEquals("node-v${ManagedRuntime.VERSION}-linux-x64/bin/node", target.member)
        assertFalse(target.zip)
    }

    @Test
    fun `archiveTarget uses the zip layout on Windows`() {
        val target = ManagedRuntime.archiveTarget("win-arm64")
        assertEquals("node-v${ManagedRuntime.VERSION}-win-arm64.zip", target.archive)
        assertEquals("node-v${ManagedRuntime.VERSION}-win-arm64/node.exe", target.member)
        assertTrue(target.zip)
    }

    // ---- marker --------------------------------------------------------

    @Test
    fun `markerBody records version and platform only`() {
        // Same shape as the desktop side: the marker is compared verbatim, so
        // the exact serialisation (field order, no whitespace) is the contract.
        assertEquals(
            """{"version":"22.14.0","platform":"darwin-arm64"}""",
            ManagedRuntime.markerBody("darwin-arm64"),
        )
    }

    @Test
    fun `pinned version is the one the CLI requires`() {
        // Node >= 22 is what `wave --stdio` needs; the runtime is pinned so the
        // same CLI runs on the same Node everywhere.
        assertEquals("22.14.0", ManagedRuntime.VERSION)
    }

    // ---- mirrorBase ----------------------------------------------------

    @Test
    fun `mirrorBase defaults to the npmmirror host used by runtime deps`() {
        assertEquals(
            "https://registry.npmmirror.com/-/binary/node",
            ManagedRuntime.mirrorBase(raw = null),
        )
        // Blank/whitespace override falls back to the default.
        assertEquals(
            "https://registry.npmmirror.com/-/binary/node",
            ManagedRuntime.mirrorBase(raw = "   "),
        )
    }

    @Test
    fun `mirrorBase honours WAVE_NODE_MIRROR and trims a trailing slash`() {
        assertEquals(
            "https://mirror.internal/node",
            ManagedRuntime.mirrorBase(raw = "  https://mirror.internal/node/  "),
        )
    }

    // ---- parseSha256Sums -----------------------------------------------

    private val sums = """
        e5b1a1c1d3d5b0d4e5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8  node-v22.14.0-darwin-arm64.tar.gz
        aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa *node-v22.14.0-linux-x64.tar.gz

        1111111111111111111111111111111111111111111111111111111111111111  node-v22.14.0-win-x64.zip
    """.trimIndent()

    @Test
    fun `parseSha256Sums finds the hash for a file`() {
        assertEquals(
            "e5b1a1c1d3d5b0d4e5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8",
            ManagedRuntime.parseSha256Sums(sums, "node-v22.14.0-darwin-arm64.tar.gz"),
        )
        assertEquals(
            "1111111111111111111111111111111111111111111111111111111111111111",
            ManagedRuntime.parseSha256Sums(sums, "node-v22.14.0-win-x64.zip"),
        )
    }

    @Test
    fun `parseSha256Sums accepts the binary-mode star prefix`() {
        assertEquals(
            "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            ManagedRuntime.parseSha256Sums(sums, "node-v22.14.0-linux-x64.tar.gz"),
        )
    }

    @Test
    fun `parseSha256Sums rejects a list without the requested file`() {
        val error = assertThrows(StdioClientException::class.java) {
            ManagedRuntime.parseSha256Sums(sums, "node-v22.14.0-linux-arm64.tar.gz")
        }
        assertTrue(error.message!!.contains("node-v22.14.0-linux-arm64.tar.gz"))
    }

    @Test
    fun `parseSha256Sums ignores malformed lines`() {
        val noisy = "not a checksum line\n" + sums
        assertEquals(
            "1111111111111111111111111111111111111111111111111111111111111111",
            ManagedRuntime.parseSha256Sums(noisy, "node-v22.14.0-win-x64.zip"),
        )
    }
}
