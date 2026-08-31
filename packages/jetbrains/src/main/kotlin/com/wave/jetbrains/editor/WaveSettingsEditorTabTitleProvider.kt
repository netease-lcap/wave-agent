package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.impl.EditorTabTitleProvider
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.NlsContexts
import com.intellij.openapi.vfs.VirtualFile

/**
 * Provides the editor-tab title for the Wave settings tab (a fixed "设置" label; the tab's
 * content — the settings webview — is loaded by [WaveSettingsFileEditor] itself).
 */
class WaveSettingsEditorTabTitleProvider : EditorTabTitleProvider {
    override fun getEditorTabTitle(project: Project, file: VirtualFile): @NlsContexts.TabTitle String? {
        return if (file is WaveSettingsVirtualFile) "设置" else null
    }
}
