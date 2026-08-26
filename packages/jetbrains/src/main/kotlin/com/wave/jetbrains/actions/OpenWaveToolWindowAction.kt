package com.wave.jetbrains.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.DumbAware
import com.wave.jetbrains.WavePanelHolder
import com.wave.jetbrains.editor.WaveChatVirtualFile

/**
 * Opens (and activates) the Wave chat. Since chats now render as editor-area tabs (not a tool
 * window), this focuses the active chat tab if one is open, otherwise opens a new one. Keeps the
 * registered id "com.wave.jetbrains.openWave" and its Tools menu slot.
 */
class OpenWaveToolWindowAction : AnAction(), DumbAware {
    private val LOG = logger<OpenWaveToolWindowAction>()

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val holder = WavePanelHolder.getInstance(project)
        val manager = FileEditorManager.getInstance(project)
        val active = holder.activePanel
        val activeFile = active?.chatFile
        if (activeFile != null) {
            manager.openFile(activeFile, true)
        } else {
            holder.openChatEditorTab()
        }
    }
}
