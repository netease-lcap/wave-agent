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
import com.wave.jetbrains.stdio.StartupStages
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
 * is never per-session. The bundled CLI is prepared (copied to ~/.wave/cli) pre-spawn in
 * [ensureClient] via BinaryResolver, so no post-init reinit is needed.
 */
@Service(Service.Level.PROJECT)
class WaveBackendService(private val project: Project) : Disposable {

    @Volatile
    private var sharedClient: StdioClient? = null
    @Volatile
    private var router: NotificationRouter? = null

    /** The IDE notification shown while the bundled CLI is being prepared. */
    @Volatile
    private var installNotification: Notification? = null

    /**
     * 当前那次「首次启动」的阶段去处：把 [StartupStages.text] 的结果推给发起启动的
     * 那个分屏（面板加载态下方那行字）。绑一次就留着——CLI 自装工具依赖（ripgrep /
     * sharp）上报发生在 spawn 之后几百毫秒，那时 [ensureClient] 早已返回，回调若在
     * finally 里清掉就整段丢了。
     */
    @Volatile
    private var stageListener: ((String) -> Unit)? = null

    private val initMutex = Mutex()

    private val sessions = java.util.Collections.synchronizedSet(mutableSetOf<WaveSession>())

    fun registerSession(s: WaveSession) { sessions.add(s) }
    fun unregisterSession(s: WaveSession) { sessions.remove(s) }

    /**
     * Rebuild every active session so login/logout and plugin mutations (构造期副作用)
     * take effect in all chat tabs. Mirrors VSCE ChatProvider.updateAllSessionsConfig
     * (chatProvider.ts:104-108) — it too sends **no** session-level overrides: 模型经
     * `setModel` RPC、用户偏好落用户级 settings.json 并由 SDK 实时重载（spec core/agent-config.md）。
     * sessionId rekey is handled per-agent.
     */
    suspend fun updateAllSessionsConfig() {
        val active = synchronized(sessions) { sessions.toList() }
        active.forEach { s -> runCatching { s.updateConfig(JsonObject(emptyMap())) } }
    }

    suspend fun ensureClient(onStage: (String) -> Unit = {}): Pair<StdioClient, NotificationRouter> {
        initMutex.withLock {
            if (sharedClient == null) {
                stageListener = onStage
                BinaryResolver.onStage = { stage -> reportStage(stage) }
                try {
                    // Resolve the bundled CLI (copied to ~/.wave/cli) and run it
                    // on the managed Node.js runtime (~/.wave/runtime/node) —
                    // no npm-global wave-code, no system Node.js needed. Both
                    // steps report their stage through BinaryResolver.onStage.
                    val entry = BinaryResolver.resolveWaveBinary()
                    val node = BinaryResolver.resolveNode()
                    val c = StdioClient(listOf(node, entry), listOf("--stdio"), BinaryResolver.resolveEnv())
                    val r = NotificationRouter(c)
                    r.attach()
                    r.registerGlobal("authUrl") { p ->
                        val url = p?.jsonObject?.get("url")?.jsonPrimitive?.content
                        if (!url.isNullOrEmpty()) {
                            Edt.invokeLater { BrowserUtil.browse(url) }
                        }
                    }
                    // CLI 启动期自装 ripgrep / sharp 的阶段发生在任何会话存在之前，
                    // 因此不带 sessionId，走全局通道（与 authUrl 同一条路）。
                    r.registerGlobal("startupStage") { p ->
                        val stage = p?.jsonObject?.get("stage")?.jsonPrimitive?.content
                        if (!stage.isNullOrEmpty()) reportStage(stage)
                    }
                    sharedClient = c
                    router = r
                } catch (e: Exception) {
                    // Single chokepoint for every CLI preparation failure (node
                    // resolution, CLI copy): record in jetbrains.log, then let the
                    // caller surface the error.
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
                    BinaryResolver.onStage = null
                }
            }
        }
        return sharedClient!! to router!!
    }

    /**
     * 一次启动阶段上报（spec ui/stdio-transport.md「首次启动的进度文案」）。
     *
     * 两条去处，都只是**旁路**——推不出去、没人消费都不影响启动，也不参与任何完成
     * 条件：
     * - 面板：转成文案交给 [stageListener]，显示在加载态下方；
     * - IDE 通知：只覆盖**宿主自己**的步骤（[HOST_STAGES]）。这几步也可能从设置标签页
     *   那种没有加载动画的入口触发，那时面板文案无处可显；而 CLI 自装工具依赖是后台
     *   降级步骤（失败只让 grep / 图片处理降级），为它弹通知只会变成噪声。
     */
    private fun reportStage(stage: String) {
        val text = StartupStages.text(stage) ?: return
        runCatching { stageListener?.invoke(text) }
        if (stage in HOST_STAGES) showInstallNotification(text)
    }

    /** 每条替换上一条：用户看到的是最新阶段，不是一串堆叠的通知。 */
    private fun showInstallNotification(text: String) {
        Edt.invokeLater {
            installNotification?.expire()
            installNotification = NotificationGroupManager.getInstance()
                .getNotificationGroup("Wave")
                .createNotification("CodeWave IDE", text, NotificationType.INFORMATION)
                .also { it.notify(project) }
        }
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
        stageListener = null
    }

    companion object {
        /** 宿主自己的启动步骤（spawn 之前）——只有这些同时弹 IDE 通知。 */
        private val HOST_STAGES = setOf(
            StartupStages.DOWNLOADING_RUNTIME,
            StartupStages.INSTALLING_RUNTIME,
            StartupStages.SYNCING_CLI,
        )

        fun getInstance(project: Project): WaveBackendService =
            project.getService(WaveBackendService::class.java)
    }
}
