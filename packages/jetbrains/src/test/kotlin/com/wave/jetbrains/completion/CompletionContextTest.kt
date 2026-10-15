package com.wave.jetbrains.completion

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CompletionContextTest {
    @Test
    fun `splits the document at the caret`() {
        val text = "const a = 1;\nconst b = 2;"

        val context = buildCompletionContext(text, text.indexOf("b = 2"))

        assertEquals("const a = 1;\nconst ", context.prefix)
        assertEquals("b = 2;", context.suffix)
    }

    @Test
    fun `windows the context to the configured number of lines`() {
        val text = (0 until 20).joinToString("\n") { "line $it" }
        val offset = text.indexOf("line 10")

        val context = buildCompletionContext(text, offset, prefixLines = 2, suffixLines = 1)

        assertEquals("line 8\nline 9\n", context.prefix)
        assertEquals("line 10\nline 11", context.suffix)
    }

    @Test
    fun `keeps the farthest lines out when the character budget is exceeded`() {
        val text = listOf("aaaa", "bbbb", "cccc", "dddd").joinToString("\n")
        val offset = text.indexOf("cccc") + 2

        val context = buildCompletionContext(
            text,
            offset,
            prefixLines = 10,
            suffixLines = 10,
            maxChars = 10,
        )

        assertTrue(context.prefix.length + context.suffix.length <= 10)
        assertTrue(context.prefix.contains("cc"))
        assertTrue(!context.prefix.contains("aaaa"))
    }

    @Test
    fun `clamps an offset past the end of the document`() {
        val text = "const a = 1;"

        val context = buildCompletionContext(text, 999)

        assertEquals(text, context.prefix)
        assertEquals("", context.suffix)
    }

    @Test
    fun `keeps short suggestions verbatim`() {
        assertEquals("return 42;", truncateSuggestion("return 42;"))
    }

    @Test
    fun `caps the suggestion at the configured line count`() {
        val eleven = (0 until 11).joinToString("\n") { "line $it" }

        val result = truncateSuggestion(eleven)

        assertEquals(10, result.split('\n').size)
    }

    @Test
    fun `caps the suggestion at the configured character count`() {
        val result = truncateSuggestion("x".repeat(5000))

        assertEquals(1000, result.length)
    }
}
