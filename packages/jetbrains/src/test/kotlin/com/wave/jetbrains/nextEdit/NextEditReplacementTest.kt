package com.wave.jetbrains.nextEdit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * 与 VS Code 端 `tests/services/nextEditService.test.ts` 的 `toRender` 用例一一对应：
 * 两端渲染方式不同（那边借一行存活行画灰字，这边直接做区间替换），但可观察行为必须一致
 * （spec ui/next-edit-suggestion.md 边界：渲染方式两端各自实现）。
 */
class NextEditReplacementTest {
    private val file = listOf(
        "const a = 1;",
        "function f(id) {",
        "  return id;",
        "}",
        "export { f };",
    )

    private fun build(
        startLine: Int,
        endLine: Int,
        text: String,
        excerptStart: Int = 1,
    ) = buildNextEditReplacement(
        excerptStartLine = excerptStart,
        excerptLines = file,
        suggestionStartLine = startLine,
        suggestionEndLine = endLine,
        suggestionText = text,
    )

    @Test
    fun `narrows a whole-region answer down to the lines that changed`() {
        val replacement = build(
            1,
            5,
            listOf(
                "const a = 1;",
                "function f(userId) {",
                "  return userId;",
                "}",
                "export { f };",
            ).joinToString("\n"),
        )

        assertEquals(2, replacement?.startLine)
        assertEquals(4, replacement?.endLineExclusive)
        assertEquals("function f(userId) {\n  return userId;", replacement?.newText)
        assertEquals(listOf("function f(id) {", "  return id;"), replacement?.removedLines)
    }

    @Test
    fun `a pure deletion replaces the lines with nothing`() {
        val replacement = build(2, 3, "")

        // 浮层这边不用像 VS Code 那样借一行存活行：直接删掉这两行。
        assertEquals(2, replacement?.startLine)
        assertEquals(4, replacement?.endLineExclusive)
        assertEquals("", replacement?.newText)
        assertTrue(replacement?.isPureDeletion == true)
    }

    @Test
    fun `a pure insertion is a zero-width range`() {
        val replacement = build(
            1,
            5,
            listOf(
                "const a = 1;",
                "const b = 2;",
                "function f(id) {",
                "  return id;",
                "}",
                "export { f };",
            ).joinToString("\n"),
        )

        assertEquals(2, replacement?.startLine)
        assertEquals(2, replacement?.endLineExclusive)
        assertEquals("const b = 2;", replacement?.newText)
        assertEquals(emptyList(), replacement?.removedLines)
    }

    @Test
    fun `shows nothing when the answer is the region verbatim`() {
        // 模型原样回显，包括结尾换行——这不构成改动（spec 故事 3 场景 5 的对照面）。
        assertNull(build(1, 5, file.joinToString("\n") + "\n"))
    }

    @Test
    fun `rejects a suggestion past the end of the excerpt`() {
        assertNull(build(4, 99, "x"))
    }

    @Test
    fun `rejects a suggestion before the excerpt`() {
        // 片段从第 10 行开始，模型却指着第 3 行：行号不属于这段上下文。
        assertNull(
            buildNextEditReplacement(
                excerptStartLine = 10,
                excerptLines = listOf("a", "b"),
                suggestionStartLine = 3,
                suggestionEndLine = 3,
                suggestionText = "c",
            ),
        )
    }

    @Test
    fun `maps absolute line numbers through the excerpt offset`() {
        val replacement = buildNextEditReplacement(
            excerptStartLine = 10,
            excerptLines = listOf("a", "b", "c"),
            suggestionStartLine = 11,
            suggestionEndLine = 11,
            suggestionText = "B",
        )

        // 片段首行是第 10 行，所以片段内的第 2 行是文件的第 11 行。
        assertEquals(11, replacement?.startLine)
        assertEquals(12, replacement?.endLineExclusive)
        assertEquals("B", replacement?.newText)
    }
}
