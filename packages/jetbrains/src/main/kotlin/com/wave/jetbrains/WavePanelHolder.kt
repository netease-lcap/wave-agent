package com.wave.jetbrains

import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.openapi.wm.ToolWindow
import com.intellij.ui.content.Content
import com.intellij.ui.content.ContentFactory
import com.wave.jetbrains.util.Edt
import java.util.concurrent.ConcurrentHashMap
import javax.swing.SwingUtilities

/**
 * Project-scoped registry of all open Wave chat tabs ([WavePanel]s), tracking the active one so
 * IDE actions (e.g. AddSelectionToWaveAction) can locate the focused panel without reaching into
 * the tool window's content manager. Mirrors VSCE's `tabSessions`/`tabPanels` parallel Maps in
 * chatProvider.ts: each tab is an independent [WaveSession] sharing one stdio backend, disposed on
 * tab close via [Content.setDisposer].
 */
@Service(Service.Level.PROJECT)
class WavePanelHolder(private val project: Project) {
    @Volatile
    var activePanel: WavePanel? = null

    @Volatile
    var toolWindow: ToolWindow? = null

    private val panels = ConcurrentHashMap<String, WavePanel>()

    fun register(tabId: String, panel: WavePanel) {
        panels[tabId] = panel
        if (activePanel == null) {
            activePanel = panel
        }
    }

    fun unregister(tabId: String, panel: WavePanel) {
        if (panels.remove(tabId, panel) && activePanel === panel) {
            activePanel = panels.values.firstOrNull()
        }
    }

    fun allPanels(): Collection<WavePanel> = panels.values.toList()

    /**
     * Creates and registers a new chat tab in the tool window. Swing content (Content +
     * JBCefBrowser) must be created on the EDT; if the caller is already on the EDT the work runs
     * inline, otherwise it is scheduled via [Edt.invokeLater]. Returns the new panel, or null if
     * the tool window is gone or the work was deferred to the EDT.
     */
    fun addChatTab(tabId: String? = null): WavePanel? {
        val tw = toolWindow ?: return null
        val id = tabId ?: "tab_${System.currentTimeMillis()}_${System.nanoTime().toString(36)}"

        fun build(): WavePanel {
            val panel = WavePanel(project, id)
            val content = ContentFactory.getInstance().createContent(panel.component, "新会话", false)
            content.putUserData(TAB_KEY, id)
            content.setDisposer(panel)
            tw.contentManager.addContent(content)
            tw.contentManager.setSelectedContent(content)
            activePanel = panel
            return panel
        }

        return if (SwingUtilities.isEventDispatchThread()) {
            build()
        } else {
            Edt.invokeLater { build() }
            null
        }
    }

    /** Promotes the panel backing [content] (looked up via [TAB_KEY]) to the active panel. */
    fun setActiveByContent(content: Content?) {
        if (content == null) return
        val tabId = content.getUserData(TAB_KEY) ?: return
        panels[tabId]?.let { activePanel = it }
    }

    companion object {
        val TAB_KEY = Key<String>("waveTabId")

        fun getInstance(project: Project): WavePanelHolder =
            project.getService(WavePanelHolder::class.java)
    }
}
