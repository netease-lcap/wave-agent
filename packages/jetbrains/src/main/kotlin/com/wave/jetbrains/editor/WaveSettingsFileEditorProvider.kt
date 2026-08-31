package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/**
 * Serves [WaveSettingsVirtualFile]s as the single editor-area settings tab (registered via the
 * `com.intellij.fileEditorProvider` extension point). Mirrors [WavePlanFileEditorProvider]: `accept`
 * matches our virtual file type, and the created editor hosts the settings-webview JCEF browser.
 *
 * [HIDE_DEFAULT_EDITOR] keeps only our editor for the file — there is no text representation
 * of an in-memory settings page. The provider must be [DumbAware] for the policy to apply
 * (FileEditorProviderManagerImpl enforces it).
 */
class WaveSettingsFileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean = file is WaveSettingsVirtualFile

    override fun createEditor(project: Project, file: VirtualFile): FileEditor =
        WaveSettingsFileEditor(project, file as WaveSettingsVirtualFile)

    override fun getEditorTypeId(): String = "wave-settings-editor"

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}
