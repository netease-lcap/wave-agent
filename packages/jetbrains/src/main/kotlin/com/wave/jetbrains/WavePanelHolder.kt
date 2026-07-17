package com.wave.jetbrains

import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project

/**
 * Project-scoped registry holding the currently active [WavePanel], so IDE actions
 * (e.g. AddSelectionToWaveAction) can locate the panel and post messages into its webview
 * without reaching into the tool window's content manager.
 */
@Service(Service.Level.PROJECT)
class WavePanelHolder {
    @Volatile
    var panel: WavePanel? = null

    companion object {
        fun getInstance(project: Project): WavePanelHolder =
            project.getService(WavePanelHolder::class.java)
    }
}
