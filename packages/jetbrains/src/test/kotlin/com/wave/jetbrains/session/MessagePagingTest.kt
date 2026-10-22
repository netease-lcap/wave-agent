package com.wave.jetbrains.session

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
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
 * 首屏窗口与「翻更早」回包的算术（spec ui/message-rendering-system.md「首屏只进一页」）。
 *
 * 首屏只推一页是内存约束而不是 UI 口味：宿主的缓存必须全量（翻更早、回滚、会话
 * 切换都读它），推给渲染进程的永远只有一页。这里钉住的就是「推哪一页」与「前面
 * 还有没有」——两者任何一个错了，渲染进程要么又拿到整条会话，要么永远显示「没有
 * 更早的消息」。
 */
class MessagePagingTest {

    private fun thread(n: Int) = buildJsonArray {
        repeat(n) { add(buildJsonObject { put("id", "m$it") }) }
    }

    private fun JsonArray.ids(): List<String> =
        map { element -> element.jsonObject["id"]!!.jsonPrimitive.content }

    @Test
    fun `keeps the whole list when it fits in one page`() {
        val (page, hasMore) = MessagePaging.tailPage(thread(20))
        assertEquals(20, page.size)
        // 「这就是开头」：页面据此提示并停止再请求。
        assertFalse(hasMore)
    }

    @Test
    fun `pushes the tail of a long session and says more exists`() {
        val (page, hasMore) = MessagePaging.tailPage(thread(45))
        assertEquals(20, page.size)
        // 尾巴：读者打开会话先看到最近的对话，而不是几周前的第一条。
        assertEquals(
            (25 until 45).map { "m$it" },
            page.ids(),
        )
        assertTrue(hasMore)
    }

    @Test
    fun `treats a missing or malformed list as empty`() {
        assertEquals(0, MessagePaging.tailPage(null).first.size)
        assertEquals(0, MessagePaging.tailPage(JsonNull).first.size)
        assertFalse(MessagePaging.tailPage(null).second)
    }

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
    }
}
