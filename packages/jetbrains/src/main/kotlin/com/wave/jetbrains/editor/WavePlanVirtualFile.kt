package com.wave.jetbrains.editor

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
 * The tab is never a platform "preview tab": [com.wave.jetbrains.WavePanelHolder] opens it with
 * `focusEditor = true`, and the platform only reserves a preview tab for open requests that do not
 * ask for focus (see `EditorWindow.shouldReservePreview`). The internal
 * `FileEditorManagerImpl.FORBID_PREVIEW_TAB` opt-out is therefore unnecessary — and unusable, as the
 * JetBrains plugin verifier flags it as internal + deprecated API.
 *
 * [getFileType] is overridden because the platform's `VirtualFile.getFileType` delegates to
 * `FileTypeRegistry`, which requires a running application (unavailable in plain unit tests) —
 * the type here is intrinsic to the file, not derived from name/registry.
 */
class WavePlanVirtualFile(val planId: String) :
    LightVirtualFile("CodeWave IDE - 计划", WavePlanFileType, "") {

    init {
        isWritable = false
    }

    override fun getFileType(): FileType = WavePlanFileType

    override fun equals(other: Any?): Boolean = other is WavePlanVirtualFile && other.planId == planId

    override fun hashCode(): Int = planId.hashCode()
}
