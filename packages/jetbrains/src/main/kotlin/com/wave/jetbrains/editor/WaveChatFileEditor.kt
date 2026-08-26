package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorLocation
import com.intellij.openapi.fileEditor.FileEditorState
import com.intellij.openapi.util.UserDataHolderBase
import com.intellij.openapi.vfs.VirtualFile
import com.wave.jetbrains.WavePanel
import com.wave.jetbrains.WavePanelHolder
import org.jetbrains.annotations.Nls
import java.beans.PropertyChangeListener
import javax.swing.JComponent

/**
 * Adapts a [WavePanel] to the platform's [FileEditor] contract so the chat UI renders as an
 * editor-area tab. This is the JetBrains counterpart of VSCE's `createWebviewPanel` chat panel:
 *
 * - [getComponent] hands the panel's JSplitPane (chat left, plan preview right) to the tab.
 * - [getName] feeds the tab title; dynamic per-session titles come from [WavePanelHolder] via
 *   [com.wave.jetbrains.editor.WaveEditorTabTitleProvider].
 * - [selectNotify]/[deselectNotify] keep [WavePanelHolder.activePanel] in sync so IDE actions
 *   (e.g. AddSelectionToWaveAction) target the focused chat tab.
 * - [dispose] tears the session down when the user closes the tab (same lifecycle as the old
 *   tool-window Content disposer).
 */
class WaveChatFileEditor(private val panel: WavePanel) : UserDataHolderBase(), FileEditor {

    override fun getComponent(): JComponent = panel.component

    override fun getPreferredFocusedComponent(): JComponent = panel.component

    override fun getName(): @Nls(capitalization = Nls.Capitalization.Title) String =
        WavePanelHolder.getInstance(panel.project()).currentTitle(panel.tabId)

    override fun getFile(): VirtualFile = panel.chatFile

    override fun setState(state: FileEditorState) {}

    override fun isModified(): Boolean = false

    override fun isValid(): Boolean = true

    override fun selectNotify() {
        WavePanelHolder.getInstance(panel.project()).setActivePanel(panel)
    }

    override fun deselectNotify() {}

    override fun addPropertyChangeListener(listener: PropertyChangeListener) {}

    override fun removePropertyChangeListener(listener: PropertyChangeListener) {}

    override fun getCurrentLocation(): FileEditorLocation? = null

    override fun dispose() {
        panel.dispose()
    }
}
