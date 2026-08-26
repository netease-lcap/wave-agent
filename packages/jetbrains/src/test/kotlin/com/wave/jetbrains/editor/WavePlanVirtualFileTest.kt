package com.wave.jetbrains.editor

import com.intellij.openapi.fileEditor.impl.FileEditorManagerImpl
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNotEquals
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Tests for [WavePlanVirtualFile], the in-memory file backing the ExitPlanMode plan-preview tab.
 * Key behaviors: identity is [WavePlanVirtualFile.planId] (so FileEditorManager reuses the tab),
 * and the file opts out of the platform's preview-tab mechanism.
 */
class WavePlanVirtualFileTest {

    @Test
    fun `equals and hashCode key on planId`() {
        val a = WavePlanVirtualFile("tab_1")
        val same = WavePlanVirtualFile("tab_1")
        val other = WavePlanVirtualFile("tab_2")

        assertEquals(a, same)
        assertEquals(a.hashCode(), same.hashCode())
        assertNotEquals(a, other)
    }

    @Test
    fun `file opts out of the preview tab mechanism`() {
        val file = WavePlanVirtualFile("tab_1")
        assertEquals(true, file.getUserData(FileEditorManagerImpl.FORBID_PREVIEW_TAB))
    }

    @Test
    fun `plan files are read-only`() {
        val file = WavePlanVirtualFile("tab_1")
        assertFalse(file.isWritable)
    }

    @Test
    fun `file type is the wave plan type and is binary`() {
        val file = WavePlanVirtualFile("tab_1")
        assertTrue(file.fileType is WavePlanFileType)
        assertTrue(file.fileType.isBinary)
        assertNull(file.extension)
    }
}
