package com.wave.jetbrains

import com.intellij.openapi.components.Service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.wave.jetbrains.editor.WaveChatVirtualFile
import com.wave.jetbrains.session.WaveSession
import com.wave.jetbrains.util.Edt
import java.util.concurrent.ConcurrentHashMap
import javax.swing.SwingUtilities

/**
 * Project-scoped registry of all open Wave chat panels ([WavePanel]s), tracking the active one
 * so IDE actions (e.g. AddSelectionToWaveAction) can locate the focused panel without reaching
 * into the editor tab strip. Mirrors VSCE's `tabSessions`/`tabPanels` parallel Maps in
 * chatProvider.ts: each tab is an independent [WaveSession] sharing one stdio backend, disposed
 * on tab close via [WavePanel.dispose] (driven by the editor tab's FileEditor lifecycle).
 *
 * Each session is backed by a unique [WaveChatVirtualFile]; [openChatEditorTab] opens one in the
 * editor area (JetBrains' `createWebviewPanel` equivalent), and [getOrCreatePanel] keeps panel
 * creation idempotent when the platform re-creates editors for the same file.
 */
@Service(Service.Level.PROJECT)
class WavePanelHolder(private val project: Project) {
    @Volatile
    var activePanel: WavePanel? = null
        private set

    private val panels = ConcurrentHashMap<String, WavePanel>()
    private val titles = ConcurrentHashMap<String, String>()

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
        titles.remove(tabId)
    }

    fun allPanels(): Collection<WavePanel> = panels.values.toList()

    fun getPanel(tabId: String): WavePanel? = panels[tabId]

    /** Promotes [panel] to the active panel (called from FileEditor.selectNotify). */
    fun setActivePanel(panel: WavePanel) {
        activePanel = panel
    }

    /**
     * Returns the panel backing [file], creating it on first use. [WaveChatFileEditorProvider]
     * calls this from `createEditor`, which the platform may invoke more than once for the same
     * file (e.g. editor state restore); the map makes the call idempotent.
     */
    fun getOrCreatePanel(project: Project, file: WaveChatVirtualFile): WavePanel =
        panels.getOrPut(file.tabId) { WavePanel(project, file.tabId, file) }

    /**
     * Updates the editor-tab display title for [tabId] and forces the tab label to repaint by
     * renaming the backing virtual file (the tab strip re-queries [WaveEditorTabTitleProvider]
     * on rename). Mirrors VSCE deriving panel.title from the first user message (webview
     * getSessionTitle); here the JB backend pushes the derived title.
     */
    fun setTabTitle(tabId: String, title: String) {
        val safe = if (title.isBlank()) "新对话" else title
        titles[tabId] = safe
        val panel = panels[tabId] ?: return
        val rename = {
            try {
                panel.chatFile.rename(null, safe)
            } catch (_: Exception) {
                // LightVirtualFile rename is in-memory only; ignore any race with dispose.
            }
        }
        if (SwingUtilities.isEventDispatchThread()) rename() else Edt.invokeLater(rename)
    }

    /** Current tab title for [tabId] (fallback for FileEditor.getName / EditorTabTitleProvider). */
    fun currentTitle(tabId: String): String = titles[tabId] ?: "新对话"

    /**
     * Opens a new chat session as an editor-area tab (JetBrains' `createWebviewPanel` tab mode).
     * The tab is created lazily — the panel/session materialize when the editor tab is actually
     * shown (FileEditorProvider.createEditor). Mirrors VSCE chatProvider.ts tab mode.
     */
    fun openChatEditorTab() {
        val file = WaveChatVirtualFile("tab_${System.currentTimeMillis()}_${System.nanoTime().toString(36)}")
        if (SwingUtilities.isEventDispatchThread()) {
            FileEditorManager.getInstance(project).openFile(file, true)
        } else {
            Edt.invokeLater { FileEditorManager.getInstance(project).openFile(file, true) }
        }
    }

    /**
     * Routes an ExitPlanMode permission request to the panel owning [session] and renders the
     * plan content in its right-hand preview column. Called from PermissionFlow before the
     * confirmation dialog is shown, so the plan is visible next to the (now compact) dialog.
     */
    fun showPlanPreview(session: WaveSession, planContent: String) {
        val panel = panels.values.firstOrNull { it.belongsTo(session) } ?: return
        val html = com.wave.jetbrains.bridge.PlanPreviewBuilder.buildHtml(planContent)
        if (SwingUtilities.isEventDispatchThread()) {
            panel.showPlanPreview(html)
        } else {
            Edt.invokeLater { panel.showPlanPreview(html) }
        }
    }

    companion object {
        fun getInstance(project: Project): WavePanelHolder =
            project.getService(WavePanelHolder::class.java)
    }
}
