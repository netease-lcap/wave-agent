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
        })
        holder.addChatTab()
    }
}
