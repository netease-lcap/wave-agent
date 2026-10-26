package com.wave.jetbrains.nextEdit

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * 删除线的覆盖范围。
 *
 * 建议的区间是整行级的、止于下一行行首，所以结尾那个换行符不属于「要删的行」：划上去会
 * 让删除线延伸进下一行开头（spec 故事 1 场景 8 说的是「那几行」，不是「那几行加下一行的
 * 开头」）。VS Code 侧用 `lineRange` 不含换行，这里必须同口径。
 */
class NextEditStrikeRangeTest {
    // "line one\n" = 0..8，"line two\n" = 9..17，"line three\n" = 18..28
    private val text = "line one\nline two\nline three\n"

    @Test
    fun `drops the trailing newline when the range ends at the next line start`() {
        // 0-based 9..18 是 "line two\n"：结束偏移 18 是下一行行首，17 才是这一行最后一个字符。
        assertEquals(17, strikeEnd(text, 9, 18))
    }

    @Test
    fun `keeps the end when the range runs to end of file without a newline`() {
        val noTrailing = "line one\nline two"
        assertEquals(17, strikeEnd(noTrailing, 9, 17))
    }

    @Test
    fun `a pure insertion has nothing to strike`() {
        assertNull(strikeEnd(text, 9, 9))
    }

    @Test
    fun `a range holding nothing but a newline has nothing to strike`() {
        assertNull(strikeEnd("\n", 0, 1))
    }

    @Test
    fun `a range ending inside a line keeps its end as is`() {
        // 9..13 是 "line" 四个字符，结束偏移落在行内、不是行首。
        assertEquals(13, strikeEnd(text, 9, 13))
    }
}
