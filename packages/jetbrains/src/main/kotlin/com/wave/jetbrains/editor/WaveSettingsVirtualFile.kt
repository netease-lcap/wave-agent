package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.impl.FileEditorManagerImpl
import com.intellij.openapi.fileTypes.FileType
import com.intellij.testFramework.LightVirtualFile

/**
 * In-memory virtual file backing the single editor-area settings tab (the editor-area tab that
 * renders the shared settings webview, mirroring VSCE's `createWebviewPanel` settings panel and
 * the [WavePlanVirtualFile] plan-tab pattern).
 *
 * The file is never written to disk. Unlike the plan file there is no per-session key: the
 * settings tab is a single instance per project, so identity is class-based
 * ([equals]/[hashCode] match any other settings file) — `FileEditorManager.openFile` reuses the
 * one open tab instead of stacking duplicates.
 *
 * [FORBID_PREVIEW_TAB] opts the tab out of the platform's "preview tab" mechanism, so the
 * settings tab behaves like a regular editor tab.
 *
 * [getFileType] is overridden because the platform's `VirtualFile.getFileType` delegates to
 * `FileTypeRegistry`, which requires a running application (unavailable in plain unit tests) —
 * the type here is intrinsic to the file, not derived from name/registry.
 */
class WaveSettingsVirtualFile :
    LightVirtualFile("Wave - 设置", WaveSettingsFileType, "") {

    init {
        isWritable = false
        putUserData(FileEditorManagerImpl.FORBID_PREVIEW_TAB, true)
    }

    override fun getFileType(): FileType = WaveSettingsFileType

    override fun equals(other: Any?): Boolean = other is WaveSettingsVirtualFile

    override fun hashCode(): Int = WaveSettingsVirtualFile::class.hashCode()
}
