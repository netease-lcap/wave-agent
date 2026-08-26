package com.wave.jetbrains

import com.intellij.openapi.components.Service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Key
import com.intellij.openapi.wm.ToolWindow
import com.intellij.ui.content.Content
import com.intellij.ui.content.ContentFactory
import com.wave.jetbrains.bridge.PlanPreviewBuilder
import com.wave.jetbrains.editor.WavePlanFileEditor
import com.wave.jetbrains.editor.WavePlanVirtualFile
import com.wave.jetbrains.session.WaveSession
import com.wave.jetbrains.util.Edt
import java.util.concurrent.ConcurrentHashMap
import javax.swing.SwingUtilities

/**
 * Project-scoped registry of all open Wave chat tabs ([WavePanel]s) in the side-bar tool window,
 * tracking the active one so IDE actions (e.g. AddSelectionToWaveAction) can locate the focused
 * panel without reaching into the tool window's content manager. Mirrors VSCE's
 * `tabSessions`/`tabPanels` parallel Maps in chatProvider.ts: each tab is an independent
 * [WaveSession] sharing one stdio backend, disposed on tab close via [Content.setDisposer].
 *
 * ExitPlanMode plans render in a separate editor-area tab (per spec, aligned with VSCE's
 * `createWebviewPanel` plan preview): each chat tab gets one plan tab, reused across repeated
 * ExitPlanMode calls of the same session, and closed when the chat tab is disposed.
 */
@Service(Service.Level.PROJECT)
class WavePanelHolder(private val project: Project) {
    @Volatile
    var activePanel: WavePanel? = null

    @Volatile
    var toolWindow: ToolWindow? = null

    private val panels = ConcurrentHashMap<String, WavePanel>()
    private val contents = ConcurrentHashMap<String, Content>()
    private val planFiles = ConcurrentHashMap<String, WavePlanVirtualFile>()
    private val planEditors = ConcurrentHashMap<String, WavePlanFileEditor>()

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
        contents.remove(tabId)
        closePlanTab(tabId)
    }

    fun allPanels(): Collection<WavePanel> = panels.values.toList()

    /**
     * Updates the tool-window tab display name for [tabId]. Mirrors VSCE deriving panel.title from
     * the first user message (webview getSessionTitle); here the JB backend pushes the derived title
     * onto the Content so the tab label tracks the chat header. Must run on the EDT.
     */
    fun setTabTitle(tabId: String, title: String) {
        val content = contents[tabId] ?: return
        val safe = if (title.isBlank()) "新对话" else title
        if (SwingUtilities.isEventDispatchThread()) {
            content.displayName = safe
        } else {
            Edt.invokeLater { content.displayName = safe }
        }
    }

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
            val content = ContentFactory.getInstance().createContent(panel.component, "新对话", false)
            content.putUserData(TAB_KEY, id)
            content.setDisposer(panel)
            contents[id] = content
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

    /**
     * Routes an ExitPlanMode permission request to the plan tab of the panel owning [session] and
     * renders the plan content there. Called from PermissionFlow before the confirmation dialog
     * is shown, so the plan is visible in the editor area next to the (now compact) dialog —
     * the JetBrains equivalent of VSCE's `createWebviewPanel` plan preview panel.
     */
    fun showPlanPreview(session: WaveSession, planContent: String) {
        val panel = panels.values.firstOrNull { it.belongsTo(session) } ?: return
        openPlanTab(panel.tabId, PlanPreviewBuilder.buildHtml(planContent))
    }

    /** Registers a plan editor once its tab is created (called from WavePlanFileEditor.init). */
    fun registerPlanEditor(planId: String, editor: WavePlanFileEditor) {
        planEditors[planId] = editor
    }

    fun unregisterPlanEditor(planId: String, editor: WavePlanFileEditor) {
        planEditors.remove(planId, editor)
    }

    /**
     * Opens (or focuses) the plan tab for [tabId], reloading it with [markdownHtml]. The tab is
     * created lazily on first ExitPlanMode and reused afterwards (spec: repeated ExitPlanMode
     * calls of one session update the existing tab instead of stacking new ones).
     */
    private fun openPlanTab(tabId: String, markdownHtml: String) {
        val file = planFiles.getOrPut(tabId) { WavePlanVirtualFile(tabId) }
        val open: () -> Unit = {
            FileEditorManager.getInstance(project).openFile(file, true)
            planEditors[tabId]?.showPlan(markdownHtml)
            Unit
        }
        if (SwingUtilities.isEventDispatchThread()) open() else Edt.invokeLater(open)
    }

    /** Closes the plan tab of [tabId] when its chat tab is disposed (no orphan plan tabs). */
    private fun closePlanTab(tabId: String) {
        val file = planFiles.remove(tabId) ?: return
        planEditors.remove(tabId)
        if (project.isDisposed) return
        val close = {
            try {
                FileEditorManager.getInstance(project).closeFile(file)
            } catch (_: Exception) {
                // File may already be closed/disposed; ignore.
            }
        }
        if (SwingUtilities.isEventDispatchThread()) close() else Edt.invokeLater(close)
    }

    companion object {
        val TAB_KEY = Key<String>("waveTabId")

        fun getInstance(project: Project): WavePanelHolder =
            project.getService(WavePanelHolder::class.java)
    }
}
