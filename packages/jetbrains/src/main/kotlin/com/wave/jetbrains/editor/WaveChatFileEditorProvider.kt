package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.wave.jetbrains.WavePanelHolder

/**
 * Serves [WaveChatVirtualFile]s as editor-area chat tabs (registered via the
 * `com.intellij.fileEditorProvider` extension point). Mirrors the platform's own
 * `WebPreviewEditorProvider`: `accept` matches our virtual file type, and the created
 * editor hosts an arbitrary JComponent (here the Wave chat webview).
 *
 * [HIDE_DEFAULT_EDITOR] keeps only our editor for the file — there is no text representation
 * of an in-memory chat session. The provider must be [DumbAware] for the policy to apply
 * (FileEditorProviderManagerImpl enforces it).
 */
class WaveChatFileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean = file is WaveChatVirtualFile

    override fun createEditor(project: Project, file: VirtualFile): FileEditor {
        val holder = WavePanelHolder.getInstance(project)
        val panel = holder.getOrCreatePanel(project, file as WaveChatVirtualFile)
        return WaveChatFileEditor(panel)
    }

    override fun getEditorTypeId(): String = "wave-chat-editor"

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}
