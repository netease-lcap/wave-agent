package com.wave.jetbrains.update

import com.intellij.ide.BrowserUtil
import com.intellij.ide.plugins.IdeaPluginDescriptorImpl
import com.intellij.ide.plugins.PluginInstaller
import com.intellij.ide.plugins.PluginManagerCore
import com.intellij.ide.util.PropertiesComponent
import com.intellij.notification.Notification
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.WriteAction
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.extensions.PluginId
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.actionSystem.AnActionEvent
import com.wave.jetbrains.util.Edt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.io.File
import java.net.HttpURLConnection
import java.net.URI

/**
 * Plugin self-update checker — mirrors packages/vsce/src/services/updateService.ts.
 *
 * Queries the GitHub Releases API for the latest Wave release, compares against the
 * installed plugin version, and notifies the user with 自动更新 / 查看更新 / 忽略 buttons.
 * Auto-update downloads the .zip and schedules an install-on-restart via
 * [PluginInstaller.installAfterRestart]; a browser-download fallback guarantees the
 * user can still update manually if the internal install API is unavailable.
 *
 * Three deliberate divergences from the VSCode implementation:
 *  - endpoint is `netease-lcap/wave-agent` (the live release repo; VSCode's
 *    `wave-vsce` URL points at a stale repo and is a bug);
 *  - the release artifact is a `.zip` (Gradle `buildPlugin` output), not a `.vsix`;
 *  - install uses [PluginInstaller.installAfterRestart], not a marketplace install API.
 */
@Suppress("UnstableApiUsage") // PluginInstaller / IdeaPluginDescriptorImpl are @ApiStatus.Internal
object UpdateChecker {
    private val LOG = logger<UpdateChecker>()
    private val JSON = Json { ignoreUnknownKeys = true }
    private const val PLUGIN_ID = "com.wave.jetbrains"
    private const val LATEST_RELEASE_URL =
        "https://api.github.com/repos/netease-lcap/wave-agent/releases/latest"
    private const val USER_AGENT = "Wave-JetBrains-Plugin"
    private const val HTTP_TIMEOUT_MS = 10_000
    private const val DOWNLOAD_TIMEOUT_MS = 120_000
    private const val COOLDOWN_MS = 24L * 60 * 60 * 1000
    private const val KEY_LAST_CHECK = "wave.lastUpdateCheck"
    private const val KEY_IGNORED_VERSION = "wave.ignoredVersion"
    private const val NOTIFICATION_GROUP = "Wave"

    /** Once-per-activation guard for the automatic check (mirrors VSCode's in-memory flag). */
    @Volatile var autoCheckTriggered = false

    data class ParsedVersion(val major: Int, val minor: Int, val patch: Int)

    data class UpdateInfo(
        val latestVersion: String,
        val currentVersion: String,
        val downloadUrl: String,
        val zipUrl: String?,
        val releaseNotes: String?,
    )

    @Serializable
    private data class GithubRelease(
        val tag_name: String,
        val html_url: String,
        val body: String? = null,
        val assets: List<GithubAsset> = emptyList(),
    )

    @Serializable
    private data class GithubAsset(
        val name: String,
        val browser_download_url: String,
    )

    // ── Version parsing (VSCode parity: strip 'v', drop pre-release, require 3 numeric parts) ──

    fun parseVersion(version: String): ParsedVersion? {
        val core = version.trimStart('v').substringBefore('-')
        val parts = core.split('.')
        if (parts.size != 3) return null
        val nums = parts.map { it.toIntOrNull() ?: return null }
        return ParsedVersion(nums[0], nums[1], nums[2])
    }

    fun compareVersions(a: ParsedVersion, b: ParsedVersion): Int {
        if (a.major != b.major) return if (a.major < b.major) -1 else 1
        if (a.minor != b.minor) return if (a.minor < b.minor) -1 else 1
        if (a.patch != b.patch) return if (a.patch < b.patch) -1 else 1
        return 0
    }

    // ── HTTP ────────────────────────────────────────────────────────────────────

    private fun httpGet(url: String): String {
        val conn = (URI(url).toURL().openConnection() as HttpURLConnection).apply {
            requestMethod = "GET"
            setRequestProperty("User-Agent", USER_AGENT)
            setRequestProperty("Accept", "application/vnd.github+json")
            connectTimeout = HTTP_TIMEOUT_MS
            readTimeout = HTTP_TIMEOUT_MS
            instanceFollowRedirects = true
        }
        try {
            val code = conn.responseCode
            if (code != 200) throw UpdateCheckException("HTTP $code from $url")
            return conn.inputStream.bufferedReader().use { it.readText() }
        } finally {
            conn.disconnect()
        }
    }

    private fun httpDownload(url: String, dest: File) {
        val conn = (URI(url).toURL().openConnection() as HttpURLConnection).apply {
            setRequestProperty("User-Agent", USER_AGENT)
            connectTimeout = HTTP_TIMEOUT_MS
            readTimeout = DOWNLOAD_TIMEOUT_MS
            instanceFollowRedirects = true
        }
        try {
            val code = conn.responseCode
            if (code != 200) throw UpdateCheckException("Download HTTP $code from $url")
            conn.inputStream.use { input ->
                dest.outputStream().use { input.copyTo(it) }
            }
        } finally {
            conn.disconnect()
        }
    }

    // ── Update check ────────────────────────────────────────────────────────────

    suspend fun checkForUpdate(currentVersion: String): UpdateInfo? = withContext(Dispatchers.IO) {
        val current = parseVersion(currentVersion) ?: run {
            LOG.warn("Invalid current version: $currentVersion")
            return@withContext null
        }
        try {
            val body = httpGet(LATEST_RELEASE_URL)
            val release = JSON.decodeFromString<GithubRelease>(body)
            val latestTag = release.tag_name.trimStart('v')
            val latest = parseVersion(latestTag) ?: run {
                LOG.warn("Invalid latest tag from GitHub: ${release.tag_name}")
                return@withContext null
            }
            if (compareVersions(latest, current) > 0) {
                val zipAsset = release.assets.firstOrNull { it.name.endsWith(".zip") }
                UpdateInfo(
                    latestVersion = latestTag,
                    currentVersion = currentVersion,
                    downloadUrl = release.html_url,
                    zipUrl = zipAsset?.browser_download_url,
                    releaseNotes = release.body,
                )
            } else null
        } catch (e: Exception) {
            LOG.warn("Failed to check for updates: ${e.message}")
            null
        }
    }

    /**
     * Check for an update and notify the user if one is available.
     * @param skipCooldown when true (manual check), bypass the 24h cooldown.
     */
    suspend fun checkAndNotify(project: Project, skipCooldown: Boolean = false) {
        val pc = PropertiesComponent.getInstance()
        val now = System.currentTimeMillis()
        if (!skipCooldown) {
            val last = pc.getValue(KEY_LAST_CHECK)?.toLongOrNull() ?: 0L
            if (now - last < COOLDOWN_MS) return
        }
        // Record check time before the network call (mirrors VSCode) to prevent racing checks.
        pc.setValue(KEY_LAST_CHECK, now.toString())

        val current = currentVersion()
        if (current.isEmpty()) return
        val info = checkForUpdate(current) ?: run {
            if (skipCooldown) Edt.invokeLater { showInfo(project, "当前已是最新版本") }
            return
        }

        val ignored = pc.getValue(KEY_IGNORED_VERSION, "")
        if (info.latestVersion == ignored) {
            if (skipCooldown) Edt.invokeLater {
                showInfo(project, "当前已忽略 v${info.latestVersion}，最新版本为 v${info.latestVersion}")
            }
            return
        }

        Edt.invokeLater { showUpdateNotification(project, info) }
    }

    // ── Notifications ───────────────────────────────────────────────────────────

    private fun showUpdateNotification(project: Project, info: UpdateInfo) {
        val message = "Wave 代码智聊 新版本 v${info.latestVersion} 已可用 (当前 v${info.currentVersion})"
        val notif = NotificationGroupManager.getInstance()
            .getNotificationGroup(NOTIFICATION_GROUP)
            .createNotification("Wave", message, NotificationType.INFORMATION)

        if (info.zipUrl != null) {
            notif.addAction(object : NotificationAction("自动更新") {
                override fun actionPerformed(e: AnActionEvent, notification: Notification) {
                    notification.expire()
                    downloadAndInstallWithProgress(project, info)
                }
            })
        }
        notif.addAction(object : NotificationAction("查看更新") {
            override fun actionPerformed(e: AnActionEvent, notification: Notification) {
                notification.expire()
                BrowserUtil.browse(info.downloadUrl)
            }
        })
        notif.addAction(object : NotificationAction("忽略") {
            override fun actionPerformed(e: AnActionEvent, notification: Notification) {
                notification.expire()
                PropertiesComponent.getInstance().setValue(KEY_IGNORED_VERSION, info.latestVersion)
            }
        })
        notif.notify(project)
    }

    private fun showInfo(project: Project, message: String) {
        NotificationGroupManager.getInstance()
            .getNotificationGroup(NOTIFICATION_GROUP)
            .createNotification("Wave", message, NotificationType.INFORMATION)
            .notify(project)
    }

    private fun showRestartNotification(project: Project, info: UpdateInfo) {
        val notif = NotificationGroupManager.getInstance()
            .getNotificationGroup(NOTIFICATION_GROUP)
            .createNotification(
                "Wave",
                "Wave 代码智聊 已更新至 v${info.latestVersion}，重启后生效",
                NotificationType.INFORMATION,
            )
        notif.addAction(object : NotificationAction("立即重启") {
            override fun actionPerformed(e: AnActionEvent, notification: Notification) {
                notification.expire()
                ApplicationManager.getApplication().restart()
            }
        })
        notif.notify(project)
    }

    // ── Auto-update (download + schedule install-on-restart) ────────────────────

    private fun downloadAndInstallWithProgress(project: Project, info: UpdateInfo) {
        val zipUrl = info.zipUrl ?: return
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, "正在下载更新...", true) {
            override fun run(indicator: ProgressIndicator) {
                indicator.isIndeterminate = true
                val tmpDir = System.getProperty("java.io.tmpdir")
                val fileName = zipUrl.substringAfterLast('/').substringBefore('?').ifEmpty { "wave-update.zip" }
                val zipFile = File(tmpDir, "wave-update-$fileName")
                try {
                    httpDownload(zipUrl, zipFile)
                    installPluginFromDisk(zipFile)
                    Edt.invokeLater { showRestartNotification(project, info) }
                } catch (t: Throwable) {
                    // installAfterRestart / PluginInstaller are @Internal and may throw Error
                    // (NoSuchMethodError/NoClassDefFoundError) on future platform versions.
                    // Guarantee a manual fallback: open the release page in the browser.
                    LOG.warn("Auto-update failed: ${t.message}", t)
                    Edt.invokeLater {
                        NotificationGroupManager.getInstance()
                            .getNotificationGroup(NOTIFICATION_GROUP)
                            .createNotification(
                                "Wave",
                                "自动更新失败，请手动下载更新",
                                NotificationType.ERROR,
                            ).notify(project)
                        BrowserUtil.browse(info.downloadUrl)
                    }
                } finally {
                    try { if (zipFile.exists()) zipFile.delete() } catch (_: Exception) {}
                }
            }
        })
    }

    /**
     * Schedule installation of [zipFile] to take effect on next IDE restart.
     *
     * Uses [PluginInstaller.installAfterRestart], which appends delete-old + unzip-new
     * commands to the startup action script: on next launch the currently-installed plugin
     * is removed and the new archive is unpacked into the plugins directory. The descriptor
     * and old install path come from the running plugin via [PluginManagerCore.getPlugin],
     * so no descriptor parsing is needed.
     */
    private fun installPluginFromDisk(zipFile: File) {
        ApplicationManager.getApplication().invokeAndWait {
            WriteAction.run<Exception> {
                val descriptor = PluginManagerCore.getPlugin(PluginId.getId(PLUGIN_ID))
                    ?: throw UpdateCheckException("Wave plugin descriptor not found")
                val oldPath = (descriptor as? IdeaPluginDescriptorImpl)?.path
                    ?: throw UpdateCheckException("Cannot resolve plugin install path")
                PluginInstaller.installAfterRestart(
                    descriptor,
                    zipFile.toPath(),
                    oldPath,
                    /* deleteSrc = */ true,
                )
            }
        }
    }

    private fun currentVersion(): String =
        PluginManagerCore.getPlugin(PluginId.getId(PLUGIN_ID))?.version ?: ""

    private class UpdateCheckException(message: String) : RuntimeException(message)
}
