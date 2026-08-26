package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorLocation
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.ui.jcef.JBCefBrowser
import com.wave.jetbrains.WavePanelHolder
import org.jetbrains.annotations.Nls
import java.beans.PropertyChangeListener
import javax.swing.JComponent

/**
 * Renders the ExitPlanMode plan content as an editor-area tab — the JetBrains counterpart of
 * VSCE's `createWebviewPanel` plan preview panel. The tab hosts a [JBCefBrowser] that displays
 * the markdown-HTML produced by [com.wave.jetbrains.bridge.PlanPreviewBuilder].
 *
 * - [showPlan] (re)loads plan HTML; repeated ExitPlanMode calls for the same session reuse the
 *   tab via the holder's [WavePanelHolder.registerPlanEditor] registry and just reload content.
 * - [dispose] cleans up the browser when the user closes the tab.
 */
class WavePlanFileEditor(
    private val project: com.intellij.openapi.project.Project,
    private val file: WavePlanVirtualFile,
) : UserDataHolderBase(), FileEditor {

    private val browser = JBCefBrowser()
    private var disposed = false

    init {
        WavePanelHolder.getInstance(project).registerPlanEditor(file.planId, this)
    }

    /** Renders the given self-contained markdown-HTML document in this plan tab. */
    fun showPlan(markdownHtml: String) {
        if (!disposed) {
            browser.loadHTML(markdownHtml)
        }
    }

    override fun getComponent(): JComponent = browser.component

    override fun getPreferredFocusedComponent(): JComponent = browser.component

    override fun getName(): @Nls(capitalization = Nls.Capitalization.Title) String = "计划"

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
        WavePanelHolder.getInstance(project).unregisterPlanEditor(file.planId, this)
        browser.dispose()
    }
}
