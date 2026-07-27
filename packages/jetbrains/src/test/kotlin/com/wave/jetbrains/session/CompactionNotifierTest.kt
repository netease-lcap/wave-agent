package com.wave.jetbrains.session

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * Unit tests for the pure lifecycle logic in [CompactionNotifier], using fakes
 * for the create/dismiss seams so the IntelliJ Platform is not required.
 * Mirrors packages/vsce/tests/session/compactionNotifier.test.ts.
 */
class CompactionNotifierTest {

    private class Fake {
        val shown = mutableListOf<String>()
        val dismissed = mutableListOf<Int>()
        private var counter = 0
        val createAndShow: (String) -> Int = { message -> shown.add(message); counter++ }
        val dismiss: (Int) -> Unit = { dismissed.add(it) }
    }

    @Test
    fun `shows a single notification on start and dismisses it on complete without a second notification`() {
        val fake = Fake()
        val notifier = CompactionNotifier(fake.createAndShow, fake.dismiss)

        notifier.onCompactionStateChange(true)
        assertEquals(listOf("正在压缩对话…"), fake.shown)

        notifier.onCompactionStateChange(false)
        assertEquals(listOf(0), fake.dismissed)
        // No second notification shown on complete
        assertEquals(1, fake.shown.size)
    }

    @Test
    fun `complete without a prior start is a no-op`() {
        val fake = Fake()
        val notifier = CompactionNotifier(fake.createAndShow, fake.dismiss)

        notifier.onCompactionStateChange(false)
        assertTrue(fake.shown.isEmpty())
        assertTrue(fake.dismissed.isEmpty())
    }

    @Test
    fun `a new start after complete shows a fresh notification`() {
        val fake = Fake()
        val notifier = CompactionNotifier(fake.createAndShow, fake.dismiss)

        notifier.onCompactionStateChange(true)   // handle 0
        notifier.onCompactionStateChange(false)  // dismiss 0
        notifier.onCompactionStateChange(true)   // handle 1

        assertEquals(listOf("正在压缩对话…", "正在压缩对话…"), fake.shown)
        assertEquals(listOf(0), fake.dismissed) // handle 1 still shown
    }
}
