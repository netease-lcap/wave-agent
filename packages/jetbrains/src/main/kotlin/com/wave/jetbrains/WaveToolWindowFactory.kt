package com.wave.jetbrains

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory

class WaveToolWindowFactory : ToolWindowFactory {
    private val LOG = logger<WaveToolWindowFactory>()

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val panel = WavePanel(project)
        val content = com.intellij.ui.content.ContentFactory.getInstance()
            .createContent(panel.component, "", false)
        content.setDisposer(Disposable {
            try { panel.dispose() } catch (e: Exception) {
                LOG.warn("WavePanel dispose failed: ${e.message}")
            }
        })
        toolWindow.contentManager.addContent(content)
    }
}
