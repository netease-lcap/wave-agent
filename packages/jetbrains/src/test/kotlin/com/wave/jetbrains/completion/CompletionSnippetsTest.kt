package com.wave.jetbrains.completion

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class CompletionSnippetsTest {
    @Test
    fun `keeps only the first lines of a long declaration`() {
        val body = (1..30).joinToString("\n") { "line $it" }

        val snippet = truncateSnippet(body, maxLines = 3, maxChars = 1000)

        assertEquals("line 1\nline 2\nline 3", snippet)
    }

    @Test
    fun `stops at the character budget before the line budget`() {
        val body = "abcdefghij\nklmnopqrst"

        val snippet = truncateSnippet(body, maxLines = 10, maxChars = 12)

        assertEquals("abcdefghij\nk", snippet)
    }

    @Test
    fun `leaves a short declaration untouched`() {
        val body = "fun formatDate(d: Date): String"

        assertEquals(body, truncateSnippet(body))
    }

    @Test
    fun `reads candidates from an es module import`() {
        val text = """import { formatDate, formatMoney } from "./utils/format";"""

        val words = importCandidateOffsets(text).map { text.substring(it).takeWhile { c -> c.isLetterOrDigit() } }

        assertTrue(words.containsAll(listOf("formatDate", "formatMoney")), "got $words")
        assertTrue("import" !in words)
        assertTrue("from" !in words)
    }

    @Test
    fun `reads candidates from a java import`() {
        val text = "import com.example.FormatUtils;\nimport java.util.List;"

        val words = importCandidateOffsets(text).map { text.substring(it).takeWhile { c -> c.isLetterOrDigit() } }

        assertTrue(words.containsAll(listOf("FormatUtils", "List")), "got $words")
    }

    @Test
    fun `reads candidates from a python from-import`() {
        val text = "from utils.format import format_date, format_money"

        val words = importCandidateOffsets(text).map { text.substring(it).takeWhile { c -> c.isLetterOrDigit() || c == '_' } }

        assertTrue(words.containsAll(listOf("format_date", "format_money")), "got $words")
    }

    @Test
    fun `ignores lines that are not imports`() {
        val text = "const label = formatDate(today);\nprintln(label)"

        assertEquals(emptyList(), importCandidateOffsets(text))
    }

    @Test
    fun `ignores an import keyword mentioned mid-line`() {
        val text = """const msg = "import { notASymbol }";"""

        assertEquals(emptyList(), importCandidateOffsets(text))
    }

    @Test
    fun `caps the number of candidates`() {
        val text = (1..50).joinToString("\n") { "import com.example.Class$it;" }

        val offsets = importCandidateOffsets(text, maxCandidates = 5)

        assertEquals(5, offsets.size)
    }
}
