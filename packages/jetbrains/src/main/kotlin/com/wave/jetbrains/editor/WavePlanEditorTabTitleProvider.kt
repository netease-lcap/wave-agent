package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.impl.EditorTabTitleProvider
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.NlsContexts
import com.intellij.openapi.vfs.VirtualFile

/**
 * Provides the editor-tab title for Wave plan-preview tabs (a fixed "计划" label; the tab's
 * content — the ExitPlanMode plan — is pushed via [com.wave.jetbrains.WavePanelHolder]).
 */
class WavePlanEditorTabTitleProvider : EditorTabTitleProvider {
    override fun getEditorTabTitle(project: Project, file: VirtualFile): @NlsContexts.TabTitle String? {
        return if (file is WavePlanVirtualFile) "计划" else null
    }
}
