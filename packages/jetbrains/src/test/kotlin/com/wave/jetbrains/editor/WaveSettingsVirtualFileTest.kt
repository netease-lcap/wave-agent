package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.impl.FileEditorManagerImpl
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Tests for [WaveSettingsVirtualFile], the in-memory file backing the editor-area settings tab.
 * Key behaviors: identity is class-based (any settings file equals any other, so
 * FileEditorManager reuses the single open tab), and the file opts out of the platform's
 * preview-tab mechanism.
 */
class WaveSettingsVirtualFileTest {

    @Test
    fun `equals and hashCode are class-based`() {
        val a = WaveSettingsVirtualFile()
        val b = WaveSettingsVirtualFile()

        assertEquals(a, b)
        assertEquals(a.hashCode(), b.hashCode())
    }

    @Test
    fun `file opts out of the preview tab mechanism`() {
        val file = WaveSettingsVirtualFile()
        assertEquals(true, file.getUserData(FileEditorManagerImpl.FORBID_PREVIEW_TAB))
    }

    @Test
    fun `settings files are read-only`() {
        val file = WaveSettingsVirtualFile()
        assertFalse(file.isWritable)
    }

    @Test
    fun `file type is the wave settings type and is binary`() {
        val file = WaveSettingsVirtualFile()
        assertTrue(file.fileType is WaveSettingsFileType)
        assertTrue(file.fileType.isBinary)
    }
}
