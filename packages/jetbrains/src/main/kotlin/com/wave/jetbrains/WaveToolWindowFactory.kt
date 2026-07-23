package com.wave.jetbrains

import com.intellij.openapi.Disposable
import com.intellij.openapi.diagnostic.logger
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory

class WaveToolWindowFactory : ToolWindowFactory {
    private val LOG = logger<WaveToolWindowFactory>()

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        // The displayed title is derived from the toolWindow id by default (no
        // plugin.xml `title` attribute exists on the extension point). Override at
        // runtime so the id stays "Wave" (used as a programmatic key) while the
        // header / stripe show the localized product name, matching VSCE.
        toolWindow.title = "Wave 代码智聊"
        toolWindow.stripeTitle = "Wave 代码智聊"
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
