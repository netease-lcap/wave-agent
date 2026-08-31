package com.wave.jetbrains.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.DumbAware
import com.wave.jetbrains.WavePanelHolder

/**
 * Opens (or focuses) the editor-area Wave settings tab (spec 场景 10). Mirrors VSCE's
 * `wave-code.openSettings` command: the tab is created lazily on first invocation and reused
 * afterwards; the settings tab is independent of any chat session.
 */
class OpenWaveSettingsAction : AnAction(), DumbAware {
    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        WavePanelHolder.getInstance(project).openSettings()
    }
}
