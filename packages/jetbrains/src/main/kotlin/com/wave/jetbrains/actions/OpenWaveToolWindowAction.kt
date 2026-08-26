package com.wave.jetbrains.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.wm.ToolWindowManager

/**
 * Opens (and activates) the Wave side-bar tool window. If the tool window is not created yet
 * (lazy creation), [ToolWindowManager.getToolWindow] triggers
 * [com.wave.jetbrains.WaveToolWindowFactory], which registers the tool window on the holder and
 * adds the first chat tab.
 */
class OpenWaveToolWindowAction : AnAction(), DumbAware {
    private val LOG = logger<OpenWaveToolWindowAction>()

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Wave")
        if (toolWindow == null) {
            LOG.warn("Wave tool window not available")
            return
        }
        toolWindow.show()
        toolWindow.activate(null)
    }
}
