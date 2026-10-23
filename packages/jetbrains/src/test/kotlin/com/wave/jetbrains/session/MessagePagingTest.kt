package com.wave.jetbrains.session

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

/**
 * 「翻更早」回包的算术（spec ui/message-rendering-system.md「续页从转录读、两端不再
 * 常驻全量」）。
 *
 * 宿主不再自己从全量缓存里切窗口——那一页由 SDK 读转录给出，Kotlin 侧只剩「怎么读
 * 回包」。读错的后果很具体：`hasMore` 认成 false，页面就永远显示「没有更早的消息」。
 */
class MessagePagingTest {

    private fun thread(n: Int) = buildJsonArray {
        repeat(n) { add(buildJsonObject { put("id", "m$it") }) }
    }

    private fun JsonArray.ids(): List<String> =
        map { element -> element.jsonObject["id"]!!.jsonPrimitive.content }

    @Test
    fun `reads a windowed reply`() {
        val reply = buildJsonObject {
            put("messages", thread(3))
            put("hasMore", true)
        }
        val (page, hasMore) = MessagePaging.pageOf(reply)
        assertEquals(listOf("m0", "m1", "m2"), page.ids())
        assertTrue(hasMore)
    }

    @Test
    fun `treats an old CLI reply without hasMore as the end of history`() {
        // 老 CLI 不认识窗口参数：整份答回来且不带 hasMore。按「没有更早的了」处理，
        // 否则页面会拿同一个锚点无限重问。
        val (page, hasMore) = MessagePaging.pageOf(
            buildJsonObject { put("messages", thread(2)) },
        )
        assertEquals(2, page.size)
        assertFalse(hasMore)
        assertFalse(MessagePaging.pageOf(null).second)
        assertEquals(0, MessagePaging.pageOf(null).first.size)
    }
}
