package com.wave.jetbrains.session

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * 消息列表的分页口径，与 SDK 的 `constants/messageWindow.ts` 同源（对齐 opencode：
 * 首屏 20 / 历史 200）。Kotlin 侧没有共享包，数字只能镜像一份——改一处要改两处，
 * 为什么是这两个数见那个文件的注释。
 *
 * 抽成独立对象是为了能被单测直接钉住：`WaveSession` 要一个 `Project`，而这里的
 * 算术（取哪一页、还有没有更早的）与 IDE 无关。
 */
object MessagePaging {
    /** 首屏推给渲染进程的条数。 */
    const val FIRST_PAGE_SIZE = 20

    /** 一次「翻更早」取回的条数。 */
    const val HISTORY_PAGE_SIZE = 200

    /**
     * 首屏 / 窗口推送用的一页：整份缓存里最近 [limit] 条 + 是否还有更早的。
     *
     * 宿主那份缓存必须是全量（翻更早、回滚、会话切换都读它），推给渲染进程的永远
     * 只有一页——一个连续用了几周的会话，整份列表在渲染进程里就是堆上的几十万个
     * 对象加 base64 图片。
     */
    fun tailPage(all: JsonElement?, limit: Int = FIRST_PAGE_SIZE): Pair<JsonArray, Boolean> {
        val list = all as? JsonArray ?: JsonArray(emptyList())
        val size = list.size
        if (limit < 1 || size <= limit) return list to false
        return JsonArray(list.drop(size - limit)) to true
    }

    /**
     * 解析 `getMessages` 的窗口回包（`{messages, hasMore}`）。
     *
     * 老版本 CLI 不认识窗口参数，会把整份列表原样答回来且**不带** `hasMore`：按
     * 「没有更早的了」处理，否则页面会拿同一个锚点无限重问。
     */
    fun pageOf(result: JsonElement?): Pair<JsonArray, Boolean> {
        val res: JsonObject = (result as? JsonObject) ?: JsonObject(emptyMap())
        val page = res["messages"] as? JsonArray ?: JsonArray(emptyList())
        val hasMore = res["hasMore"]?.jsonPrimitive?.booleanOrNull == true
        return page to hasMore
    }
}
