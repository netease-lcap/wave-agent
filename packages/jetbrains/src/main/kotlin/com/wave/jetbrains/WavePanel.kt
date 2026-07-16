package com.wave.jetbrains

import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
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
        // Kotlin → webview
        if (SwingUtilities.isEventDispatchThread()) {
            bridge.postMessage(command, payload)
        } else {
            Edt.invokeLater { bridge.postMessage(command, payload) }
        }
    }
    private val handler: MessageHandler = MessageHandler(session) { command, payload ->
        if (SwingUtilities.isEventDispatchThread()) {
            bridge.postMessage(command, payload)
        } else {
            Edt.invokeLater { bridge.postMessage(command, payload) }
        }
    }

    val component: JPanel = JPanel(BorderLayout()).apply {
        border = JBUI.Borders.empty()
        add(browser.component, BorderLayout.CENTER)
    }

    init {
        bridge.onMessage = { msg -> handler.handle(msg) }
        loadWebview()
    }

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
    }
}
