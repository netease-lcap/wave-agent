package com.wave.jetbrains.session

import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject

/**
 * 用户偏好键的显示名（写盘失败提示用）。
 *
 * 设置页的即时写盘一次只写一个键（spec core/agent-config.md「设置页控件的保存
 * 时机」），失败时宿主必须说清**是哪一项**没写进去——用户刚点的是哪一个，事后
 * 未必记得。文案模板：「设置未写入「<键名>」：<原因>」。
 *
 * 本文件是 SDK 侧 `packages/agent-sdk/src/constants/userPreferences.ts`
 * （`USER_PREFERENCE_LABELS` / `describeUserPreferencePatch`）的等价 Kotlin 副本：
 * 桌面端与 VS Code 从 `wave-agent-sdk/host` 取同一份表，JetBrains 用 Kotlin 写，
 * **两边改动必须同步**（键名与行标题逐字一致，标题与设置页 UI 一致）。
 */
private val USER_PREFERENCE_LABELS = mapOf(
    "language" to "AI 回复语言",
    "contextLength" to "上下文长度",
    "autoMemoryEnabled" to "开启自动记忆",
    "autoMemoryFrequency" to "触发记忆提取会话轮次",
    "completionModel" to "补全模型",
    "completionEnabled" to "代码补全",
    "nextEditEnabled" to "下一步编辑建议",
    "enableKnowledgeBase" to "企业知识库",
)

/**
 * 把一次写盘载荷的键翻译成给人看的名字，供失败提示使用。
 *
 * 载荷只应含一个键；万一收到多个，按顺序用「、」连起来，绝不回退成键名原文
 * （`contextLength` 对用户没有意义）。
 */
internal fun describeUserPreferencePatch(data: JsonObject): String {
    val labels = data.keys
        .filter { data[it] !is JsonNull }
        .map { USER_PREFERENCE_LABELS[it] ?: it }
    return if (labels.isEmpty()) "设置" else labels.joinToString("、")
}
