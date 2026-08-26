package com.wave.jetbrains.actions

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.wave.jetbrains.WavePanelHolder

/**
 * Opens a new Wave chat session as an editor-area tab. Mirrors VSCE's "wave-code.openChatTab"
 * command (chatProvider.ts:453 createOrShowChatPanel('tab')). The tab materializes lazily when
 * the editor tab is shown; the panel/session are created by WaveChatFileEditorProvider.
 */
class NewWaveTabAction : AnAction(AllIcons.General.Add), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        WavePanelHolder.getInstance(project).openChatEditorTab()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.text = "新建对话"
        e.presentation.isEnabled = e.project != null
    }
}
