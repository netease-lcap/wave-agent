package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.fileEditor.FileEditorPolicy
import com.intellij.openapi.fileEditor.FileEditorProvider
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile

/**
 * Serves [WavePlanVirtualFile]s as editor-area plan tabs (registered via the
 * `com.intellij.fileEditorProvider` extension point). Mirrors the platform's own
 * `WebPreviewEditorProvider`: `accept` matches our virtual file type, and the created
 * editor hosts an arbitrary JComponent (here the plan-preview JCEF browser).
 *
 * [HIDE_DEFAULT_EDITOR] keeps only our editor for the file — there is no text representation
 * of an in-memory plan preview. The provider must be [DumbAware] for the policy to apply
 * (FileEditorProviderManagerImpl enforces it).
 */
class WavePlanFileEditorProvider : FileEditorProvider, DumbAware {
    override fun accept(project: Project, file: VirtualFile): Boolean = file is WavePlanVirtualFile

    override fun createEditor(project: Project, file: VirtualFile): FileEditor =
        WavePlanFileEditor(project, file as WavePlanVirtualFile)

    override fun getEditorTypeId(): String = "wave-plan-editor"

    override fun getPolicy(): FileEditorPolicy = FileEditorPolicy.HIDE_DEFAULT_EDITOR
}
