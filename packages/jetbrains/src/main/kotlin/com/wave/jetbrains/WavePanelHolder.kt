package com.wave.jetbrains

import com.intellij.openapi.components.Service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.ui.content.ContentFactory
import com.wave.jetbrains.bridge.PlanPreviewBuilder
import com.wave.jetbrains.editor.WavePlanFileEditor
import com.wave.jetbrains.editor.WavePlanVirtualFile
import com.wave.jetbrains.editor.WaveSettingsFileEditor
import com.wave.jetbrains.editor.WaveSettingsVirtualFile
import com.wave.jetbrains.session.WaveSession
import com.wave.jetbrains.util.Edt
import java.util.concurrent.ConcurrentHashMap
import javax.swing.SwingUtilities

/**
 * Project-scoped registry holding the single Wave chat panel rendered inside the side-bar tool
 * window, so IDE actions (e.g. AddSelectionToWaveAction) can locate the panel and post messages
 * into its webview without reaching into the tool window's content manager.
 *
 * The plugin supports one chat at a time (single [WavePanel], backed by one [WaveSession] on the
 * shared stdio backend). ExitPlanMode plans render in a separate editor-area tab (per spec,
 * aligned with VSCE's `createWebviewPanel` plan preview): the chat's plan tab is reused across
 * repeated ExitPlanMode calls and closed when the chat panel is disposed. The settings webview
 * likewise renders in a single editor-area tab, but — unlike the plan tab — it is independent of
 * the chat session lifecycle ([openSettings] works with no active chat and [closeSettings] only
 * runs on explicit close).
 */
@Service(Service.Level.PROJECT)
class WavePanelHolder(private val project: Project) {
    @Volatile
    var panel: WavePanel? = null

    @Volatile
    var toolWindow: ToolWindow? = null

    private val planFiles = ConcurrentHashMap<String, WavePlanVirtualFile>()
    private val planEditors = ConcurrentHashMap<String, WavePlanFileEditor>()

    @Volatile
    private var settingsFile: WaveSettingsVirtualFile? = null

    @Volatile
    var settingsEditor: WaveSettingsFileEditor? = null
        private set

    fun register(panel: WavePanel) {
        this.panel = panel
    }

    fun unregister(panel: WavePanel) {
        if (this.panel === panel) {
            this.panel = null
        }
        closePlanTab(panel.tabId)
    }

    /**
     * Ensures the tool window has a chat: creates the single [WavePanel] content if none exists
     * (or it was disposed). Swing content (Content + JBCefBrowser) must be created on the EDT; if
     * the caller is already on the EDT the work runs inline, otherwise it is scheduled via
     * [Edt.invokeLater]. Returns the panel, or null if the tool window is gone or the work was
     * deferred to the EDT.
     */
    fun ensureChat(): WavePanel? {
        panel?.let { return it }
        val tw = toolWindow ?: return null

        fun build(): WavePanel {
            val p = WavePanel(project)
            // Empty display name on purpose: the IDE appends the single content's displayName to
            // the tool-window header title (legacy UI), and we keep the header to just the fixed
            // product title — the webview header shows the session title instead.
            val content = ContentFactory.getInstance().createContent(p.component, "", false)
            content.setDisposer(p)
            tw.contentManager.addContent(content)
            tw.contentManager.setSelectedContent(content)
            return p
        }

        return if (SwingUtilities.isEventDispatchThread()) {
            build().also { register(it) }
        } else {
            Edt.invokeLater { build().also { register(it) } }
            null
        }
    }

    /**
     * Routes an ExitPlanMode permission request to the plan tab of the single chat panel and
     * renders the plan content there. Called from PermissionFlow before the confirmation dialog
     * is shown, so the plan is visible in the editor area next to the (now compact) dialog —
     * the JetBrains equivalent of VSCE's `createWebviewPanel` plan preview panel.
     */
    fun showPlanPreview(session: WaveSession, planContent: String) {
        val p = panel ?: return
        if (!p.belongsTo(session)) return
        openPlanTab(p.tabId, PlanPreviewBuilder.buildHtml(planContent))
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

    /** Closes the plan tab of [tabId] when its chat panel is disposed (no orphan plan tabs). */
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

    // ── Settings tab (editor-area, session-independent) ────────────────

    /**
     * The chat panel's session (null while no chat exists). The settings tab reuses it for its
     * RPCs so getAgentsContent/setAgentsContent can reach the live agent; without one the
     * settings tab still serves configuration RPCs (which need no agent).
     */
    fun chatSession(): WaveSession? = panel?.session

    /** Registers the settings editor once its tab is created (WaveSettingsFileEditor.init). */
    fun registerSettingsEditor(editor: WaveSettingsFileEditor) {
        settingsEditor = editor
    }

    fun unregisterSettingsEditor(editor: WaveSettingsFileEditor) {
        if (settingsEditor === editor) settingsEditor = null
    }

    /**
     * Opens (or focuses) the editor-area settings tab (chat webview "openSettings" message +
     * OpenWaveSettingsAction; spec 场景 10). The tab is created lazily on first open and reused
     * afterwards (mirrors VSCE getOrCreateSettingsPanel). Unlike the plan tab it is independent
     * of the chat session lifecycle, so it opens even with no active chat and is not closed when
     * the chat panel is disposed. Pushes the project workdir via `settingsState` so the 个性化
     * view's project-scope AGENTS.md editor knows which project it targets (mirrors VSCE
     * chatProvider.openSettings). nav（"subagents" | "skills"）随 settingsState 下发，
     * /agents、/skills 斜杠命令据此选中设置页对应选项卡。
     */
    fun openSettings(nav: String? = null) {
        val open: () -> Unit = {
            val file = settingsFile ?: WaveSettingsVirtualFile().also { settingsFile = it }
            FileEditorManager.getInstance(project).openFile(file, true)
            settingsEditor?.pushWorkdir(settingsWorkdir(), nav)
        }
        if (SwingUtilities.isEventDispatchThread()) open() else Edt.invokeLater(open)
    }

    /** Closes the settings tab (webview "closeSettings" message). */
    fun closeSettings() {
        if (project.isDisposed) return
        val close = {
            val file = settingsFile
            settingsFile = null
            settingsEditor = null
            if (file != null) {
                try {
                    FileEditorManager.getInstance(project).closeFile(file)
                } catch (_: Exception) {
                    // File may already be closed/disposed; ignore.
                }
            }
        }
        if (SwingUtilities.isEventDispatchThread()) close() else Edt.invokeLater(close)
    }

    /** Workdir the settings 个性化 view targets: the chat session's root, else the project. */
    private fun settingsWorkdir(): String {
        val agent = panel?.session?.agent
        return agent?.sessionCwd ?: agent?.workingDirectory ?: project.basePath ?: System.getProperty("user.dir")
    }

    companion object {
        fun getInstance(project: Project): WavePanelHolder =
            project.getService(WavePanelHolder::class.java)
    }
}
