package com.wave.jetbrains

import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.wave.jetbrains.session.WaveSession
import com.wave.jetbrains.stdio.BinaryResolver
import com.wave.jetbrains.stdio.NotificationRouter
import com.wave.jetbrains.stdio.StdioClient
import com.wave.jetbrains.util.Edt
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
 * is never per-session. CLI version upgrade happens pre-spawn in [ensureClient] via
 * BinaryResolver.ensureCliUpToDate, so no post-init reinit is needed.
 */
@Service(Service.Level.PROJECT)
class WaveBackendService(private val project: Project) : Disposable {

    @Volatile
    private var sharedClient: StdioClient? = null
    @Volatile
    private var router: NotificationRouter? = null

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
                val pluginVer = WaveSession.pluginVersion()
                val binary = if (pluginVer.isNotEmpty()) {
                    BinaryResolver.ensureCliUpToDate(pluginVer)
                } else {
                    BinaryResolver.resolveWaveBinary()
                }
                val c = StdioClient(binary, listOf("--stdio"), BinaryResolver.resolveEnv())
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
            }
        }
        return sharedClient!! to router!!
    }

    /**
     * Initialize a session on the shared client. The CLI is upgraded pre-spawn
     * in [ensureClient], so no post-init version negotiation is needed here.
     * Mirrors VSCE chatProvider.ts initializeAgent (post-refactor).
     */
    suspend fun initializeSession(session: WaveSession, restoreSessionId: String?): Boolean {
        return session.initialize(restoreSessionId)
    }

    override fun dispose() {
        runCatching { sharedClient?.close() }
    }

    companion object {
        fun getInstance(project: Project): WaveBackendService =
            project.getService(WaveBackendService::class.java)
    }
}
