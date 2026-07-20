package com.wave.jetbrains

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
import kotlinx.serialization.json.JsonObject
import java.awt.BorderLayout
import javax.swing.JPanel
import javax.swing.SwingUtilities

/**
 * Root panel hosting the JCEF browser that renders the shared webview bundle.
 * Wires: webview ←→ [JcefBrowserBridge] ←→ [MessageHandler] ←→ [WaveSession] ←→ stdio.
 */
class WavePanel(private val project: Project) {
    private val LOG = logger<WavePanel>()

    private val browser: JBCefBrowser = JBCefBrowser()
    private val bridge: JcefBrowserBridge = JcefBrowserBridge(browser)

    private val session: WaveSession = WaveSession(project) { command, payload ->
        postToWebview(command, payload)
    }
    private val handler: MessageHandler = MessageHandler(project, session) { command, payload ->
        postToWebview(command, payload)
    }

    val component: JPanel = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty()
        add(browser.component, BorderLayout.CENTER)
    }

    init {
        bridge.onMessage = { msg -> handler.handle(msg) }
        WavePanelHolder.getInstance(project).panel = this
        loadWebview()
        subscribeToLafChanges()
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
                Edt.invokeLater { bridge.runJavaScript(WebviewContentBuilder.buildLafRefreshScript()) }
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
        }
    }

    fun dispose() {
        session.dispose()
        bridge.dispose()
        browser.dispose()
        try {
            if (WavePanelHolder.getInstance(project).panel === this) {
                WavePanelHolder.getInstance(project).panel = null
            }
        } catch (_: Exception) {
        }
    }
}
