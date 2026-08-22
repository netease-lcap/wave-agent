package com.wave.jetbrains

import com.intellij.ide.BrowserUtil
import com.intellij.notification.Notification
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.wave.jetbrains.session.WaveSession
import com.wave.jetbrains.stdio.BinaryResolver
import com.wave.jetbrains.stdio.NotificationRouter
import com.wave.jetbrains.stdio.StdioClient
import com.wave.jetbrains.util.Edt
import com.wave.jetbrains.util.WaveAppLog
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * Owns the single shared `wave --stdio` process + NotificationRouter for all WaveSessions
 * in this project, mirroring the VSCE ChatProvider's shared-client architecture.
 *
 * Session-scoped notifications are demuxed by sessionId via the router; the shared client
 * is never per-session. The bundled CLI is prepared (copied to ~/.wave/cli + ripgrep
 * download) pre-spawn in [ensureClient] via BinaryResolver, so no post-init reinit is needed.
 */
@Service(Service.Level.PROJECT)
class WaveBackendService(private val project: Project) : Disposable {

    @Volatile
    private var sharedClient: StdioClient? = null
    @Volatile
    private var router: NotificationRouter? = null

    /** The IDE notification shown while the bundled CLI / ripgrep is being prepared. */
    @Volatile
    private var installNotification: Notification? = null

    private val initMutex = Mutex()

    private val sessions = java.util.Collections.synchronizedSet(mutableSetOf<WaveSession>())

    fun registerSession(s: WaveSession) { sessions.add(s) }
    fun unregisterSession(s: WaveSession) { sessions.remove(s) }

    /**
     * Push updated config to every active session, mirroring VSCE ChatProvider.updateAllSessionsConfig
     * (chatProvider.ts:104-108). Called after login/logout/config-save/plugin-mutation so all chat
     * tabs pick up the new apiKey/model/headers. sessionId rekey is handled per-agent.
     */
    suspend fun updateAllSessionsConfig(params: JsonObject) {
        val active = synchronized(sessions) { sessions.toList() }
        active.forEach { s -> runCatching { s.updateConfig(params) } }
    }

    suspend fun ensureClient(): Pair<StdioClient, NotificationRouter> {
        initMutex.withLock {
            if (sharedClient == null) {
                BinaryResolver.onInstall = { message ->
                    Edt.invokeLater {
                        // Each progress step replaces the previous notification so the
                        // user sees the latest stage ("正在准备…" → "正在下载…").
                        installNotification?.expire()
                        val notification = NotificationGroupManager.getInstance()
                            .getNotificationGroup("Wave")
                            .createNotification("Wave", message, NotificationType.INFORMATION)
                        notification.notify(project)
                        installNotification = notification
                    }
                }
                try {
                    // Resolve the bundled CLI (copied to ~/.wave/cli + rg download) and
                    // execute it with the system Node.js — no npm-global wave-code needed.
                    val entry = BinaryResolver.resolveWaveBinary()
                    val node = BinaryResolver.findNode()
                    val c = StdioClient(listOf(node, entry), listOf("--stdio"), BinaryResolver.resolveEnv())
                    val r = NotificationRouter(c)
                    r.attach()
                    r.registerGlobal("authUrl") { p ->
                        val url = p?.jsonObject?.get("url")?.jsonPrimitive?.content
                        if (!url.isNullOrEmpty()) {
                            Edt.invokeLater { BrowserUtil.browse(url) }
                        }
                    }
                    sharedClient = c
                    router = r
                } catch (e: Exception) {
                    // Single chokepoint for every CLI preparation failure (node
                    // resolution, CLI copy, ripgrep download): record in
                    // jetbrains.log, then let the caller surface the error.
                    WaveAppLog.error("ensureClient failed", e)
                    throw e
                } finally {
                    // Dismiss the install-progress notification once the CLI is ready —
                    // it never auto-expires and would linger forever, making the user
                    // think the download is still running (the webview only receives
                    // setInitialState after this returns).
                    Edt.invokeLater {
                        installNotification?.expire()
                        installNotification = null
                    }
                    BinaryResolver.onInstall = null
                }
            }
        }
        return sharedClient!! to router!!
    }

    /**
     * Initialize a session on the shared client. The bundled CLI is prepared
     * pre-spawn in [ensureClient], so no post-init version negotiation is
     * needed here. Mirrors VSCE chatProvider.ts initializeAgent (post-refactor).
     */
    suspend fun initializeSession(session: WaveSession, restoreSessionId: String?): Boolean {
        return session.initialize(restoreSessionId)
    }

    override fun dispose() {
        runCatching { sharedClient?.close() }
        runCatching { installNotification?.expire() }
    }

    companion object {
        fun getInstance(project: Project): WaveBackendService =
            project.getService(WaveBackendService::class.java)
    }
}
