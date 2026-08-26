package com.wave.jetbrains

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentManagerEvent
import com.intellij.ui.content.ContentManagerListener

class WaveToolWindowFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        // The displayed title is derived from the toolWindow id by default (no
        // plugin.xml `title` attribute exists on the extension point). Override at
        // runtime so the id stays "Wave" (used as a programmatic key) while the
        // header / stripe show the localized product name, matching VSCE.
        toolWindow.title = "Wave 代码智聊"
        toolWindow.stripeTitle = "Wave 代码智聊"
        val holder = WavePanelHolder.getInstance(project)
        holder.toolWindow = toolWindow
        toolWindow.contentManager.addContentManagerListener(object : ContentManagerListener {
            override fun contentRemoved(e: ContentManagerEvent) {
                // Keep the single chat content: if the last content is closed (e.g. tool window
                // teardown), re-create a fresh session so the window always has a chat — mirrors
                // VSCE, where the sidebar session is always present. Skip during IDE shutdown.
                if (project.isDisposed) return
                if (toolWindow.contentManager.contentCount == 0) {
                    holder.ensureChat()
                }
            }
        })
        holder.ensureChat()
    }
}
