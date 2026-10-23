package com.wave.jetbrains.session

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.jsonPrimitive

/**
 * 消息列表的分页口径，与 SDK 的 `constants/messageWindow.ts` 同源（对齐 opencode：
 * 首屏 20 / 历史 200）。Kotlin 侧没有共享包，数字只能镜像一份——改一处要改两处，
 * 为什么是这两个数见那个文件的注释。
 *
 * 抽成独立对象是为了能被单测直接钉住：`WaveSession` 要一个 `Project`，而这里的
 * 算术（怎么读回包、还有没有更早的）与 IDE 无关。
 */
object MessagePaging {
    /** 常驻窗口的条数：宿主缓存与首屏推送都只有这么多。 */
    const val FIRST_PAGE_SIZE = 20

    /** 一次「翻更早」取回的条数。 */
    const val HISTORY_PAGE_SIZE = 200

    /**
     * 解析 `getMessages` 的窗口回包（`{messages, hasMore}`）。
     *
     * 宿主缓存就是这一页——整条会话在转录里，宿主不再自己切窗口。老版本 CLI 不认
     * 识窗口参数，会把整份列表原样答回来且**不带** `hasMore`：按「没有更早的了」
     * 处理，否则页面会拿同一个锚点无限重问。
     */
    fun pageOf(result: JsonElement?): Pair<JsonArray, Boolean> {
        val res: JsonObject = (result as? JsonObject) ?: JsonObject(emptyMap())
        val page = res["messages"] as? JsonArray ?: JsonArray(emptyList())
        val hasMore = res["hasMore"]?.jsonPrimitive?.booleanOrNull == true
        return page to hasMore
    }
}
