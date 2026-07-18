package com.wave.jetbrains.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.wm.ToolWindowManager

/**
 * Opens (and activates) the Wave tool window. Registered as "com.wave.jetbrains.openWave"
 * in plugin.xml, surfaced under the Tools menu.
 */
class OpenWaveToolWindowAction : AnAction() {
    private val LOG = logger<OpenWaveToolWindowAction>()

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val toolWindow = ToolWindowManager.getInstance(project).getToolWindow("Wave")
        if (toolWindow == null) {
            LOG.warn("Wave tool window not found")
            return
        }
        toolWindow.show()
        toolWindow.activate(null)
    }
}
