package com.wave.jetbrains.actions

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.wave.jetbrains.WavePanelHolder

/**
 * Adds a new Wave chat tab to the tool window. Mirrors VSCE's "wave-code.openChatTab" command
 * (chatProvider.ts:453 createOrShowChatPanel('tab')). Registered as a tool-window title action
 * so it appears as a "+" button in the Wave tool window header.
 */
class NewWaveTabAction : AnAction(AllIcons.General.Add), DumbAware {
    override fun getActionUpdateThread() = ActionUpdateThread.EDT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        WavePanelHolder.getInstance(project).addChatTab()
    }

    override fun update(e: AnActionEvent) {
        e.presentation.text = "新建会话"
        e.presentation.isEnabled = WavePanelHolder.getInstance(e.project ?: return).toolWindow != null
    }
}
