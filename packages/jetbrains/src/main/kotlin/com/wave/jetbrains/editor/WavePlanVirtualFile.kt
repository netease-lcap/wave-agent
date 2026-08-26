package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.impl.FileEditorManagerImpl
import com.intellij.openapi.fileTypes.FileType
import com.intellij.testFramework.LightVirtualFile

/**
 * In-memory virtual file backing one Wave plan-preview tab (the editor-area tab that renders the
 * ExitPlanMode plan content, mirroring VSCE's `createWebviewPanel` plan preview panel).
 *
 * The file is never written to disk: [planId] (the owning chat tab id) is the only identity.
 * [equals]/[hashCode] key on [planId] so `FileEditorManager.openFile` reuses the same editor tab
 * for repeated opens of the same session instead of stacking duplicates.
 *
 * [FORBID_PREVIEW_TAB] opts the tab out of the platform's "preview tab" mechanism, so the plan
 * tab behaves like a regular editor tab.
 *
 * [getFileType] is overridden because the platform's `VirtualFile.getFileType` delegates to
 * `FileTypeRegistry`, which requires a running application (unavailable in plain unit tests) —
 * the type here is intrinsic to the file, not derived from name/registry.
 */
class WavePlanVirtualFile(val planId: String) :
    LightVirtualFile("Wave - 计划", WavePlanFileType, "") {

    init {
        isWritable = false
        putUserData(FileEditorManagerImpl.FORBID_PREVIEW_TAB, true)
    }

    override fun getFileType(): FileType = WavePlanFileType

    override fun equals(other: Any?): Boolean = other is WavePlanVirtualFile && other.planId == planId

    override fun hashCode(): Int = planId.hashCode()
}
