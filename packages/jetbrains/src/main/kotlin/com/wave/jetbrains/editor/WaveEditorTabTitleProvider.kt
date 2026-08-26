package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.impl.EditorTabTitleProvider
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.NlsContexts
import com.intellij.openapi.vfs.VirtualFile
import com.wave.jetbrains.WavePanelHolder

/**
 * Provides dynamic editor-tab titles for Wave chat tabs, so the tab label tracks the session
 * title (derived from the first user message, pushed via `WavePanelHolder.setTabTitle`).
 *
 * The editor tab strip queries this provider on every repaint; `setTabTitle` additionally
 * renames the [WaveChatVirtualFile] to force an immediate repaint of the tab label.
 */
class WaveEditorTabTitleProvider : EditorTabTitleProvider {
    override fun getEditorTabTitle(project: Project, file: VirtualFile): @NlsContexts.TabTitle String? {
        val chat = file as? WaveChatVirtualFile ?: return null
        return WavePanelHolder.getInstance(project).currentTitle(chat.tabId)
    }
}
