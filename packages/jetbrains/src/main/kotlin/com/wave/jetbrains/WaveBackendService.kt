package com.wave.jetbrains

import com.intellij.ide.BrowserUtil
import com.intellij.openapi.Disposable
import com.intellij.openapi.components.Service
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.wave.jetbrains.ide.IdeService
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
 * is never per-session. CLI auto-upgrade (version negotiation) is centralized here so it
 * can reinitialize every active session after killing the shared process.
 */
@Service(Service.Level.PROJECT)
class WaveBackendService(private val project: Project) : Disposable {
    private val LOG = logger<WaveBackendService>()

    @Volatile
    private var sharedClient: StdioClient? = null
    @Volatile
    private var router: NotificationRouter? = null

    private val initMutex = Mutex()
    private val upgradeMutex = Mutex()
    @Volatile
    private var cliUpgradeAttempted = false

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
                val binary = BinaryResolver.resolveWaveBinary()
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
     * Initialize a session on the shared client, then run the CLI version-negotiation
     * upgrade check (once per activation). Mirrors VSCE chatProvider.ts:264-321.
     */
    suspend fun initializeSession(session: WaveSession, restoreSessionId: String?): Boolean {
        val upgradedThisCall = cliUpgradeAttempted
        val ok = session.initialize(restoreSessionId)
        if (!ok) return false
        val pluginVer = WaveSession.pluginVersion()
        if (!upgradedThisCall && pluginVer.isNotEmpty()) {
            val srv = session.agent?.serverVersion
            if (!srv.isNullOrEmpty()) {
                val cmp = try { BinaryResolver.compareVersions(srv, pluginVer) } catch (_: Exception) { 0 }
                if (cmp < 0) {
                    upgradeMutex.withLock {
                        if (!cliUpgradeAttempted) {
                            cliUpgradeAttempted = true
                            try {
                                LOG.info("CLI $srv < plugin $pluginVer; upgrading wave-code")
                                reinitAllAfterUpgrade()
                            } catch (e: Exception) {
                                LOG.error("CLI auto-upgrade failed", e)
                                IdeService.showError(project, "Wave CLI 升级失败，请手动执行: npm install -g wave-code --registry=https://registry.npmmirror.com")
                            }
                        }
                    }
                }
            }
        }
        return true
    }

    /**
     * Kill the shared process, upgrade the CLI binary, rebuild the shared client + router,
     * and re-initialize every previously-active session with its restoreSessionId.
     * Mirrors VSCE chatProvider.ts:332-380.
     */
    private suspend fun reinitAllAfterUpgrade() {
        val active = synchronized(sessions) { sessions.toList() }
            .filter { it.agent != null }
            .map { it to it.sessionId }
        active.forEach { (s, _) -> runCatching { s.destroyAgent() } }
        sharedClient?.close()
        sharedClient = null
        router = null
        BinaryResolver.upgradeWaveBinary(WaveSession.pluginVersion())
        ensureClient()
        active.forEach { (s, rid) -> runCatching { s.initialize(rid) } }
    }

    override fun dispose() {
        runCatching { sharedClient?.close() }
    }

    companion object {
        fun getInstance(project: Project): WaveBackendService =
            project.getService(WaveBackendService::class.java)
    }
}
