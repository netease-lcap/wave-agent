package com.wave.jetbrains.editor

import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorLocation
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.jcef.JBCefBrowser
import com.wave.jetbrains.WavePanelHolder
import com.wave.jetbrains.bridge.JcefBrowserBridge
import com.wave.jetbrains.bridge.WebviewContentBuilder
import com.wave.jetbrains.session.MessageHandler
import com.wave.jetbrains.session.WaveSession
import com.wave.jetbrains.util.Edt
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.handler.CefLoadHandlerAdapter
import org.jetbrains.annotations.Nls
import java.beans.PropertyChangeListener
import javax.swing.JComponent
import javax.swing.SwingUtilities

/**
 * Renders the shared settings webview (SettingsPage) as an editor-area tab — the JetBrains
 * counterpart of VSCE's `createWebviewPanel` settings panel (webviewManager.ts
 * getOrCreateSettingsPanel). The tab hosts a [JBCefBrowser] that loads the settings entry bundle
 * (`settings.js` / `settings.css` + the vscode-shim bridge) extracted by
 * [WebviewContentBuilder.extractSettingsAssets].
 *
 * Message wiring (settings webview ↔ CLI session):
 * - webview → host: the [JcefBrowserBridge] forwards every message into a dedicated
 *   [MessageHandler] bound to the chat panel's [WaveSession] (or a throwaway session when no chat
 *   exists yet — config RPCs keep working, AGENTS.md RPCs degrade), so the existing
 *   getConfiguration / updateConfiguration / getAgentsContent / setAgentsContent /
 *   closeSettings RPC handlers are reused verbatim.
 * - host → webview: the handler's postMessage callback delivers responses
 *   (configurationResponse / configurationUpdated / configurationError / agentsContentResponse /
 *   agentsContentSaved) straight back to this settings webview via [postMessage].
 *
 * The tab is a single instance per project ([WavePanelHolder] registry); repeated opens reuse it.
 * It is independent of the chat session lifecycle — closing the chat panel does not close it.
 */
class WaveSettingsFileEditor(
    private val project: Project,
    private val file: WaveSettingsVirtualFile,
) : UserDataHolderBase(), FileEditor {

    private val LOG = logger<WaveSettingsFileEditor>()

    private val browser = JBCefBrowser()
    private val bridge = JcefBrowserBridge(browser)

    private val session: WaveSession
    private val ownsSession: Boolean
    private val handler: MessageHandler
    private var disposed = false

    /** Last workdir pushed via [pushWorkdir]; re-delivered on every page load end. */
    private var lastWorkdir: String? = null

    /** Last nav (settings 选项卡，如 "subagents" / "skills") pushed via [pushWorkdir]. */
    private var lastNav: String? = null

    init {
        val holder = WavePanelHolder.getInstance(project)
        val chatSession = holder.chatSession()
        // Fall back to an uninitialized throwaway session so the settings tab works standalone
        // (no active chat): configuration RPCs (getConfiguration/updateConfiguration) need no
        // agent; AGENTS.md RPCs degrade to empty content / honest save failure.
        session = chatSession ?: WaveSession(project, { _, _ -> })
        ownsSession = chatSession == null
        handler = MessageHandler(project, session) { command, payload ->
            postToWebview(command, payload)
        }
        holder.registerSettingsEditor(this)
        bridge.onMessage = { msg -> handler.handle(msg) }
        // JCEF loads the page asynchronously, so a settingsState posted right after openFile is
        // dropped. Re-deliver the workdir on every main-frame load end so the 个性化 view always
        // knows which project it targets (mirrors VSCE's guaranteed postSettingsMessage delivery).
        browser.jbCefClient.addLoadHandler(object : CefLoadHandlerAdapter() {
            override fun onLoadEnd(b: CefBrowser, frame: CefFrame, httpStatusCode: Int) {
                if (frame.isMain) pushSettingsState()
            }
        }, browser.cefBrowser)
        loadSettings()
    }

    /** Kotlin → webview, marshalled onto the EDT (used by WavePanelHolder to push settingsState). */
    fun postMessage(command: String, payload: JsonObject) {
        if (disposed) return
        if (SwingUtilities.isEventDispatchThread()) {
            bridge.postMessage(command, payload)
        } else {
            Edt.invokeLater { if (!disposed) bridge.postMessage(command, payload) }
        }
    }

    /** Stores and pushes the settings 个性化 workdir + optional nav (re-delivered on load end). */
    fun pushWorkdir(workdir: String, nav: String? = null) {
        lastWorkdir = workdir
        if (nav != null) lastNav = nav
        pushSettingsState()
    }

    private fun pushSettingsState() {
        val wd = lastWorkdir ?: return
        val json = buildJsonObject {
            put("workdir", wd)
            lastNav?.let { put("nav", it) }
        }
        postMessage("settingsState", json)
    }

    private fun loadSettings() {
        try {
            val assets = WebviewContentBuilder.extractSettingsAssets()
            LOG.info("WaveSettings loading webview from ${assets.indexUrl}")
            bridge.loadUrl(assets.indexUrl)
        } catch (e: Exception) {
            LOG.error("Failed to load wave settings webview", e)
        }
    }

    private fun postToWebview(command: String, payload: JsonObject) = postMessage(command, payload)

    override fun getComponent(): JComponent = browser.component

    override fun getPreferredFocusedComponent(): JComponent = browser.component

    override fun getName(): @Nls(capitalization = Nls.Capitalization.Title) String = "设置"

    override fun getFile(): VirtualFile = file

    override fun setState(state: FileEditorState) {}

    override fun isModified(): Boolean = false

    override fun isValid(): Boolean = true

    override fun selectNotify() {}

    override fun deselectNotify() {}

    override fun addPropertyChangeListener(listener: PropertyChangeListener) {}

    override fun removePropertyChangeListener(listener: PropertyChangeListener) {}

    override fun getCurrentLocation(): FileEditorLocation? = null

    override fun dispose() {
        if (disposed) return
        disposed = true
        WavePanelHolder.getInstance(project).unregisterSettingsEditor(this)
        if (ownsSession) session.dispose()
        bridge.dispose()
        browser.dispose()
    }
}
