package com.wave.jetbrains.stdio

import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.security.MessageDigest
import java.time.Duration
import java.util.HexFormat
import java.util.zip.ZipInputStream

/**
 * The Node.js runtime Wave manages for itself (spec: docs/specs/ui/stdio-transport.md
 * 「JB 插件自动获取托管 Node 运行时」).
 *
 * The JetBrains plugin runs on the JVM and has no host Node to borrow — unlike
 * VS Code (extension host `process.execPath`) and the desktop app (Electron).
 * Requiring a system Node.js ≥ 22 was the single biggest deployment obstacle
 * for backend/ops customers, whose machines often have no Node and no
 * permission to install one. So the plugin ships no runtime in its jar (5
 * platforms would add hundreds of MB) but fetches the official Node tarball for
 * the current platform once, from the same npm mirror as the CLI's own runtime
 * deps (ripgrep/sharp), and reuses it forever after.
 *
 * There is deliberately NO "use the system node if it is new enough, download
 * otherwise" tier: that tier looks like it saves one download but drags back
 * every environment difference (PATH, nvm/asdf/volta/fnm, login shell, the
 * Windows Store `node.exe` stub, broken installs), each of which becomes a
 * field issue — and the same CLI would run on different Node versions on
 * different machines, making problems unreproducible. [System.getenv]
 * `WAVE_NODE_PATH` is the only escape hatch, for customers with a centrally
 * managed runtime.
 *
 * Layout: `<home>/.wave/runtime/node/bin/node` plus a `.wave-runtime.json`
 * marker recording {version, platform}. Only `bin/node` is kept — no npm, no
 * headers, no docs — and the fixed version makes the runtime reproducible
 * across machines and reconnects (a marker match skips the download entirely).
 */
object ManagedRuntime {
    /**
     * Pinned runtime version. Bumping it is the only way an installed runtime
     * gets replaced; "latest ≥ 22" would make different machines disagree.
     */
    const val VERSION = "22.14.0"

    /** Same host as the runtime deps the CLI fetches itself (npmmirror). */
    private const val DEFAULT_MIRROR = "https://registry.npmmirror.com/-/binary/node"

    /** Records the installed runtime's {version, platform} next to the binary. */
    private const val MARKER_FILE = ".wave-runtime.json"

    private const val CONNECT_TIMEOUT_SECONDS = 30L

    /** A Node tarball is ~30–50MB — slow links need far more than a probe. */
    private const val DOWNLOAD_TIMEOUT_MINUTES = 10L

    @Volatile
    private var cached: String? = null

    private val client: HttpClient by lazy {
        HttpClient.newBuilder()
            .followRedirects(HttpClient.Redirect.NORMAL)
            .connectTimeout(Duration.ofSeconds(CONNECT_TIMEOUT_SECONDS))
            .build()
    }

    /**
     * Absolute path of the `node` executable that runs the bundled CLI.
     *
     * Resolution order: `WAVE_NODE_PATH` → an installed runtime whose marker
     * matches {[VERSION], current platform} → download + install. [onStage]
     * receives [StartupStages] ids (the panel shows them under the loading
     * animation, spec ui/stdio-transport.md「首次启动的进度文案」) and is invoked
     * only when something actually has to be fetched — a cached runtime reports
     * nothing, so the user never reads "正在下载" for a step that never ran.
     *
     * @throws StdioClientException with an actionable message on any failure —
     * never a half-usable state, and never asking the user to install Node.
     */
    fun nodePath(onStage: (String) -> Unit = {}): String {
        cached?.let { return it }
        val resolved = resolveNode(onStage)
        cached = resolved
        return resolved
    }

    private fun resolveNode(onStage: (String) -> Unit): String {
        System.getenv("WAVE_NODE_PATH")?.takeIf { it.isNotBlank() }?.let { override ->
            val file = File(override)
            if (!file.canExecute()) {
                throw StdioClientException(
                    "WAVE_NODE_PATH 指向的 Node.js 无法执行（$override）。请修正该环境变量或删除它以使用托管运行时。"
                )
            }
            return file.path
        }

        val platform = platformKey(System.getProperty("os.name"), System.getProperty("os.arch"))
        val installed = nodeFile()
        if (markerFile().readTextOrNull()?.trim() == markerBody(platform) && installed.canExecute()) {
            return installed.path
        }
        install(platform, onStage)
        return installed.path
    }

    /** Reset the cached path (testing). */
    fun resetCache() {
        cached = null
    }

    // ------------------------------------------------------------------
    // Layout
    // ------------------------------------------------------------------

    /** `<home>/.wave/runtime/node` — shared by every Wave client on the machine. */
    internal fun runtimeDir(home: File = File(System.getProperty("user.home"))): File =
        File(File(File(home, ".wave"), "runtime"), "node")

    /** The interpreter only: no npm, no headers, no docs ever land here. */
    internal fun nodeFile(dir: File = runtimeDir(), windows: Boolean = isWindows()): File =
        File(File(dir, "bin"), if (windows) "node.exe" else "node")

    private fun markerFile(): File = File(runtimeDir(), MARKER_FILE)

    private fun isWindows(): Boolean =
        System.getProperty("os.name").lowercase().startsWith("win")

    // ------------------------------------------------------------------
    // Platform → Node distribution artifact
    // ------------------------------------------------------------------

    /**
     * Map JVM `os.name`/`os.arch` onto Node's official dist key. Only the
     * targets Node actually publishes exist; anything else gets an actionable
     * error instead of a download that cannot work. musl (Alpine) is called out
     * specifically: Node publishes no musl build at all, so a silent glibc
     * fallback would only die later at exec with a cryptic loader error.
     */
    internal fun platformKey(osName: String, osArch: String, musl: Boolean = detectMusl()): String {
        val os = osName.lowercase()
        val osKey = when {
            os.startsWith("mac") || os.startsWith("darwin") -> "darwin"
            os.startsWith("win") -> "win"
            os.startsWith("linux") -> "linux"
            else -> throw StdioClientException(
                "暂不支持的操作系统（$osName），无法自动获取托管 Node.js 运行时。请反馈该平台以便补充支持。"
            )
        }
        val archKey = when (osArch.lowercase()) {
            "x86_64", "amd64", "x64" -> "x64"
            "aarch64", "arm64" -> "arm64"
            else -> throw StdioClientException(
                "暂不支持的 CPU 架构（$osArch），无法自动获取托管 Node.js 运行时。请反馈该平台以便补充支持。"
            )
        }
        if (osKey == "linux" && musl) {
            throw StdioClientException(
                "暂不支持 musl libc 的 Linux：官方 Node.js 不提供 musl 构建，无法自动获取托管运行时。" +
                    "请改用 glibc 发行版，或通过 WAVE_NODE_PATH 指定一个已安装的 Node.js ≥ $VERSION。"
            )
        }
        return "$osKey-$archKey"
    }

    /**
     * musl sniffing: `ldd` is a shell wrapper on glibc and absent on musl, so
     * the dynamic loader's own file is the reliable signal.
     */
    private fun detectMusl(): Boolean {
        if (!System.getProperty("os.name").lowercase().startsWith("linux")) return false
        return File("/lib/ld-musl-x86_64.so.1").exists() ||
            File("/lib/ld-musl-aarch64.so.1").exists()
    }

    internal data class ArchiveTarget(
        /** File name on the mirror, e.g. `node-v22.14.0-linux-x64.tar.gz`. */
        val archive: String,
        /** Member inside the archive that becomes `bin/node`. */
        val member: String,
        /** Windows ships a `.zip`; everything else a `.tar.gz`. */
        val zip: Boolean,
    )

    internal fun archiveTarget(platformKey: String): ArchiveTarget {
        val top = "node-v$VERSION-$platformKey"
        return if (platformKey.startsWith("win")) {
            ArchiveTarget("$top.zip", "$top/node.exe", zip = true)
        } else {
            ArchiveTarget("$top.tar.gz", "$top/bin/node", zip = false)
        }
    }

    /** Marker body written after a successful install; compared verbatim. */
    internal fun markerBody(platformKey: String): String =
        """{"version":"$VERSION","platform":"$platformKey"}"""

    // ------------------------------------------------------------------
    // Mirror
    // ------------------------------------------------------------------

    /**
     * Base URL the Node archives come from (`<base>/v<version>/<file>` plus
     * `SHASUMS256.txt`). `WAVE_NODE_MIRROR` points a private/isolated deployment
     * at an internal mirror without touching every host. [raw] is injectable
     * for tests (the JVM has no supported way to set an env var at runtime).
     */
    internal fun mirrorBase(raw: String? = System.getenv("WAVE_NODE_MIRROR")): String =
        (raw?.trim()?.takeIf { it.isNotEmpty() } ?: DEFAULT_MIRROR).trimEnd('/')

    /** sha256 for [file] from an official `SHASUMS256.txt` body. */
    internal fun parseSha256Sums(text: String, file: String): String {
        for (raw in text.lineSequence()) {
            val match = SUM_LINE.matchEntire(raw.trim()) ?: continue
            if (match.groupValues[2].trim() == file) return match.groupValues[1]
        }
        throw StdioClientException("镜像的 SHASUMS256.txt 中没有 $file 的校验值（${mirrorBase()}）")
    }

    private val SUM_LINE = Regex("""^([0-9a-f]{64})\s+\*?(.+)$""")

    private fun fetch(url: String): ByteArray {
        val request = HttpRequest.newBuilder(URI.create(url))
            .timeout(Duration.ofMinutes(DOWNLOAD_TIMEOUT_MINUTES))
            .GET()
            .build()
        val response = client.send(request, HttpResponse.BodyHandlers.ofByteArray())
        if (response.statusCode() !in 200..299) {
            throw IOException("HTTP ${response.statusCode()}")
        }
        return response.body()
    }

    /**
     * Download the pinned archive and verify it against the mirror's own
     * checksum list. The bytes land on a customer machine and get executed, so
     * an unverified download is not acceptable — and `SHASUMS256.txt` is served
     * right next to the archive, so the real hash is always available.
     */
    private fun download(target: ArchiveTarget): ByteArray {
        val base = "${mirrorBase()}/v$VERSION"
        val sumsUrl = "$base/SHASUMS256.txt"
        val archiveUrl = "$base/${target.archive}"
        val sums = try {
            String(fetch(sumsUrl), Charsets.UTF_8)
        } catch (e: Exception) {
            throw downloadError(sumsUrl, e)
        }
        val expected = parseSha256Sums(sums, target.archive)
        val bytes = try {
            fetch(archiveUrl)
        } catch (e: Exception) {
            throw downloadError(archiveUrl, e)
        }
        val actual = sha256Hex(bytes)
        if (actual != expected) {
            throw StdioClientException(
                "托管 Node.js 运行时校验失败（${target.archive}）：期望 sha256 $expected，实际 $actual。" +
                    "请检查镜像完整性（$archiveUrl）"
            )
        }
        return bytes
    }

    private fun downloadError(url: String, cause: Throwable): StdioClientException =
        StdioClientException(
            "获取托管 Node.js 运行时失败：${cause.message ?: cause::class.java.simpleName}。" +
                "下载地址 $url；若当前网络无法访问默认镜像，可把环境变量 WAVE_NODE_MIRROR 指向内部镜像" +
                "（当前 ${mirrorBase()}）后重启编辑器重试。"
        )

    // ------------------------------------------------------------------
    // Install
    // ------------------------------------------------------------------

    /**
     * Download, unpack and swap the runtime in. The staging dir (`node.new`)
     * is fully populated — binary, `--version` sanity check, marker — before a
     * single rename makes it live, so a failed install leaves the previous
     * runtime untouched and a half-written `bin/node` can never be observed by
     * a concurrent client.
     */
    private fun install(platform: String, onStage: (String) -> Unit) {
        val target = archiveTarget(platform)
        onStage(StartupStages.DOWNLOADING_RUNTIME)
        val bytes = download(target)
        // 下载完就进解压 + 校验 + 原子替换，这一段也有几十秒（慢磁盘 / 杀毒扫描），
        // 不说一句用户会以为下载还没完。
        onStage(StartupStages.INSTALLING_RUNTIME)

        val live = runtimeDir()
        val staging = File(live.parentFile, "${live.name}.new")
        val backup = File(live.parentFile, "${live.name}.old")
        try {
            staging.deleteRecursively()
            File(staging, "bin").mkdirs()
            unpack(bytes, target, staging)
            // `tar` recreates the archive's top directory on its way to
            // `bin/node`; keep only `bin` — no npm, headers or docs.
            staging.listFiles()?.filter { it.name != "bin" }?.forEach { it.deleteRecursively() }
            val stagedNode = nodeFile(staging)
            if (!stagedNode.isFile || stagedNode.length() == 0L) {
                throw StdioClientException(
                    "托管 Node.js 运行时解压失败（${target.archive} 中未找到 ${target.member}）"
                )
            }
            stagedNode.setExecutable(true)
            // sha256 proves the bytes crossed intact; only an exec proves the
            // binary matches this machine's libc and CPU.
            val reported = try {
                runProcess(listOf(stagedNode.path, "--version")).trim()
            } catch (e: Exception) {
                throw StdioClientException(
                    "托管 Node.js 运行时无法执行（${e.message ?: e::class.java.simpleName}）。" +
                        "请反馈该平台（$platform）以便补充支持。"
                )
            }
            if (reported != "v$VERSION") {
                throw StdioClientException(
                    "托管 Node.js 运行时版本异常（期望 v$VERSION，实际 ${reported.ifEmpty { "无输出" }}）"
                )
            }
            File(staging, MARKER_FILE).writeText(markerBody(platform))
            backup.deleteRecursively()
            if (live.exists() && !live.renameTo(backup)) {
                throw StdioClientException(
                    "无法替换旧的托管 Node.js 运行时（${live.path}）。请确认没有其它 Wave 客户端" +
                        "正在使用它后重启编辑器重试。"
                )
            }
            if (!staging.renameTo(live)) {
                // Put the previous runtime back so the next start still has one.
                backup.renameTo(live)
                throw StdioClientException("无法安装托管 Node.js 运行时（${live.path}）")
            }
            backup.deleteRecursively()
        } finally {
            staging.deleteRecursively()
        }
    }

    /** Extract [target]'s member out of [bytes] into `staging/bin/node(.exe)`. */
    private fun unpack(bytes: ByteArray, target: ArchiveTarget, staging: File) {
        val destination = nodeFile(staging)
        if (target.zip) {
            ZipInputStream(bytes.inputStream().buffered()).use { zip ->
                while (true) {
                    val entry = zip.nextEntry ?: break
                    if (!entry.isDirectory && entry.name == target.member) {
                        FileOutputStream(destination).use { zip.copyTo(it) }
                        return
                    }
                    zip.closeEntry()
                }
            }
            return
        }
        // `.tar.gz` with the system tar: macOS and Linux always ship one, and
        // re-implementing tar in the plugin would buy nothing.
        val archive = File.createTempFile("wave-node", ".tar.gz")
        try {
            archive.writeBytes(bytes)
            runProcess(listOf("tar", "-xzf", archive.path, "-C", staging.path, target.member))
            val extracted = File(staging, target.member)
            if (extracted.isFile && !extracted.renameTo(destination)) {
                extracted.copyTo(destination, overwrite = true)
            }
        } finally {
            archive.delete()
        }
    }

    /**
     * Run a process and return its combined stdout/stderr. Deliberately does
     * NOT inherit the login-shell environment: `tar` and the freshly unpacked
     * `node` are addressed by absolute path, and injecting a user PATH could
     * shadow the very binary being verified.
     */
    internal fun runProcess(command: List<String>): String {
        val proc = ProcessBuilder(command).redirectErrorStream(true).start()
        val out = proc.inputStream.use { BinaryResolver.decodeCommandOutput(it.readBytes()) }
        val code = proc.waitFor()
        if (code != 0) {
            throw StdioClientException(
                "Command failed (${command.joinToString(" ")}): ${out.trim()}"
            )
        }
        return out
    }

    private fun sha256Hex(bytes: ByteArray): String =
        HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes))

    private fun File.readTextOrNull(): String? =
        try {
            if (isFile) readText() else null
        } catch (_: Exception) {
            null
        }
}
