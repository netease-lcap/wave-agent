package com.wave.jetbrains.editor

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
 * Like [WavePlanVirtualFile] the tab is never a platform "preview tab": it is opened with
 * `focusEditor = true` (see `WavePanelHolder.openSettings`), which the platform's preview-tab
 * decision (`EditorWindow.shouldReservePreview`) already treats as a regular tab — so no
 * `FORBID_PREVIEW_TAB` user data is needed (that key lives on the internal `FileEditorManagerImpl`
 * and is flagged by the plugin verifier as internal + deprecated API).
 *
 * [getFileType] is overridden because the platform's `VirtualFile.getFileType` delegates to
 * `FileTypeRegistry`, which requires a running application (unavailable in plain unit tests) —
 * the type here is intrinsic to the file, not derived from name/registry.
 */
class WaveSettingsVirtualFile :
    LightVirtualFile("CodeWave IDE - 设置", WaveSettingsFileType, "") {

    init {
        isWritable = false
    }

    override fun getFileType(): FileType = WaveSettingsFileType

    override fun equals(other: Any?): Boolean = other is WaveSettingsVirtualFile

    override fun hashCode(): Int = WaveSettingsVirtualFile::class.hashCode()
}
