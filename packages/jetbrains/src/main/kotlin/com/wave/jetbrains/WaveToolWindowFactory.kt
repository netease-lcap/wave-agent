package com.wave.jetbrains

import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.content.ContentManagerEvent
import com.intellij.ui.content.ContentManagerListener
import com.wave.jetbrains.actions.NewWaveTabAction

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
        toolWindow.setTitleActions(listOf(NewWaveTabAction()))
        toolWindow.contentManager.addContentManagerListener(object : ContentManagerListener {
            override fun selectionChanged(e: ContentManagerEvent) {
                holder.setActiveByContent(e.content)
            }
            override fun contentRemoved(e: ContentManagerEvent) {
                // Keep at least one chat tab: closing the last tab would leave the tool window
                // blank (only the "+" header button remains), which reads as a bug. Re-create a
                // fresh session so the window always has a chat — mirrors VSCE, where the sidebar
                // session is always present. Skip during IDE shutdown (project disposed).
                if (project.isDisposed) return
                if (toolWindow.contentManager.contentCount == 0) {
                    holder.addChatTab()
                }
            }
        })
        holder.addChatTab()
    }
}
