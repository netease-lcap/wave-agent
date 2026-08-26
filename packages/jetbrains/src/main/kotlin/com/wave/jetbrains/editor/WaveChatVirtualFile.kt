package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.impl.FileEditorManagerImpl
import com.intellij.openapi.fileTypes.FileType
import com.intellij.testFramework.LightVirtualFile

/**
 * In-memory virtual file backing one Wave chat session rendered as an editor-area tab
 * (the JetBrains equivalent of VSCE's `createWebviewPanel` chat tab).
 *
 * The file is never written to disk: [tabId] is the only identity. [equals]/[hashCode]
 * key on [tabId] so `FileEditorManager.openFile` reuses the same editor tab for repeated
 * opens of the same session instead of stacking duplicates.
 *
 * [FORBID_PREVIEW_TAB] opts the tab out of the platform's "preview tab" mechanism (a single
 * file opened without focus lands in a one-shot preview tab that gets replaced by the next
 * open), so the chat tab behaves like a regular pinned editor tab — same as the platform's
 * own `WebPreviewVirtualFile`.
 *
 * [getFileType] is overridden because the platform's `VirtualFile.getFileType` delegates to
 * `FileTypeRegistry`, which requires a running application (unavailable in plain unit tests)
 * — the type here is intrinsic to the file, not derived from name/registry. [rename] is
 * overridden to allow the tab-title refresh in [com.wave.jetbrains.WavePanelHolder.setTabTitle]
 * while keeping the file content read-only: `LightVirtualFileBase.rename` rejects any rename
 * on a non-writable file, but the chat tab is only ever renamed via our own code path.
 */
class WaveChatVirtualFile(val tabId: String) :
    LightVirtualFile("Wave - 新对话", WaveChatFileType, "") {

    init {
        isWritable = false
        putUserData(FileEditorManagerImpl.FORBID_PREVIEW_TAB, true)
    }

    override fun getFileType(): FileType = WaveChatFileType

    override fun rename(requestor: Any?, newName: String) {
        isWritable = true
        try {
            super.rename(requestor, newName)
        } finally {
            isWritable = false
        }
    }

    override fun equals(other: Any?): Boolean = other is WaveChatVirtualFile && other.tabId == tabId

    override fun hashCode(): Int = tabId.hashCode()
}
