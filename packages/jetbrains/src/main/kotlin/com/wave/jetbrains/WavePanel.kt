package com.wave.jetbrains

import com.intellij.openapi.Disposable
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CustomShortcutSet
import com.intellij.openapi.actionSystem.KeyboardShortcut
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.ide.ui.LafManagerListener
import com.intellij.ui.jcef.JBCefBrowser
import com.intellij.util.ui.JBUI
import com.wave.jetbrains.bridge.JcefBrowserBridge
import com.wave.jetbrains.bridge.WebviewContentBuilder
import com.wave.jetbrains.session.MessageHandler
import com.wave.jetbrains.session.WaveSession
import com.wave.jetbrains.util.Edt
import com.wave.jetbrains.util.WaveAppLog
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.put
import kotlinx.serialization.json.buildJsonObject
import java.awt.BorderLayout
import java.awt.event.InputEvent
import java.awt.event.KeyEvent
import javax.swing.JPanel
import javax.swing.KeyStroke
import javax.swing.SwingUtilities

/**
 * Root panel hosting the JCEF browser that renders the shared webview bundle. Rendered inside the
 * Wave side-bar tool window as the single chat panel (backed by one [WaveSession] on the shared
 * stdio backend, managed by [WavePanelHolder]).
 *
 * Wires: webview ←→ [JcefBrowserBridge] ←→ [MessageHandler] ←→ [WaveSession] ←→ stdio.
 */
class WavePanel(private val project: Project) : Disposable {
    private val LOG = logger<WavePanel>()

    /** Stable internal id, used to key this chat's plan tab. */
    val tabId: String = "wave-chat"

    private val browser: JBCefBrowser = JBCefBrowser()
    private val bridge: JcefBrowserBridge = JcefBrowserBridge(browser)

    private val session: WaveSession = WaveSession(project,
        postMessageFn = { command, payload -> postToWebview(command, payload) },
        tabTitleFn = { title -> WavePanelHolder.getInstance(project).setTabTitle(title) },
    )
    private val handler: MessageHandler = MessageHandler(project, session) { command, payload ->
        postToWebview(command, payload)
    }

    val component: JPanel = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty()
        add(browser.component, BorderLayout.CENTER)
    }

    init {
        bridge.onMessage = { msg -> handler.handle(msg) }
        WavePanelHolder.getInstance(project).register(this)
        loadWebview()
        subscribeToLafChanges()
        registerWebviewShortcuts()
    }

    /** True when [s] is this panel's session (used to route permission requests → panel). */
    fun belongsTo(s: WaveSession): Boolean = session === s

    /** Project accessor for collaborators that hold only the panel (e.g. the FileEditor). */
    fun project(): Project = this.project

    /**
     * JCEF re-posts keystrokes from the browser back into the AWT event queue (see
     * `JBCefBrowserBase.CefKeyboardHandler`), so the IDE keymap action bound to Ctrl+R (Refresh)
     * still fires even when the webview has focus and already handled the key in the DOM. A
     * component-scoped [AnAction] registered on `browser.component` outranks the global keymap
     * action while the component (or a descendant) owns focus, swallowing the IDE action.
     *
     * `registerCustomShortcutSet` also consumes the AWT key event before CEF can see it, so the
     * webview DOM never receives the keydown. Instead of a no-op, the action actively forwards
     * the intended operation to the webview over the existing message bridge as a
     * `triggerShortcut` command, which ChatApp routes to [MessageInput.triggerShortcut]. This
     * mirrors the official `JcefShortcutProvider` pattern (forward into CEF rather than swallow).
     * Registration is bound to `this` [Disposable] so it is torn down automatically on dispose.
     * Shift+Tab needs no interception — it reaches the DOM normally. See issue #1429.
     */
    private fun registerWebviewShortcuts() {
        val forwardHistorySearch = shortcutAction("history-search")
        val historyShortcuts = CustomShortcutSet(
            KeyboardShortcut(KeyStroke.getKeyStroke(KeyEvent.VK_R, InputEvent.CTRL_DOWN_MASK), null),
            KeyboardShortcut(KeyStroke.getKeyStroke(KeyEvent.VK_R, InputEvent.META_DOWN_MASK), null),
        )
        forwardHistorySearch.registerCustomShortcutSet(historyShortcuts, browser.component, this)

        // Cmd/Ctrl+Shift+M opens the permission-mode menu (aligned with Claude Code Desktop).
        // The IDE's default binding for this chord is "Move Caret to Matching Brace"; the
        // component-scoped action outranks it while the webview owns focus and forwards the
        // intended operation via the triggerShortcut bridge, mirroring history-search above.
        val openPermissionModeMenu = shortcutAction("open-permission-mode")
        val permissionModeShortcuts = CustomShortcutSet(
            KeyboardShortcut(
                KeyStroke.getKeyStroke(
                    KeyEvent.VK_M,
                    InputEvent.CTRL_DOWN_MASK or InputEvent.SHIFT_DOWN_MASK,
                ),
                null,
            ),
            KeyboardShortcut(
                KeyStroke.getKeyStroke(
                    KeyEvent.VK_M,
                    InputEvent.META_DOWN_MASK or InputEvent.SHIFT_DOWN_MASK,
                ),
                null,
            ),
        )
        openPermissionModeMenu.registerCustomShortcutSet(permissionModeShortcuts, browser.component, this)
    }

    /** An [AnAction] that forwards a named webview shortcut via the message bridge. */
    private fun shortcutAction(name: String): AnAction = object : AnAction() {
        override fun actionPerformed(e: AnActionEvent) {
            val payload = buildJsonObject { put("name", name) }
            postToWebview("triggerShortcut", payload)
        }
    }

    /**
     * JCEF does not re-theme on IDE Look-and-Feel changes, so listen for them and re-inject the
     * `--vscode-*` overrides derived from the new LaF. The connection is tied to the browser's
     * Disposable so it is removed when the panel is disposed.
     */
    private fun subscribeToLafChanges() {
        ApplicationManager.getApplication().messageBus
            .connect(browser)
            .subscribe(LafManagerListener.TOPIC, LafManagerListener {
                Edt.invokeLater {
                    bridge.runJavaScript(WebviewContentBuilder.buildLafRefreshScript())
                }
            })
    }

    /** Kotlin → webview, marshalled onto the EDT. */
    private fun postToWebview(command: String, payload: JsonObject) {
        if (SwingUtilities.isEventDispatchThread()) {
            bridge.postMessage(command, payload)
        } else {
            Edt.invokeLater { bridge.postMessage(command, payload) }
        }
    }

    /** Public entry for IDE actions (e.g. AddSelectionToWaveAction) to push messages into the webview. */
    fun postMessage(command: String, payload: JsonObject) = postToWebview(command, payload)

    private fun loadWebview() {
        try {
            val assets = WebviewContentBuilder.extractAssets()
            LOG.info("WavePanel loading webview from ${assets.indexUrl}")
            bridge.loadUrl(assets.indexUrl)
        } catch (e: Exception) {
            LOG.error("Failed to load wave webview", e)
            WaveAppLog.error("Failed to load wave webview", e)
        }
    }

    override fun dispose() {
        session.dispose()
        bridge.dispose()
        browser.dispose()
        runCatching { WavePanelHolder.getInstance(project).unregister(this) }
    }
}
