package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.impl.FileEditorManagerImpl
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Tests for [WaveChatVirtualFile], the in-memory file backing an editor-area chat tab.
 * Key behaviors: identity is [WaveChatVirtualFile.tabId] (so FileEditorManager reuses the tab),
 * the file opts out of the platform's preview-tab mechanism, and renaming updates the tab label.
 */
class WaveChatVirtualFileTest {

    @Test
    fun `equals and hashCode key on tabId`() {
        val a = WaveChatVirtualFile("tab_1")
        val same = WaveChatVirtualFile("tab_1")
        val other = WaveChatVirtualFile("tab_2")

        assertEquals(a, same)
        assertEquals(a.hashCode(), same.hashCode())
        assertNotEquals(a, other)
    }

    @Test
    fun `file opts out of the preview tab mechanism`() {
        val file = WaveChatVirtualFile("tab_1")
        assertEquals(true, file.getUserData(FileEditorManagerImpl.FORBID_PREVIEW_TAB))
    }

    @Test
    fun `chat files are read-only`() {
        val file = WaveChatVirtualFile("tab_1")
        assertFalse(file.isWritable)
    }

    @Test
    fun `rename changes the name used for the tab label`() {
        val file = WaveChatVirtualFile("tab_1")
        file.rename(null, "重构登录模块")
        assertEquals("重构登录模块", file.name)
    }

    @Test
    fun `file type is the wave chat type and is binary`() {
        val file = WaveChatVirtualFile("tab_1")
        assertTrue(file.fileType is WaveChatFileType)
        assertTrue(file.fileType.isBinary)
        assertNull(file.extension)
    }
}
