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
import com.wave.jetbrains.editor.WaveChatVirtualFile
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
import javax.swing.JSplitPane
import javax.swing.KeyStroke
import javax.swing.SwingUtilities

/**
 * Root panel hosting the JCEF browser that renders the shared webview bundle. Rendered as an
 * editor-area tab via [com.wave.jetbrains.editor.WaveChatFileEditor] (the JetBrains equivalent
 * of VSCE's `createWebviewPanel` chat tab).
 *
 * The panel is a horizontal [JSplitPane]: the left column is the chat webview, the right column
 * is a lazily-created plan-preview browser shown only while an ExitPlanMode confirmation is
 * pending (the JetBrains equivalent of CC's adjacent `claudePlanPreview` column). Plan content
 * is rendered as markdown HTML via [showPlanPreview], and the right column collapses back when
 * hidden.
 *
 * Wires: webview ←→ [JcefBrowserBridge] ←→ [MessageHandler] ←→ [WaveSession] ←→ stdio.
 */
class WavePanel(
    private val project: Project,
    val tabId: String,
    val chatFile: WaveChatVirtualFile,
) : Disposable {
    private val LOG = logger<WavePanel>()

    private val browser: JBCefBrowser = JBCefBrowser()
    private val bridge: JcefBrowserBridge = JcefBrowserBridge(browser)

    private val session: WaveSession = WaveSession(project,
        postMessageFn = { command, payload -> postToWebview(command, payload) },
        tabTitleFn = { title -> WavePanelHolder.getInstance(project).setTabTitle(tabId, title) },
    )
    private val handler: MessageHandler = MessageHandler(project, session) { command, payload ->
        postToWebview(command, payload)
    }

    /** Left column: the chat webview. */
    private val chatPane: JPanel = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty()
        add(browser.component, BorderLayout.CENTER)
    }

    /** Plan-preview browser, created lazily on the first ExitPlanMode and reused afterwards. */
    private var planBrowser: JBCefBrowser? = null

    val component: JSplitPane = JSplitPane(JSplitPane.HORIZONTAL_SPLIT).apply {
        leftComponent = chatPane
        isContinuousLayout = true
        dividerSize = 4
        // Keep the chat column wider than the plan preview (CC splits ~60/40).
        resizeWeight = 0.62
    }

    init {
        bridge.onMessage = { msg -> handler.handle(msg) }
        WavePanelHolder.getInstance(project).register(tabId, this)
        loadWebview()
        subscribeToLafChanges()
        registerWebviewShortcuts()
    }

    /** True when [s] is this panel's session (used to route permission requests → panel). */
    fun belongsTo(s: WaveSession): Boolean = session === s

    /** Project accessor for collaborators that hold only the panel (e.g. the FileEditor). */
    fun project(): Project = this.project

    /**
     * Renders the ExitPlanMode plan content in the right column of this panel's split pane.
     * [markdownHtml] is a fully self-contained HTML document (plan preview builder output);
     * loading it replaces the previous plan. The right column appears on first use and stays
     * until the panel is disposed (user closes the editor tab), per spec: plan previews persist
     * across approvals/denials and are reused for repeated ExitPlanMode calls in one session.
     */
    fun showPlanPreview(markdownHtml: String) {
        val plan = planBrowser ?: JBCefBrowser().also { planBrowser = it }
        plan.loadHTML(markdownHtml)
        if (component.rightComponent == null) {
            component.rightComponent = plan.component
            // The split pane may not be laid out yet (width == 0); let the divider settle
            // after layout using resizeWeight instead of computing a pixel position.
            Edt.invokeLater {
                if (!component.isShowing) return@invokeLater
                component.dividerLocation = (component.width * 0.62).toInt()
            }
        }
    }

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
                    planBrowser?.let { pb ->
                        pb.cefBrowser.executeJavaScript(
                            WebviewContentBuilder.buildLafRefreshScript(), "", 0,
                        )
                    }
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
        planBrowser?.dispose()
        planBrowser = null
        runCatching { WavePanelHolder.getInstance(project).unregister(tabId, this) }
    }
}
